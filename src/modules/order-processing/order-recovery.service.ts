import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderProcessingService } from './order-processing.service';
import { OrderProcessingProcessor } from './order-processing.processor';

@Injectable()
export class OrderRecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OrderRecoveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly queue: OrderProcessingService,
    private readonly processor: OrderProcessingProcessor,
  ) {}

  async onApplicationBootstrap() {
    await this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), 5000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      await this.queue.scheduleCleanup();
      let cursor = '';
      while (true) {
        const query = this.dataSource.getRepository(Order).createQueryBuilder('order')
          .select(['order.id']).where('order.status = :status', { status: OrderStatus.PENDING })
          .orderBy('order.id', 'ASC').take(100);
        if (cursor) query.andWhere('order.id > :cursor', { cursor });
        const orders = await query.getMany();
        for (const order of orders) {
          try {
            const job = await this.queue.getOrderJobStatus(order.id);
            if (job.state === 'not_found') {
              await this.queue.addOrderJob(order.id);
            } else if (job.state === 'failed') {
              // The pending row and retained failed job survive worker restarts.
              await this.processor.failOrder(order.id, job.failedReason || 'Background processing failed');
            }
          } catch (error) {
            this.logger.error(`Recovery for order ${order.id} will retry: ${error.message}`);
          }
        }
        if (orders.length < 100) break;
        cursor = orders[orders.length - 1].id;
      }
    } catch (error) {
      this.logger.error(`Order recovery will retry: ${error.message}`);
    } finally {
      this.running = false;
    }
  }
}
