import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationLog } from './entities/notification-log.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationLog])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService, TypeOrmModule],
})
export class NotificationsModule {}
