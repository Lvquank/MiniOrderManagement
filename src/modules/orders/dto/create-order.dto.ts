import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @ApiProperty({
    example: 'd9b2b6e1-2c1e-4f1e-8e3b-9a1b2c3d4e5f',
    description: 'Product UUID',
  })
  @IsUUID('all', { message: 'productId must be a valid UUID' })
  @IsNotEmpty({ message: 'productId is required' })
  productId: string;

  @ApiProperty({ example: 1, description: 'Quantity to purchase (must be >= 1)' })
  @Type(() => Number)
  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1' })
  quantity: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'Nguyen Van A', description: 'Customer full name' })
  @IsString()
  @IsNotEmpty({ message: 'customerName cannot be empty' })
  customerName: string;

  @ApiProperty({ example: 'customer@example.com', description: 'Customer email' })
  @IsEmail({}, { message: 'customerEmail must be a valid email address' })
  @IsNotEmpty({ message: 'customerEmail cannot be empty' })
  customerEmail: string;

  @ApiProperty({
    type: [CreateOrderItemDto],
    description: 'List of order items',
  })
  @IsArray({ message: 'items must be an array' })
  @ArrayMinSize(1, { message: 'Order must contain at least 1 item' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
