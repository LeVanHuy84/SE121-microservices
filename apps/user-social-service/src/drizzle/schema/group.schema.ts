import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  date,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  GroupPrivacy,
  GroupStatus,
  GroupRole,
  GroupMemberStatus,
  InviteStatus,
  JoinRequestStatus,
  GroupEventLog,
  ReportStatus,
} from '@repo/dtos';

// ===================================================
// ENUMS
// ===================================================

export const groupPrivacyEnum = pgEnum(
  'group_privacy',
  Object.values(GroupPrivacy) as [string, ...string[]],
);

export const groupStatusEnum = pgEnum(
  'group_status',
  Object.values(GroupStatus) as [string, ...string[]],
);

export const groupRoleEnum = pgEnum(
  'group_role',
  Object.values(GroupRole) as [string, ...string[]],
);

export const groupMemberStatusEnum = pgEnum(
  'group_member_status',
  Object.values(GroupMemberStatus) as [string, ...string[]],
);

export const inviteStatusEnum = pgEnum(
  'invite_status',
  Object.values(InviteStatus) as [string, ...string[]],
);

export const joinRequestStatusEnum = pgEnum(
  'join_request_status',
  Object.values(JoinRequestStatus) as [string, ...string[]],
);

export const groupEventLogEnum = pgEnum(
  'group_event_log',
  Object.values(GroupEventLog) as [string, ...string[]],
);

export const reportStatusEnum = pgEnum(
  'report_status',
  Object.values(ReportStatus) as [string, ...string[]],
);

// ===================================================
// TABLES
// ===================================================

export const groups = pgTable('groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 1000 }),
  avatar: jsonb('avatar').$type<{ publicId?: string; url?: string }>(),
  coverImage: jsonb('cover_image').$type<{ publicId?: string; url?: string }>(),
  privacy: groupPrivacyEnum('privacy').default(GroupPrivacy.PUBLIC).notNull(),
  rules: varchar('rules', { length: 10000 }),
  members: integer('members').default(1).notNull(),
  reports: integer('reports').default(0).notNull(),
  owner: jsonb('owner').$type<{
    id: string;
    fullName: string;
    avatarUrl?: string;
  }>(),
  status: groupStatusEnum('status').default(GroupStatus.ACTIVE).notNull(),
  createdBy: varchar('created_by', { length: 255 }),
  updatedBy: varchar('updated_by', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const groupSettings = pgTable('group_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id').notNull(),
  requiredPostApproval: boolean('required_post_approval').default(false).notNull(),
  allowMemberInvite: boolean('allow_member_invite').default(true).notNull(),
  maxMembers: integer('max_members').default(1000).notNull(),
  createdBy: varchar('created_by', { length: 255 }),
  updatedBy: varchar('updated_by', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const groupMembers = pgTable('group_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull(),
  groupId: uuid('group_id').notNull(),
  role: groupRoleEnum('role').default(GroupRole.MEMBER).notNull(),
  customPermissions: jsonb('custom_permissions').$type<string[]>(),
  status: groupMemberStatusEnum('status')
    .default(GroupMemberStatus.ACTIVE)
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const groupInvites = pgTable('group_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id').notNull(),
  inviteeId: varchar('invitee_id', { length: 255 }).notNull(),
  inviters: text('inviters').array(),
  status: inviteStatusEnum('status').default(InviteStatus.PENDING).notNull(),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const groupJoinRequests = pgTable('group_join_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id').notNull(),
  userId: varchar('user_id', { length: 255 }).notNull(),
  status: joinRequestStatusEnum('status')
    .default(JoinRequestStatus.PENDING)
    .notNull(),
  createdBy: varchar('created_by', { length: 255 }),
  updatedBy: varchar('updated_by', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const groupLogs = pgTable('group_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id').notNull(),
  userId: varchar('user_id', { length: 255 }).notNull(),
  eventType: groupEventLogEnum('event_type').notNull(),
  content: text('content'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const groupReports = pgTable(
  'group_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reporterId: varchar('reporter_id', { length: 255 }).notNull(),
    groupId: uuid('group_id').notNull(),
    reason: text('reason'),
    status: reportStatusEnum('status')
      .default(ReportStatus.PENDING)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueReporterGroup: uniqueIndex('unique_reporter_group').on(
      t.reporterId,
      t.groupId,
    ),
  }),
);

export const groupStatistics = pgTable('group_statistics', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id').notNull(),
  date: date('date').notNull(),
  postCount: integer('post_count').default(0).notNull(),
  joinCount: integer('join_count').default(0).notNull(),
  leaveCount: integer('leave_count').default(0).notNull(),
});

// ===================================================
// RELATIONS
// ===================================================

export const groupsRelations = relations(groups, ({ one, many }) => ({
  groupSetting: one(groupSettings, {
    fields: [groups.id],
    references: [groupSettings.groupId],
  }),
  groupMembers: many(groupMembers),
  groupInvites: many(groupInvites),
  groupJoinRequests: many(groupJoinRequests),
  groupLogs: many(groupLogs),
  groupReports: many(groupReports),
  statistics: many(groupStatistics),
}));

export const groupSettingsRelations = relations(groupSettings, ({ one }) => ({
  group: one(groups, {
    fields: [groupSettings.groupId],
    references: [groups.id],
  }),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, {
    fields: [groupMembers.groupId],
    references: [groups.id],
  }),
}));

export const groupInvitesRelations = relations(groupInvites, ({ one }) => ({
  group: one(groups, {
    fields: [groupInvites.groupId],
    references: [groups.id],
  }),
}));

export const groupJoinRequestsRelations = relations(
  groupJoinRequests,
  ({ one }) => ({
    group: one(groups, {
      fields: [groupJoinRequests.groupId],
      references: [groups.id],
    }),
  }),
);

export const groupLogsRelations = relations(groupLogs, ({ one }) => ({
  group: one(groups, {
    fields: [groupLogs.groupId],
    references: [groups.id],
  }),
}));

export const groupReportsRelations = relations(groupReports, ({ one }) => ({
  group: one(groups, {
    fields: [groupReports.groupId],
    references: [groups.id],
  }),
}));

export const groupStatisticsRelations = relations(
  groupStatistics,
  ({ one }) => ({
    group: one(groups, {
      fields: [groupStatistics.groupId],
      references: [groups.id],
    }),
  }),
);

// ===================================================
// INFERRED TYPES
// ===================================================

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupSetting = typeof groupSettings.$inferSelect;
export type NewGroupSetting = typeof groupSettings.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;
export type GroupInvite = typeof groupInvites.$inferSelect;
export type NewGroupInvite = typeof groupInvites.$inferInsert;
export type GroupJoinRequest = typeof groupJoinRequests.$inferSelect;
export type NewGroupJoinRequest = typeof groupJoinRequests.$inferInsert;
export type GroupLog = typeof groupLogs.$inferSelect;
export type NewGroupLog = typeof groupLogs.$inferInsert;
export type GroupReport = typeof groupReports.$inferSelect;
export type NewGroupReport = typeof groupReports.$inferInsert;
export type GroupStatistic = typeof groupStatistics.$inferSelect;
