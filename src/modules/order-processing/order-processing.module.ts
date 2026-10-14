import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrderProcessingProcessor } from './order-processing.processor';
import { OrderProcessingService } from './order-processing.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'order-processing',
    }),
    NotificationsModule,
  ],
  providers: [OrderProcessingProcessor, OrderProcessingService],
  exports: [OrderProcessingService, BullModule],
})
export class OrderProcessingModule {}
