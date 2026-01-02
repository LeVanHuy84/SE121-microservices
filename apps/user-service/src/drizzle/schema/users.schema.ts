import { relations } from 'drizzle-orm';
import { boolean, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { userRoles } from './authorize.schema';
import { profiles } from './profiles.schema';
import { pgEnum } from 'drizzle-orm/pg-core';
import { USER_STATUS } from 'src/constants';

export const userStatusEnum = pgEnum(
  'user_status',
  ...[Object.values(USER_STATUS) as [string, ...string[]]]
);

export const users = pgTable('users', {
  id: varchar('id', { length: 255 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),

  isActive: boolean('is_active').default(true).notNull(),
  deletedAt: timestamp('deleted_at'),

  status: userStatusEnum('user_status').default(USER_STATUS.ACTIVE).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles),
  userRoles: many(userRoles),
}));
