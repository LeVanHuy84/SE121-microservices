import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type MediaType = 'image' | 'video';
export type MediaStatus = 'UPLOADED' | 'READY' | 'FAILED';

@Entity('media')
export class Media {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  publicId: string;

  @Column({ nullable: true })
  url?: string;

  @Column({ type: 'enum', enum: ['image', 'video'] })
  type: MediaType;

  @Column({ nullable: true })
  contentId?: string;

  @Column({
    type: 'enum',
    enum: ['UPLOADED', 'READY', 'FAILED'],
    default: 'UPLOADED',
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
