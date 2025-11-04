import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TargetType } from '@repo/dtos';

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { name: 'reporter_id' })
  reporterId: string;

  @Column({ name: 'target_type', type: 'enum', enum: TargetType })
  targetType: TargetType;

  @Column('uuid', { name: 'target_id' })
  targetId: string;

  @Column('text', { nullable: true })
  reason: string;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
