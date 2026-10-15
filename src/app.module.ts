import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { dataSourceOptions } from './database/data-source';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OrderProcessingModule } from './modules/order-processing/order-processing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { redisConnection } from './modules/order-processing/queue.config';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Database with TypeORM (strictly migrations, synchronize: false)
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      autoLoadEntities: true,
    }),

    // BullMQ Queue connection with Redis
    BullModule.forRoot({
      connection: redisConnection(),
      prefix: process.env.QUEUE_PREFIX || 'bull',
    }),

    // Application Modules
    ProductsModule,
    OrdersModule,
    OrderProcessingModule,
    NotificationsModule,
  ],
})
export class AppModule {}
