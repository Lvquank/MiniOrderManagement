import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { ColumnNumericTransformer } from '../../../../src/common/utils/numeric.transformer';

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ format: 'uuid' })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  @ApiProperty({})
  customerName: string;

  @Column({ type: 'varchar', length: 255 })
  @ApiProperty({})
  customerEmail: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: new ColumnNumericTransformer(),
  })
  @ApiProperty({})
  totalAmount: number;

  @Index()
  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  @ApiProperty({ type: () => [OrderItem] })
  items: OrderItem[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  @ApiProperty({})
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  @ApiProperty({})
  updatedAt: Date;
}
