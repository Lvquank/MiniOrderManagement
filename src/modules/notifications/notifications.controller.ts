import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationLog } from './entities/notification-log.entity';
import { QueryNotificationDto } from './dto/query-notification.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get latest notification logs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of notification logs', type: [NotificationLog] })
  findAll(@Query() query: QueryNotificationDto) {
    return this.notificationsService.findAll(query.limit);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Get notification logs for a specific order' })
  @ApiParam({ name: 'orderId', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'List of notification logs for order' })
  findByOrderId(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.notificationsService.findByOrderId(orderId);
  }
}
