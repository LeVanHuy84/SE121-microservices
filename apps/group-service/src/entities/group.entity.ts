import { Column, Entity, OneToMany, OneToOne } from 'typeorm';
import {
  GroupOwnerSnapshot,
  GroupPrivacy,
  GroupStatus,
  MediaItemDTO,
} from '@repo/dtos';
import { AuditableEntity } from './auditable.entity';
import { GroupSetting } from './group-setting.entity';
import { GroupMember } from './group-member.entity';
import { GroupJoinRequest } from './group-join-request.entity';
import { GroupReport } from './group-report.entity';
import { GroupStatistic } from './group-statistic.entity';
import { GroupLog } from './group-log.entity';
import { GroupInvite } from './group-invite.entity';

@Entity('groups')
export class Group extends AuditableEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string;

  @Column({ type: 'jsonb', name: 'avatar', nullable: true })
  avatar: MediaItemDTO;

  @Column({ type: 'jsonb', name: 'cover_image', nullable: true })
  coverImage: MediaItemDTO;

  @Column({ type: 'enum', enum: GroupPrivacy, default: GroupPrivacy.PUBLIC })
  privacy: GroupPrivacy;

  @Column({ type: 'varchar', length: 10000, nullable: true })
  rules: string;

  @Column({ type: 'int', default: 1 })
  members: number;

  @Column({ type: 'int', default: 0 })
  reports: number;

  @Column({ type: 'jsonb', nullable: true })
  owner: GroupOwnerSnapshot;

  @Column({ type: 'enum', enum: GroupStatus, default: GroupStatus.ACTIVE })
  status: GroupStatus;

  @OneToOne(() => GroupSetting, (groupSetting) => groupSetting.group, {
    cascade: true,
  })
  groupSetting: GroupSetting;

  @OneToMany(() => GroupMember, (groupMember) => groupMember.group)
  groupMembers: GroupMember[];

  @OneToMany(
    () => GroupJoinRequest,
    (groupJoinRequest) => groupJoinRequest.group,
  )
  groupJoinRequests: GroupJoinRequest[];

  @OneToMany(() => GroupInvite, (groupInvite) => groupInvite.group)
  groupInvites: GroupInvite[];

  @OneToMany(() => GroupReport, (groupReport) => groupReport.group)
  groupReports: GroupReport[];

  @OneToMany(() => GroupLog, (groupLog) => groupLog.group)
  groupLogs: GroupLog[];

  @OneToMany(() => GroupStatistic, (statistic) => statistic.group)
  statistics: GroupStatistic[];
}
