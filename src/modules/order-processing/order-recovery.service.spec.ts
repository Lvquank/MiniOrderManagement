import { Logger } from '@nestjs/common';
import { OrderRecoveryService } from './order-recovery.service';

describe('OrderRecoveryService', () => {
  function setup(state: string) {
    const query: any = {};
    for (const method of ['select', 'where', 'orderBy', 'take', 'andWhere']) query[method] = jest.fn().mockReturnValue(query);
    query.getMany = jest.fn().mockResolvedValue([{ id: 'pending-order' }]);
    const source: any = { getRepository: () => ({ createQueryBuilder: () => query }) };
    const queue: any = { scheduleCleanup: jest.fn().mockResolvedValue(undefined),
      getOrderJobStatus: jest.fn().mockResolvedValue({ state, failedReason: 'exhausted' }),
      addOrderJob: jest.fn().mockResolvedValue(undefined) };
    const processor: any = { failOrder: jest.fn().mockResolvedValue(undefined) };
    return { service: new OrderRecoveryService(source, queue, processor), queue, processor };
  }
  it('re-enqueues committed pending orders whose job is missing', async () => {
    const { service, queue } = setup('not_found');
    await service.reconcile();
    expect(queue.addOrderJob).toHaveBeenCalledWith('pending-order');
  });
  it('retries failed stock refunds on the next reconciliation', async () => {
    const { service, processor } = setup('failed');
    processor.failOrder.mockRejectedValueOnce(new Error('temporary DB outage'));
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      await service.reconcile();
      await service.reconcile();
      expect(processor.failOrder).toHaveBeenCalledTimes(2);
      expect(processor.failOrder).toHaveBeenLastCalledWith('pending-order', 'exhausted');
    } finally { log.mockRestore(); }
  });
  it.each(['waiting', 'active', 'delayed', 'completed'])('does not duplicate a %s job', async state => {
    const { service, queue, processor } = setup(state);
    await service.reconcile();
    expect(queue.addOrderJob).not.toHaveBeenCalled();
    expect(processor.failOrder).not.toHaveBeenCalled();
  });
});
