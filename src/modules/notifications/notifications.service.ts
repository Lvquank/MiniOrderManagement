import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationLog } from './entities/notification-log.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationLog)
    private readonly notificationRepo: Repository<NotificationLog>,
  ) {}

  async createLog(params: {
    orderId: string;
    customerEmail: string;
    title: string;
    message: string;
    status?: string;
  }): Promise<NotificationLog> {
    const log = this.notificationRepo.create({
      orderId: params.orderId,
      customerEmail: params.customerEmail,
      title: params.title,
      message: params.message,
      status: params.status || 'SENT',
    });
    return await this.notificationRepo.save(log);
  }

  async findByOrderId(orderId: string): Promise<NotificationLog[]> {
    return await this.notificationRepo.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(limit: number = 50): Promise<NotificationLog[]> {
    return await this.notificationRepo.find({
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }
}
