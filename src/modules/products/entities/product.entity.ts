import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../../src/common/utils/numeric.transformer';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ format: 'uuid' })
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100, unique: true })
  @ApiProperty({})
  sku: string;

  @Column({ type: 'varchar', length: 255 })
  @ApiProperty({})
  name: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  @ApiProperty({})
  price: number;

  @Column({ type: 'int', default: 0 })
  @ApiProperty({})
  stock: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  @ApiProperty({})
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  @ApiProperty({})
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  @ApiProperty({ nullable: true })
  deletedAt: Date | null;
}
