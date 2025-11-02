import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { GroupPrivacy, GroupStatus, MediaItemDTO } from '@repo/dtos';
import { AuditableEntity } from './auditable.entity';
import { GroupSetting } from './group-setting.entity';
import { GroupCategory } from './group-category.entity';
import { GroupMember } from './group-member.entity';
import { GroupJoinRequest } from './group-join-request.entity';
import { GroupInvite } from './group-invite.entity';
import { GroupBan } from './group-ban.entity';
import { GroupReport } from './group-report.entity';
import { GroupEvent } from './group-event.entity';
import { GroupPinnedPost } from './group-pinned-post.entity';
import { GroupStatistic } from './group-statistic.entity';

@Entity('groups')
export class Group extends AuditableEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string;

  @Column({ type: 'varchar', name: 'avatar_url' })
  avatarUrl: string;

  @Column({ type: 'varchar', name: 'cover_image_url', nullable: true })
  coverImageUrl: string;

  @Column({ type: 'enum', enum: GroupPrivacy, default: GroupPrivacy.PUBLIC })
  privacy: GroupPrivacy;

  @Column({ type: 'varchar', length: 10000, nullable: true })
  rules: string;

  @Column({ type: 'int', default: 1 })
  members: number;

  @Column({ type: 'uuid', name: 'group_category_id', nullable: true })
  groupCategoryId: string;

  @Column({ type: 'enum', enum: GroupStatus, default: GroupStatus.ACTIVE })
  status: GroupStatus;

  @ManyToOne(() => GroupCategory, (groupCategory) => groupCategory.groups, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'group_category_id' })
  groupCategory: GroupCategory;

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

  @OneToMany(() => GroupBan, (groupBan) => groupBan.group)
  groupBans: GroupBan[];

  @OneToMany(() => GroupReport, (groupReport) => groupReport.group)
  groupReports: GroupReport[];

  @OneToMany(() => GroupEvent, (groupEvent) => groupEvent.group)
  groupEvents: GroupEvent[];

  @OneToMany(() => GroupPinnedPost, (groupPinnedPost) => groupPinnedPost.group)
  groupPinnedPosts: GroupPinnedPost[];

  @OneToMany(() => GroupStatistic, (statistic) => statistic.group)
  statistics: GroupStatistic[];
}
