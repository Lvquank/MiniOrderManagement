import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import { Product } from '../modules/products/entities/product.entity';
import { Order } from '../modules/orders/entities/order.entity';
import { OrderItem } from '../modules/orders/entities/order-item.entity';
import { NotificationLog } from '../modules/notifications/entities/notification-log.entity';

dotenv.config();

const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;

export const dataSourceOptions: DataSourceOptions = dbUrl
  ? {
      type: 'postgres',
      url: dbUrl,
      ssl: {
        rejectUnauthorized: false,
      },
      entities: [Product, Order, OrderItem, NotificationLog],
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
      synchronize: false,
      logging: process.env.NODE_ENV === 'development',
    }
  : {
      type: 'postgres',
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'secret',
      database: process.env.DB_DATABASE || 'mini_order_db',
      entities: [Product, Order, OrderItem, NotificationLog],
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
      synchronize: false,
      logging: process.env.NODE_ENV === 'development',
    };

const AppDataSource = new DataSource({
  ...dataSourceOptions,
  ...(process.env.DATABASE_URL_UNPOOLED ? { url: process.env.DATABASE_URL_UNPOOLED } : {}),
});
export default AppDataSource;
