import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { NotificationLog } from '../notifications/entities/notification-log.entity';
import { restoreStock } from '../orders/restore-stock';
import { redisConnection } from './queue.config';

@Processor('order-processing', { connection: redisConnection(true) })
export class OrderProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessingProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<{ orderId?: string }>) {
    if (job.name === 'cleanup-stale-orders') return this.cleanupStaleOrders();
    if (job.name !== 'process-order' || !job.data.orderId) {
      throw new Error(`Unsupported job: ${job.name}`);
    }
    const { orderId } = job.data;
    const current = await this.dataSource.getRepository(Order).findOneBy({ id: orderId });
    if (!current || current.status !== OrderStatus.PENDING) return { status: 'SKIPPED' };

    await new Promise(resolve => setTimeout(resolve, 3000 + Math.floor(Math.random() * 2000)));
    const failureRate = Number(process.env.SIMULATE_FAILURE_RATE ?? '0.3');
    if (Math.random() < failureRate) {
      throw new Error(`Simulated processing failure. Attempt ${job.attemptsMade + 1}/${job.opts.attempts || 3}`);
    }

    return this.dataSource.transaction(async manager => {
      const order = await manager.findOne(Order, {
        where: { id: orderId }, lock: { mode: 'pessimistic_write' },
      });
      if (!order || order.status !== OrderStatus.PENDING) return { status: 'SKIPPED' };
      await manager.update(Order, order.id, { status: OrderStatus.CONFIRMED });
      await manager.save(manager.create(NotificationLog, {
        orderId: order.id, customerEmail: order.customerEmail,
        title: 'Đơn hàng đã được xác nhận (Order Confirmed)',
        message: `Kính gửi ${order.customerName}, đơn hàng #${order.id} đã được xác nhận. Tổng tiền: ${order.totalAmount.toLocaleString('vi-VN')} VND.`,
        status: 'SENT',
      }));
      return { orderId, status: OrderStatus.CONFIRMED };
    });
  }

  @OnWorkerEvent('failed')
  onJobFailed(job: Job<{ orderId?: string }> | undefined, error: Error) {
    this.logger.error(`Job ${job?.id} failed: ${error.message}`);
    // Recovery polls durable failed jobs; an event listener is not a retryable transaction.
  }

  async failOrder(orderId: string, reason: string) {
    return this.dataSource.transaction(async manager => {
      const order = await manager.findOne(Order, {
        where: { id: orderId }, lock: { mode: 'pessimistic_write' },
      });
      if (!order || order.status !== OrderStatus.PENDING) return;
      await restoreStock(manager, order.id);
      await manager.update(Order, order.id, { status: OrderStatus.FAILED });
      await manager.save(manager.create(NotificationLog, {
        orderId: order.id, customerEmail: order.customerEmail,
        title: 'Đơn hàng xử lý thất bại (Order Processing Failed)',
        message: `Đơn hàng #${order.id} xử lý thất bại (${reason}). Tồn kho đã được hoàn lại.`,
        status: 'FAILED',
      }));
    });
  }

  private async cleanupStaleOrders() {
    const cutoff = new Date(Date.now() - Number(process.env.ORDER_EXPIRY_MINUTES || 30) * 60000);
    const stale = await this.dataSource.getRepository(Order).find({
      where: { status: OrderStatus.PENDING, createdAt: LessThanOrEqual(cutoff) },
      select: { id: true },
    });
    let cleanedCount = 0;
    for (const candidate of stale) {
      const cancelled = await this.dataSource.transaction(async manager => {
        const order = await manager.findOne(Order, {
          where: { id: candidate.id }, lock: { mode: 'pessimistic_write' },
        });
        if (!order || order.status !== OrderStatus.PENDING || order.createdAt > cutoff) return false;
        await restoreStock(manager, order.id);
        await manager.update(Order, order.id, { status: OrderStatus.CANCELLED });
        await manager.save(manager.create(NotificationLog, {
          orderId: order.id, customerEmail: order.customerEmail,
          title: 'Đơn hàng tự động hủy do quá hạn (Auto Cancelled Stale Order)',
          message: `Đơn hàng #${order.id} quá hạn xử lý. Tồn kho đã được hoàn lại.`,
          status: 'CANCELLED_EXPIRED',
        }));
        return true;
      });
      if (cancelled) cleanedCount++;
    }
    return { cleanedCount };
  }
}
