import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Group } from './group.entity';

@Entity('group_statistics')
export class GroupStatistic {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId: string;

  @ManyToOne(() => Group, (group) => group.statistics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: Group;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'int', name: 'post_count', default: 0 })
  postCount: number;

  @Column({ type: 'int', name: 'join_count', default: 0 })
  joinCount: number;

  @Column({ type: 'int', name: 'leave_count', default: 0 })
  leaveCount: number;
}
