import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @ApiProperty({ example: 'IPHONE-15-PRO', description: 'Unique Stock Keeping Unit' })
  @IsString()
  @IsNotEmpty({ message: 'SKU cannot be empty' })
  sku: string;

  @ApiProperty({ example: 'iPhone 15 Pro Max 256GB', description: 'Product name' })
  @IsString()
  @IsNotEmpty({ message: 'Product name cannot be empty' })
  name: string;

  @ApiProperty({ example: 29990000, description: 'Product price' })
  @Type(() => Number)
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0, { message: 'Price cannot be negative' })
  price: number;

  @ApiProperty({ example: 10, description: 'Initial stock quantity' })
  @Type(() => Number)
  @IsInt({ message: 'Stock must be an integer' })
  @Min(0, { message: 'Stock cannot be negative' })
  stock: number;
}
