import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { dataSourceOptions } from './database/data-source';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OrderProcessingModule } from './modules/order-processing/order-processing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

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
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isTls = config.get<string>('REDIS_TLS') === 'true';
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          return {
            connection: {
              url: redisUrl,
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
            },
          };
        }
        return {
          connection: {
            host: config.get<string>('REDIS_HOST', '127.0.0.1'),
            port: config.get<number>('REDIS_PORT', 6379),
            password: config.get<string>('REDIS_PASSWORD') || undefined,
            ...(isTls ? { tls: {} } : {}),
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      },
    }),

    // Application Modules
    ProductsModule,
    OrdersModule,
    OrderProcessingModule,
    NotificationsModule,
  ],
})
export class AppModule {}
