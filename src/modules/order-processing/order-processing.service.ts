import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface OrderJobStatusResponse {
  jobId: string;
  state: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string | null;
  timestamp: number | null;
  processedOn: number | null;
  finishedOn: number | null;
  data: any;
}

@Injectable()
export class OrderProcessingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrderProcessingService.name);

  constructor(
    @InjectQueue('order-processing')
    private readonly orderQueue: Queue,
  ) {}

  async onApplicationBootstrap() {
    try {
      // Register repeatable job to auto-cleanup stale PENDING orders every 5 minutes
      await this.orderQueue.add(
        'cleanup-stale-orders',
        {},
        {
          jobId: 'repeatable-cleanup-stale-orders',
          repeat: {
            pattern: '*/5 * * * *',
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log('✅ Repeatable cleanup job scheduled: runs every 5 minutes (*/5 * * * *)');
    } catch (error) {
      this.logger.warn(`Failed to schedule repeatable cleanup job: ${error.message}`);
    }
  }

  async addOrderJob(orderId: string): Promise<void> {
    await this.orderQueue.add(
      'process-order',
      { orderId },
      {
        jobId: orderId, // Ensures idempotency at the queue level
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000, // 2s, 4s, 8s
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
    this.logger.log(`📥 Dispatched job for order #${orderId} to "order-processing" queue`);
  }

  async getOrderJobStatus(orderId: string): Promise<OrderJobStatusResponse> {
    const job = await this.orderQueue.getJob(orderId);

    if (!job) {
      return {
        jobId: orderId,
        state: 'not_found',
        attemptsMade: 0,
        maxAttempts: 3,
        failedReason: null,
        timestamp: null,
        processedOn: null,
        finishedOn: null,
        data: null,
      };
    }

    const state = await job.getState();

    return {
      jobId: String(job.id),
      state,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts || 3,
      failedReason: job.failedReason || null,
      timestamp: job.timestamp || null,
      processedOn: job.processedOn || null,
      finishedOn: job.finishedOn || null,
      data: job.data,
    };
  }

  async triggerManualCleanup(): Promise<{ message: string }> {
    await this.orderQueue.add('cleanup-stale-orders', { manual: true });
    return { message: 'Manual stale orders cleanup job queued successfully' };
  }
}
