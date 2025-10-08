import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type MediaStatus = 'UPLOADING' | 'UPLOADED' | 'READY' | 'FAILED';

@Entity('media')
export class Media {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ nullable: true })
  postId?: string;

  @Column()
  publicId: string;

  @Column()
  url: string;

  @Column({ type: 'enum', enum: ['image', 'video'] })
  type: 'image' | 'video';

  @Column({
    type: 'enum',
    enum: ['UPLOADING', 'UPLOADED', 'READY', 'FAILED'],
    default: 'UPLOADING',
  })
  status: MediaStatus;

  @Column({ nullable: true })
  format?: string;

  @Column({ nullable: true, type: 'int' })
  size?: number;

  @Column({ nullable: true, type: 'int' })
  duration?: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
