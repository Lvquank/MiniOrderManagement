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
    {
      sku: 'IPAD-PRO-M4',
      name: 'iPad Pro 11 inch M4 Wi-Fi 256GB Space Black',
      price: 28990000,
      stock: 8,
    },
    {
      sku: 'APPLE-WATCH-U2',
      name: 'Apple Watch Ultra 2 GPS + Cellular 49mm Titanium',
      price: 21990000,
      stock: 12,
    },
    {
      sku: 'SONY-WH1000XM5',
      name: 'Tai nghe chống ồn không dây Sony WH-1000XM5 Silver',
      price: 8490000,
      stock: 18,
    },
    {
      sku: 'DELL-XPS-15',
      name: 'Laptop Dell XPS 15 9530 Core i7-13700H 16GB 512GB RTX 4050',
      price: 45990000,
      stock: 6,
    },
    {
      sku: 'LOGITECH-MX-3S',
      name: 'Chuột công thái học không dây Logitech MX Master 3S Graphite',
      price: 2490000,
      stock: 30,
    },
    {
      sku: 'KEYCHRON-Q1-PRO',
      name: 'Bàn phím cơ không dây Keychron Q1 Pro QMK/VIA Carbon Black',
      price: 4290000,
      stock: 14,
    },
    {
      sku: 'SAMSUNG-S24-ULTRA',
      name: 'Samsung Galaxy S24 Ultra 12GB/256GB Titanium Gray',
      price: 27990000,
      stock: 15,
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
