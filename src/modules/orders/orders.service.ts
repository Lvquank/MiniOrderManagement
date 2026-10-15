import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Product } from '../products/entities/product.entity';
import { NotificationLog } from '../notifications/entities/notification-log.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { OrderProcessingService } from '../order-processing/order-processing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { restoreStock } from './restore-stock';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly orderProcessingService: OrderProcessingService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(createOrderDto: CreateOrderDto): Promise<Order> {
    const { customerName, customerEmail, items } = createOrderDto;

    // Sort items by productId to avoid deadlock between concurrent transactions
    const sortedItems = [...items].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    );

    const queryRunner = this.dataSource.createQueryRunner();
    let createdOrder: Order;

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      let totalAmount = 0;
      const orderItemsToSave: {
        productId: string;
        quantity: number;
        unitPrice: number;
      }[] = [];

      for (const item of sortedItems) {
        // Serialize inventory changes for this product until the transaction commits.
        const product = await queryRunner.manager.findOne(Product, {
          where: { id: item.productId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!product || product.deletedAt !== null) {
          throw new BadRequestException(
            `Product with ID "${item.productId}" does not exist or has been deleted`,
          );
        }

        if (product.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product "${product.name}" (SKU: ${product.sku}). Requested: ${item.quantity}, Available: ${product.stock}`,
          );
        }

        // Deduct inventory
        product.stock -= item.quantity;
        await queryRunner.manager.save(product);

        const unitPrice = Number(product.price);
        const itemSubtotal = Math.round(unitPrice * 100) * item.quantity;
        totalAmount += itemSubtotal;
        if (!Number.isSafeInteger(totalAmount) || totalAmount > 999999999999) {
          throw new BadRequestException('Order total exceeds the supported amount');
        }

        orderItemsToSave.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice,
        });
      }

      // Create Order with status PENDING
      const order = queryRunner.manager.create(Order, {
        customerName,
        customerEmail,
        totalAmount: totalAmount / 100,
        status: OrderStatus.PENDING,
      });

      createdOrder = await queryRunner.manager.save(order);

      // Save OrderItems with captured historical unitPrice
      for (const itemData of orderItemsToSave) {
        const orderItem = queryRunner.manager.create(OrderItem, {
          orderId: createdOrder.id,
          productId: itemData.productId,
          quantity: itemData.quantity,
          unitPrice: itemData.unitPrice,
        });
        await queryRunner.manager.save(orderItem);
      }

      await queryRunner.commitTransaction();
      this.logger.log(`🛒 Order #${createdOrder.id} successfully created. Status: PENDING`);
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // After transaction commit, dispatch background job to BullMQ queue
    try {
      await this.orderProcessingService.addOrderJob(createdOrder.id);
    } catch (queueError) {
      this.logger.error(
        `Failed to push order #${createdOrder.id} to queue: ${queueError.message}`,
      );
      // The worker reconciles committed PENDING orders with missing jobs every 5 seconds.
    }

    // Return the full order with items
    return await this.findOne(createdOrder.id);
  }

  async findAll(query: QueryOrderDto): Promise<PaginatedResult<Order>> {
    const { page = 1, limit = 10, status, skip } = query;

    const qb: SelectQueryBuilder<Order> = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.product', 'product');

    if (status) {
      qb.andWhere('order.status = :status', { status });
    }

    qb.orderBy('order.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      .where('order.id = :id', { id })
      .getOne();

    if (!order) {
      throw new NotFoundException(`Order with ID "${id}" not found`);
    }

    return order;
  }

  /**
   * Cancel order: only allowed if status is PENDING or CONFIRMED.
   * Restores stock in an atomic database transaction.
   */
  async cancel(id: string): Promise<{ message: string; order: Order }> {
    const queryRunner = this.dataSource.createQueryRunner();
    let updatedOrder: Order;

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      const order = await queryRunner.manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :id', { id })
        .getOne();

      if (!order) {
        throw new NotFoundException(`Order with ID "${id}" not found`);
      }

      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Order is already cancelled');
      }

      if (order.status === OrderStatus.FAILED) {
        throw new BadRequestException('Cannot cancel an order that has already failed');
      }

      if (
        order.status !== OrderStatus.PENDING &&
        order.status !== OrderStatus.CONFIRMED
      ) {
        throw new BadRequestException(
          `Order cannot be cancelled in state "${order.status}". Only PENDING or CONFIRMED orders can be cancelled.`,
        );
      }

      await restoreStock(queryRunner.manager, order.id);

      order.status = OrderStatus.CANCELLED;
      updatedOrder = await queryRunner.manager.save(order);

      // Record cancellation notification
      const cancelLog = queryRunner.manager.create(NotificationLog, {
        orderId: order.id,
        customerEmail: order.customerEmail,
        title: 'Đơn hàng đã được hủy (Order Cancelled)',
        message: `Đơn hàng #${order.id} đã được hủy thành công. Tồn kho đã được hoàn lại.`,
        status: 'CANCELLED',
      });
      await queryRunner.manager.save(cancelLog);

      await queryRunner.commitTransaction();
      this.logger.log(`Order #${order.id} cancelled and inventory restored.`);
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    const fullOrder = await this.findOne(updatedOrder.id);
    return {
      message: `Order #${id} has been cancelled successfully and inventory was restored.`,
      order: fullOrder,
    };
  }

  async getOrderJobStatus(id: string) {
    // Ensure order exists
    await this.findOne(id);
    return await this.orderProcessingService.getOrderJobStatus(id);
  }
}
