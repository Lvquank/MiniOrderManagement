import { Queue } from 'bullmq';
import { OrderProcessingService } from './order-processing.service';

describe('OrderProcessingService', () => {
  it('uses a stable job ID and three total attempts', async () => {
    const add = jest.fn().mockResolvedValue({});
    await new OrderProcessingService({ add } as unknown as Queue).addOrderJob('order-id');
    expect(add).toHaveBeenCalledWith('process-order', { orderId: 'order-id' }, expect.objectContaining({
      jobId: 'order-id', attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnFail: false,
    }));
  });
  it('bounds a stalled Redis operation', async () => {
    jest.useFakeTimers();
    try {
      const getJob = jest.fn().mockReturnValue(new Promise(() => {}));
      const service = new OrderProcessingService({ getJob } as unknown as Queue);
      const check = expect(service.getOrderJobStatus('id')).rejects.toThrow('Queue unavailable');
      await jest.advanceTimersByTimeAsync(3000);
      await check;
    } finally { jest.useRealTimers(); }
  });
});
