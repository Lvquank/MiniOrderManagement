import AppDataSource from '../data-source';
import { Product } from '../../modules/products/entities/product.entity';

async function seed() {
  console.log('🌱 Starting database seed...');
  await AppDataSource.initialize();

  const productRepo = AppDataSource.getRepository(Product);

  const initialProducts = [
    {
      sku: 'IPHONE-15-PRO',
      name: 'iPhone 15 Pro Max 256GB - Titan Tự Nhiên',
      price: 29990000,
      stock: 10,
    },
    {
      sku: 'MACBOOK-M3-PRO',
      name: 'MacBook Pro 14 M3 Pro 18GB/512GB Space Black',
      price: 49990000,
      stock: 5,
    },
    {
      sku: 'AIRPODS-PRO-2',
      name: 'Tai nghe Apple AirPods Pro 2 (USB-C)',
      price: 5490000,
      stock: 25,
    },
    {
      sku: 'MAGIC-KEYBOARD-TOUCH',
      name: 'Bàn phím Apple Magic Keyboard with Touch ID',
      price: 3690000,
      stock: 15,
    },
    {
      sku: 'LIMITED-EDITION-ITEM',
      name: 'Vật phẩm giới hạn (Dành cho test đồng thời Concurrency)',
      price: 1990000,
      stock: 1, // Only 1 in stock to test concurrency / overselling!
    },
  ];

  for (const item of initialProducts) {
    const existing = await productRepo.findOne({
      where: { sku: item.sku },
      withDeleted: true,
    });
    if (!existing) {
      await productRepo.save(productRepo.create(item));
      console.log(`✅ Seeded product: ${item.name} (${item.sku}) - Stock: ${item.stock}`);
    } else {
      // Reset stock and price for convenience during repeated test runs
      existing.stock = item.stock;
      existing.price = item.price;
      existing.name = item.name;
      existing.deletedAt = null;
      await productRepo.save(existing);
      console.log(`🔄 Updated existing product: ${item.name} (${item.sku}) - Stock: ${item.stock}`);
    }
  }

  console.log('✨ Seed completed successfully!');
  await AppDataSource.destroy();
}

seed().catch((error) => {
  console.error('❌ Error during seeding:', error);
  process.exit(1);
});
