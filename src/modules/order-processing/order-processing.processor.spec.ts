import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { OrderProcessingProcessor } from './order-processing.processor';
import { OrderStatus } from '../orders/entities/order.entity';

describe('OrderProcessingProcessor', () => {
  let processor: OrderProcessingProcessor, order: any, manager: any, repository: any;
  const originalRate = process.env.SIMULATE_FAILURE_RATE;
  const job = { name: 'process-order', data: { orderId: 'order-id' }, attemptsMade: 0, opts: { attempts: 3 } } as Job;
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.SIMULATE_FAILURE_RATE = '0';
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    order = { id: 'order-id', status: OrderStatus.PENDING, customerName: 'Test', customerEmail: 'test@example.com', totalAmount: 100, createdAt: new Date(0) };
    manager = {
      findOne: jest.fn().mockImplementation(async () => order),
      find: jest.fn().mockResolvedValue([{ productId: 'product-id', quantity: 1 }]),
      increment: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockImplementation(async (_entity, _id, patch) => { Object.assign(order, patch); }),
      create: jest.fn().mockImplementation((_entity, data) => data), save: jest.fn().mockResolvedValue({}),
    };
    repository = { findOneBy: jest.fn().mockImplementation(async () => ({ ...order })), find: jest.fn().mockResolvedValue([{ id: order.id }]) };
    const source = { transaction: (fn: (manager: any) => unknown) => fn(manager), getRepository: () => repository };
    processor = new OrderProcessingProcessor(source as unknown as DataSource);
  });
  afterEach(() => {
    jest.useRealTimers(); jest.restoreAllMocks();
    if (originalRate === undefined) delete process.env.SIMULATE_FAILURE_RATE;
    else process.env.SIMULATE_FAILURE_RATE = originalRate;
  });
  it('confirms and notifies once when the same job runs again', async () => {
    const result = processor.process(job);
    await jest.advanceTimersByTimeAsync(5000);
    await result;
    await processor.process(job);
    expect(order.status).toBe(OrderStatus.CONFIRMED);
    expect(manager.save).toHaveBeenCalledTimes(1);
  });
  it('rechecks status under lock after cancellation during processing', async () => {
    const result = processor.process(job);
    await jest.advanceTimersByTimeAsync(1);
    order.status = OrderStatus.CANCELLED;
    await jest.advanceTimersByTimeAsync(5000);
    await result;
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('throws a simulated error so BullMQ can retry', async () => {
    process.env.SIMULATE_FAILURE_RATE = '1';
    const check = expect(processor.process(job)).rejects.toThrow('Simulated processing failure');
    await jest.advanceTimersByTimeAsync(5000);
    await check;
    expect(manager.update).not.toHaveBeenCalled();
  });
  it('refunds an exhausted order once', async () => {
    await processor.failOrder(order.id, 'exhausted');
    await processor.failOrder(order.id, 'duplicate');
    expect(order.status).toBe(OrderStatus.FAILED);
    expect(manager.increment).toHaveBeenCalledTimes(1);
    expect(manager.save).toHaveBeenCalledTimes(1);
  });
  it('propagates refund errors for recovery to retry', async () => {
    manager.increment.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(processor.failOrder(order.id, 'exhausted')).rejects.toThrow('DB unavailable');
    expect(order.status).toBe(OrderStatus.PENDING);
    expect(manager.save).not.toHaveBeenCalled();
    await processor.failOrder(order.id, 'exhausted');
    expect(order.status).toBe(OrderStatus.FAILED);
  });
  it('expires a stale pending order once', async () => {
    const cleanup = { name: 'cleanup-stale-orders', data: {} } as Job;
    expect(await processor.process(cleanup)).toEqual({ cleanedCount: 1 });
    expect(await processor.process(cleanup)).toEqual({ cleanedCount: 0 });
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(manager.increment).toHaveBeenCalledTimes(1);
  });
});
