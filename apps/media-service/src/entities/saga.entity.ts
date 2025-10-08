import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sagas')
export class Saga {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sagaType: string; // e.g., 'video_processing'

  @Column()
  state: string; // e.g., 'started', 'transcoding', 'moderation', 'completed', 'failed'

  @Column({ type: 'jsonb', nullable: true })
  context: any;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
