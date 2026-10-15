import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsString, Length, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateProductDto {
  @ApiProperty({ example: 'IPHONE-15-PRO', description: 'Unique Stock Keeping Unit' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @Length(1, 100)
  sku: string;

  @ApiProperty({ example: 'iPhone 15 Pro Max 256GB', description: 'Product name' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @Length(1, 255)
  name: string;

  @ApiProperty({ example: 29990000, description: 'Product price' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Price must be a number with at most 2 decimal places' })
  @Min(0, { message: 'Price cannot be negative' })
  @Max(9999999999.99)
  price: number;

  @ApiProperty({ example: 10, description: 'Initial stock quantity' })
  @IsInt({ message: 'Stock must be an integer' })
  @Min(0, { message: 'Stock cannot be negative' })
  @Max(2147483647)
  stock: number;
}
