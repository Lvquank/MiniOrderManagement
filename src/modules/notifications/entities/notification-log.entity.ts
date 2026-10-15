import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('notification_logs')
export class NotificationLog {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ format: 'uuid' })
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @Column({ type: 'varchar', length: 255 })
  @ApiProperty({})
  customerEmail: string;

  @Column({ type: 'varchar', length: 255 })
  @ApiProperty({})
  title: string;

  @Column({ type: 'text' })
  @ApiProperty({})
  message: string;

  @Column({ type: 'varchar', length: 50, default: 'SENT' })
  @ApiProperty({})
  status: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  @ApiProperty({})
  createdAt: Date;
}
