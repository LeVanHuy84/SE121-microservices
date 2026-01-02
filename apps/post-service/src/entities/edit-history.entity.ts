import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Post } from './post.entity';

@Entity('edit_histories')
export class EditHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'old_content' })
  oldContent: string;

  @CreateDateColumn({
    name: 'edit_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  editAt: Date;

  @ManyToOne(() => Post, (post) => post.editHistories, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'post_id' })
  post: Post;
}
