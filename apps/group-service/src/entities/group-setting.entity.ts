import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { AuditableEntity } from './auditable.entity';
import { Group } from './group.entity';

@Entity('group_settings')
export class GroupSetting extends AuditableEntity {
  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({ type: 'boolean', name: 'required_post_approval', default: false })
  requiredPostApproval: boolean;

  @Column({ type: 'int', name: 'max_members', default: 1000 })
  maxMembers: number;

  @OneToOne(() => Group, (group) => group.groupSetting, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: Group;
}
