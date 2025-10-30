import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Group } from './group.entity';

@Entity('group_categories')
export class GroupCategory extends BaseEntity {
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string;

  @OneToMany(() => Group, (group) => group.groupCategory)
  groups: Group[];
}
