import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from '../../products/entities/product.entity';
import { ColumnNumericTransformer } from '../../../../src/common/utils/numeric.transformer';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ format: 'uuid' })
  id: string;

  @Column({ type: 'uuid' })
  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @Column({ type: 'uuid' })
  @ApiProperty({ format: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  @ApiProperty({})
  quantity: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  @ApiProperty({})
  unitPrice: number;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  @ApiProperty({ type: () => Product, nullable: true })
  product: Product;
}
