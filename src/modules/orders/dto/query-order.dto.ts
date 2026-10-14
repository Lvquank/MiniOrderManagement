import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { OrderStatus } from '../entities/order.entity';

export class QueryOrderDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: OrderStatus,
    description: 'Filter orders by status (PENDING, CONFIRMED, CANCELLED, FAILED)',
  })
  @IsOptional()
  @IsEnum(OrderStatus, {
    message: `status must be one of: ${Object.values(OrderStatus).join(', ')}`,
  })
  status?: OrderStatus;
}
