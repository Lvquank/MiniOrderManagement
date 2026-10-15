import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrderProcessingProcessor } from './order-processing.processor';
import { OrderProcessingService } from './order-processing.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderRecoveryService } from './order-recovery.service';
import { workerEnabled } from './queue.config';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'order-processing',
    }),
    NotificationsModule,
  ],
  providers: [OrderProcessingService, ...(workerEnabled() ? [OrderProcessingProcessor, OrderRecoveryService] : [])],
  exports: [OrderProcessingService, BullModule],
})
export class OrderProcessingModule {}
