import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Group } from './group.entity';

@Entity('group_bans')
export class GroupBan extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId: string;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({ type: 'uuid', name: 'banned_by', nullable: false })
  bannedBy: string;

  @Column({ type: 'text', name: 'reason', nullable: true })
  reason: string;

  @OneToMany(() => Group, (group) => group.groupBans)
  group: Group;
}
