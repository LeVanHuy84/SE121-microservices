// share-stat.entity.ts
import { Entity, PrimaryColumn, OneToOne, JoinColumn, Column } from 'typeorm';
import { Share } from './share.entity';

@Entity('share_stats')
export class ShareStat {
  @PrimaryColumn('uuid', { name: 'share_id' })
  shareId: string;

  @OneToOne(() => Share, (share) => share.shareStat, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'share_id' })
  share: Share;

  @Column({ type: 'int', default: 0 }) reactions: number;
  @Column({ type: 'int', default: 0 }) likes: number;
  @Column({ type: 'int', default: 0 }) loves: number;
  @Column({ type: 'int', default: 0 }) hahas: number;
  @Column({ type: 'int', default: 0 }) wows: number;
  @Column({ type: 'int', default: 0 }) sads: number;
  @Column({ type: 'int', default: 0 }) angrys: number;

  @Column({ type: 'int', default: 0 }) comments: number;
}
