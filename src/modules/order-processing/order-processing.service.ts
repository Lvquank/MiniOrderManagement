import { Injectable } from '@nestjs/common';
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
  data: unknown;
}

@Injectable()
export class OrderProcessingService {
  private cleanupScheduled = false;

  constructor(@InjectQueue('order-processing') private readonly orderQueue: Queue) {}

  private async execute<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Queue unavailable; worker recovery will retry')), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async scheduleCleanup() {
    if (this.cleanupScheduled) return;
    await this.execute(this.orderQueue.add('cleanup-stale-orders', {}, {
      jobId: 'repeatable-cleanup-stale-orders',
      repeat: { pattern: '*/5 * * * *' },
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    }));
    this.cleanupScheduled = true;
  }

  async addOrderJob(orderId: string): Promise<void> {
    await this.execute(this.orderQueue.add('process-order', { orderId }, {
      jobId: orderId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: false,
      removeOnFail: false,
    }));
  }

  async getOrderJobStatus(orderId: string): Promise<OrderJobStatusResponse> {
    const job = await this.execute(this.orderQueue.getJob(orderId));
    return {
      jobId: job ? String(job.id) : orderId,
      state: job ? await this.execute(job.getState()) : 'not_found',
      attemptsMade: job?.attemptsMade || 0,
      maxAttempts: job?.opts.attempts || 3,
      failedReason: job?.failedReason || null,
      timestamp: job?.timestamp || null,
      processedOn: job?.processedOn || null,
      finishedOn: job?.finishedOn || null,
      data: job?.data || null,
    };
  }
}
