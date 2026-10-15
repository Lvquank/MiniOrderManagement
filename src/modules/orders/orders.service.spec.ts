import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Product } from '../products/entities/product.entity';
import { OrderProcessingService } from '../order-processing/order-processing.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let dataSource: any;
  let orderProcessingService: any;
  let notificationsService: any;
  let mockQueryRunner: any;

  const mockProduct: Product = {
    id: 'prod-uuid-1',
    sku: 'IPHONE-15',
    name: 'iPhone 15',
    price: 1000,
    stock: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockOrder: Order = {
    id: 'order-uuid-1',
    customerName: 'Le Vinh Quang',
    customerEmail: 'quang@example.com',
    totalAmount: 2000,
    status: OrderStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
  };

  beforeEach(async () => {
    mockQueryRunner = {
      isTransactionActive: true,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        findOne: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        increment: jest.fn().mockResolvedValue(undefined),
      },
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
      getRepository: jest.fn(),
    };

    orderProcessingService = {
      addOrderJob: jest.fn().mockResolvedValue(undefined),
      getOrderJobStatus: jest.fn(),
    };

    notificationsService = {
      createLog: jest.fn().mockResolvedValue({ id: 'log-uuid' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Order), useValue: { findOne: jest.fn(), find: jest.fn() } },
        { provide: getRepositoryToken(OrderItem), useValue: { save: jest.fn() } },
        { provide: getRepositoryToken(Product), useValue: { findOne: jest.fn() } },
        { provide: OrderProcessingService, useValue: orderProcessingService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('rejects a total larger than numeric(12,2) and rolls back', async () => {
    mockQueryRunner.manager.findOne.mockResolvedValue({ ...mockProduct, stock: 2, price: 9999999999.99 });
    await expect(service.create({ customerName: 'Test', customerEmail: 'test@example.com', items: [{ productId: mockProduct.id, quantity: 2 }] }))
      .rejects.toThrow('Order total exceeds the supported amount');
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(orderProcessingService.addOrderJob).not.toHaveBeenCalled();
  });

  it('releases the query runner when connecting fails', async () => {
    mockQueryRunner.isTransactionActive = false;
    mockQueryRunner.connect.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.create({ customerName: 'Test', customerEmail: 'test@example.com', items: [{ productId: mockProduct.id, quantity: 1 }] }))
      .rejects.toThrow('Database unavailable');
    expect(mockQueryRunner.release).toHaveBeenCalled();
    expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Tạo đơn hàng thành công (Create Order Successfully)', () => {
    it('should lock product, deduct stock, create order with PENDING status, and dispatch BullMQ job', async () => {
      const createOrderDto = {
        customerName: 'Le Vinh Quang',
        customerEmail: 'quang@example.com',
        items: [{ productId: 'prod-uuid-1', quantity: 2 }],
      };

      const productCopy = { ...mockProduct, stock: 5 };

      // Mock finding product with pessimistic lock
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(productCopy);

      // Mock saving order and order items
      mockQueryRunner.manager.create.mockImplementation((entityClass, data) => data);
      mockQueryRunner.manager.save.mockImplementation((item) => {
        if (!item.id) {
          return Promise.resolve({ ...item, id: 'order-uuid-1' });
        }
        return Promise.resolve(item);
      });

      // Mock service.findOne to return completed order
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...mockOrder,
        totalAmount: 2000,
        items: [
          {
            id: 'item-uuid-1',
            orderId: 'order-uuid-1',
            productId: 'prod-uuid-1',
            quantity: 2,
            unitPrice: 1000,
            order: mockOrder,
            product: mockProduct,
          },
        ],
      });

      const result = await service.create(createOrderDto);

      // Verify transaction lifecycle
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      // Verify pessimistic lock query
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Product, {
        where: { id: 'prod-uuid-1' },
        lock: { mode: 'pessimistic_write' },
      });

      // Verify stock deducted from 5 to 3
      expect(productCopy.stock).toBe(3);

      // Verify background BullMQ queue dispatch
      expect(orderProcessingService.addOrderJob).toHaveBeenCalledWith('order-uuid-1');

      // Verify result
      expect(result.id).toBe('order-uuid-1');
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(result.totalAmount).toBe(2000);
    });
  });

  describe('2. Không đủ tồn kho (Insufficient Stock Error)', () => {
    it('should throw BadRequestException, rollback transaction, and NOT dispatch BullMQ job when requested > stock', async () => {
      const createOrderDto = {
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        items: [{ productId: 'prod-uuid-1', quantity: 10 }], // Requested 10, stock is 5
      };

      const productCopy = { ...mockProduct, stock: 5 };
      mockQueryRunner.manager.findOne.mockResolvedValue(productCopy);

      await expect(service.create(createOrderDto)).rejects.toThrow(
        /Insufficient stock for product "iPhone 15"/,
      );

      // Verify rollback occurred
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      // Stock was NOT permanently deducted
      expect(orderProcessingService.addOrderJob).not.toHaveBeenCalled();
    });
  });

  describe('3. Hủy đơn và hoàn lại tồn kho (Cancel Order and Restore Stock)', () => {
    it('should restore stock for each item, update status to CANCELLED, and log notification', async () => {
      const orderToCancel: Order = {
        id: 'order-uuid-1',
        customerName: 'Le Vinh Quang',
        customerEmail: 'quang@example.com',
        totalAmount: 2000,
        status: OrderStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: 'item-uuid-1',
            orderId: 'order-uuid-1',
            productId: 'prod-uuid-1',
            quantity: 2,
            unitPrice: 1000,
            order: null as any,
            product: null as any,
          },
        ],
      };

      const mockQb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(orderToCancel),
      };
      mockQueryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQb);
      mockQueryRunner.manager.find.mockResolvedValueOnce(orderToCancel.items);
      mockQueryRunner.manager.create.mockImplementation((entityClass, data) => data);
      mockQueryRunner.manager.save.mockImplementation((item) => Promise.resolve(item));

      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...orderToCancel,
        status: OrderStatus.CANCELLED,
      });

      const response = await service.cancel('order-uuid-1');

      // Verify createQueryBuilder lock
      expect(mockQueryRunner.manager.createQueryBuilder).toHaveBeenCalledWith(Order, 'order');
      expect(mockQb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(mockQb.where).toHaveBeenCalledWith('order.id = :id', { id: 'order-uuid-1' });

      // Verify stock increment (restoration)
      expect(mockQueryRunner.manager.increment).toHaveBeenCalledWith(
        Product,
        { id: 'prod-uuid-1' },
        'stock',
        2,
      );

      // Verify status changed to CANCELLED
      expect(orderToCancel.status).toBe(OrderStatus.CANCELLED);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      expect(response.order.status).toBe(OrderStatus.CANCELLED);
      expect(response.message).toContain('cancelled successfully');
    });

    it('should throw BadRequestException if order is already CANCELLED', async () => {
      const alreadyCancelledOrder: Order = {
        ...mockOrder,
        status: OrderStatus.CANCELLED,
      };

      const mockQb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(alreadyCancelledOrder),
      };
      mockQueryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      await expect(service.cancel('order-uuid-1')).rejects.toThrow(
        new BadRequestException('Order is already cancelled'),
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException if order is in FAILED state', async () => {
      const failedOrder: Order = {
        ...mockOrder,
        status: OrderStatus.FAILED,
      };

      const mockQb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(failedOrder),
      };
      mockQueryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      await expect(service.cancel('order-uuid-1')).rejects.toThrow(
        new BadRequestException('Cannot cancel an order that has already failed'),
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });
});
