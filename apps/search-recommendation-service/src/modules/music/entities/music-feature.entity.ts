import { AudioDTO, MediaItemDTO, MusicGenre } from '@repo/dtos';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('music_features')
export class MusicFeature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'jsonb' })
  audio: AudioDTO;

  @Column({ type: 'jsonb' })
  coverImage: MediaItemDTO;

  @Column({ type: 'varchar', nullable: true })
  artist: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'enum', enum: MusicGenre, nullable: true })
  genre: MusicGenre;

  // ===== EMOTION =====
  @Column('float')
  valence: number;

  @Column('float')
  arousal: number;

  @CreateDateColumn()
  createdAt: Date;
}
