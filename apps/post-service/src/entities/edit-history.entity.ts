import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Post } from './post.entity';

@Entity('edit_histories')
export class EditHisstory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'text', name: 'old_content' })
    oldContent: string;

    @Column({ type: 'text', name: 'new_content' })
    newContent: string;

    @CreateDateColumn({ name: 'edit_at' })
    editAt: Date;

    @ManyToOne(() => Post, (post) => post.editHistories)
    @JoinColumn({ name: 'post_id' })
    post: Post;
}