import { EntityManager } from 'typeorm';
import { OrderItem } from './entities/order-item.entity';
import { Product } from '../products/entities/product.entity';

// Call after locking the order; every refund acquires product locks in the same order.
export async function restoreStock(manager: EntityManager, orderId: string) {
  const items = await manager.find(OrderItem, {
    where: { orderId },
    order: { productId: 'ASC', id: 'ASC' },
  });
  for (const item of items) {
    await manager.increment(Product, { id: item.productId }, 'stock', item.quantity);
  }
}
