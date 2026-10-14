import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { Order } from './entities/order.entity';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an order with inventory check and background BullMQ processing',
    description:
      'Creates an order in PENDING status within a transaction, locking product rows pessimistically to prevent overselling. Dispatches a BullMQ job to process the order.',
  })
  @ApiResponse({ status: 201, description: 'Order created in PENDING status', type: Order })
  @ApiResponse({ status: 400, description: 'Insufficient stock or invalid input' })
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(createOrderDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get list of orders with pagination and status filter' })
  @ApiResponse({ status: 200, description: 'Paginated list of orders' })
  findAll(@Query() query: QueryOrderDto) {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order details including purchased items and current unit prices' })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Order details found', type: Order })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel an order and restore inventory',
    description:
      'Only orders with PENDING or CONFIRMED status can be cancelled. Restores stock atomically.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Order cancelled successfully and stock restored' })
  @ApiResponse({ status: 400, description: 'Order cannot be cancelled in current state' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.cancel(id);
  }

  @Get(':id/jobs')
  @ApiOperation({
    summary: 'Get BullMQ background job status for an order',
    description: 'Returns job state (waiting, active, completed, failed, delayed), attemptsMade, and failedReason.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Job status retrieved' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  getOrderJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getOrderJobStatus(id);
  }
}
