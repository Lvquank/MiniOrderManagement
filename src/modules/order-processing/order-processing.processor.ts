import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Product } from '../products/entities/product.entity';
import { NotificationLog } from '../notifications/entities/notification-log.entity';

@Processor('order-processing')
export class OrderProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessingProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'process-order':
        return await this.handleProcessOrder(job);
      case 'cleanup-stale-orders':
        return await this.handleCleanupStaleOrders(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        return null;
    }
  }

  private async handleProcessOrder(job: Job<{ orderId: string }>): Promise<any> {
    const { orderId } = job.data;
    const attempt = job.attemptsMade + 1;
    this.logger.log(
      `⚙️ Processing order #${orderId} (Attempt ${attempt}/${job.opts.attempts || 3})...`,
    );

    // 1. Simulate processing delay: 3 to 5 seconds
    const simulatedDelay = Math.floor(Math.random() * 2000) + 3000;
    this.logger.debug(`Simulating processing time: ${simulatedDelay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, simulatedDelay));

    // 2. Simulate random failure (~30% failure rate)
    const failureRate = parseFloat(process.env.SIMULATE_FAILURE_RATE || '0.3');
    const randomVal = Math.random();
    if (randomVal < failureRate) {
      this.logger.warn(
        `💥 Simulated failure triggered for order #${orderId} (rnd: ${randomVal.toFixed(2)} < ${failureRate}). Attempt ${attempt}.`,
      );
      throw new Error(
        `Payment gateway / warehouse processing error (Simulated ~30% failure rate). Attempt ${attempt}/${job.opts.attempts || 3}`,
      );
    }

    // 3. Process success in a transaction with Idempotency guard
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = await queryRunner.manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :id', { id: orderId })
        .getOne();

      if (!order) {
        this.logger.error(`Order #${orderId} not found during processing.`);
        await queryRunner.rollbackTransaction();
        return;
      }

      // Idempotency: If order was already confirmed or cancelled, do not process again
      if (order.status === OrderStatus.CONFIRMED) {
        this.logger.log(`ℹ️ Order #${orderId} is already CONFIRMED. Skipping duplicate execution.`);
        await queryRunner.rollbackTransaction();
        return { status: 'ALREADY_CONFIRMED' };
      }

      if (order.status === OrderStatus.CANCELLED) {
        this.logger.log(`ℹ️ Order #${orderId} was CANCELLED by customer. Skipping confirmation.`);
        await queryRunner.rollbackTransaction();
        return { status: 'ALREADY_CANCELLED' };
      }

      if (order.status === OrderStatus.FAILED) {
        this.logger.log(`ℹ️ Order #${orderId} was marked FAILED. Skipping confirmation.`);
        await queryRunner.rollbackTransaction();
        return { status: 'ALREADY_FAILED' };
      }

      // Transition PENDING -> CONFIRMED
      order.status = OrderStatus.CONFIRMED;
      await queryRunner.manager.save(order);

      // Record 1 notification log
      const notification = queryRunner.manager.create(NotificationLog, {
        orderId: order.id,
        customerEmail: order.customerEmail,
        title: 'Đơn hàng đã được xác nhận (Order Confirmed)',
        message: `Kính gửi ${order.customerName}, đơn hàng #${order.id} của bạn đã được thanh toán và xác nhận thành công. Tổng tiền: ${order.totalAmount.toLocaleString('vi-VN')} VND. Cảm ơn bạn đã mua hàng!`,
        status: 'SENT',
      });
      await queryRunner.manager.save(notification);

      await queryRunner.commitTransaction();
      this.logger.log(`🎉 Order #${orderId} successfully CONFIRMED and notification logged.`);

      return {
        orderId: order.id,
        status: OrderStatus.CONFIRMED,
        notificationId: notification.id,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  @OnWorkerEvent('failed')
  async onJobFailed(job: Job<{ orderId: string }>, error: Error) {
    this.logger.error(
      `❌ Job #${job.id} for order #${job.data?.orderId} failed: ${error.message} (Attempt ${job.attemptsMade}/${job.opts.attempts || 3})`,
    );

    // If max attempts exhausted, transition order to FAILED and restore stock
    const maxAttempts = job.opts.attempts || 3;
    if (job.attemptsMade >= maxAttempts && job.data?.orderId) {
      this.logger.warn(
        `🚨 Order #${job.data.orderId} exhausted all ${maxAttempts} retry attempts. Transitioning to FAILED and returning stock...`,
      );
      await this.handleExhaustedOrder(job.data.orderId, error.message);
    }
  }

  private async handleExhaustedOrder(orderId: string, reason: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = await queryRunner.manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :id', { id: orderId })
        .getOne();

      if (!order) {
        await queryRunner.rollbackTransaction();
        return;
      }

      order.items = await queryRunner.manager.find(OrderItem, {
        where: { orderId: order.id },
      });

      // Idempotency: only refund stock if still PENDING
      if (order.status !== OrderStatus.PENDING) {
        this.logger.log(
          `Order #${orderId} current status is ${order.status}. No need to restore stock on failure.`,
        );
        await queryRunner.rollbackTransaction();
        return;
      }

      // 1. Restore stock for each item in the order
      for (const item of order.items) {
        await queryRunner.manager.increment(
          Product,
          { id: item.productId },
          'stock',
          item.quantity,
        );
        this.logger.log(
          `🔄 Restored stock for product #${item.productId}: +${item.quantity}`,
        );
      }

      // 2. Update order status to FAILED
      order.status = OrderStatus.FAILED;
      await queryRunner.manager.save(order);

      // 3. Log notification for failure
      const log = queryRunner.manager.create(NotificationLog, {
        orderId: order.id,
        customerEmail: order.customerEmail,
        title: 'Đơn hàng xử lý thất bại (Order Processing Failed)',
        message: `Đơn hàng #${order.id} xử lý thất bại sau 3 lần thử lại (Lý do: ${reason}). Số lượng tồn kho đã được hoàn lại đầy đủ vào hệ thống.`,
        status: 'FAILED',
      });
      await queryRunner.manager.save(log);

      await queryRunner.commitTransaction();
      this.logger.log(
        `🛑 Order #${orderId} marked as FAILED and inventory restored successfully.`,
      );
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error while refunding failed order #${orderId}: ${err.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  private async handleCleanupStaleOrders(job: Job): Promise<any> {
    const expiryMinutes = parseInt(process.env.ORDER_EXPIRY_MINUTES || '30', 10);
    const cutoffDate = new Date(Date.now() - expiryMinutes * 60 * 1000);

    this.logger.log(
      `🔍 Running stale order cleanup: searching for PENDING orders created before ${cutoffDate.toISOString()} (> ${expiryMinutes}m old)...`,
    );

    const staleOrders = await this.dataSource.getRepository(Order).find({
      where: {
        status: OrderStatus.PENDING,
        createdAt: LessThanOrEqual(cutoffDate),
      },
      relations: ['items'],
    });

    if (staleOrders.length === 0) {
      this.logger.log('✨ No stale PENDING orders found.');
      return { cleanedCount: 0 };
    }

    this.logger.log(`Found ${staleOrders.length} stale order(s) to auto-cancel and refund.`);
    let cleanedCount = 0;

    for (const order of staleOrders) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const lockedOrder = await queryRunner.manager
          .createQueryBuilder(Order, 'order')
          .setLock('pessimistic_write')
          .where('order.id = :id', { id: order.id })
          .getOne();

        if (lockedOrder && lockedOrder.status === OrderStatus.PENDING) {
          const items = await queryRunner.manager.find(OrderItem, {
            where: { orderId: lockedOrder.id },
          });

          // Restore stock
          for (const item of items) {
            await queryRunner.manager.increment(
              Product,
              { id: item.productId },
              'stock',
              item.quantity,
            );
          }

          lockedOrder.status = OrderStatus.CANCELLED;
          await queryRunner.manager.save(lockedOrder);

          const log = queryRunner.manager.create(NotificationLog, {
            orderId: lockedOrder.id,
            customerEmail: lockedOrder.customerEmail,
            title: 'Đơn hàng tự động hủy do quá hạn (Auto Cancelled Stale Order)',
            message: `Đơn hàng #${lockedOrder.id} đã tự động bị hủy do ở trạng thái PENDING quá ${expiryMinutes} phút. Toàn bộ tồn kho đã được hoàn lại.`,
            status: 'CANCELLED_EXPIRED',
          });
          await queryRunner.manager.save(log);

          await queryRunner.commitTransaction();
          cleanedCount++;
          this.logger.log(`⏰ Auto-cancelled stale order #${lockedOrder.id}`);
        } else {
          await queryRunner.rollbackTransaction();
        }
      } catch (err) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Failed to auto-cancel stale order #${order.id}: ${err.message}`);
      } finally {
        await queryRunner.release();
      }
    }

    return { cleanedCount };
  }
}
