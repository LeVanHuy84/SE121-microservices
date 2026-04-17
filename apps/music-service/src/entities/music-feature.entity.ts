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

  @Column({ nullable: true })
  artist: string;

  @Column()
  title: string;

  @Column({ type: 'enum', enum: MusicGenre, nullable: true })
  genre: MusicGenre;

  // ===== EMOTION =====
  @Column('float')
  valence: number;

  @Column('float')
  arousal: number;

  // ===== AUDIO FEATURES =====
  @Column('float')
  tempo: number;

  @Column('float')
  rms: number;

  @Column('float')
  spectralCentroid: number;

  @Column('float')
  zcr: number;

  @CreateDateColumn()
  createdAt: Date;
}
