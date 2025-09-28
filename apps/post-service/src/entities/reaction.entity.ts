import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { ReactionType, TargetType } from '@repo/dtos';

@Entity('reactions')
@Unique(['userId', 'targetId', 'targetType'])
@Index(['targetId', 'targetType'])
export class Reaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column('uuid', { name: 'target_id' })
  targetId: string;

  @Column({ name: 'target_type', type: 'enum', enum: TargetType })
  targetType: TargetType;

  @Column({ name: 'reaction_type', type: 'enum', enum: ReactionType })
  reactionType: ReactionType;
}
