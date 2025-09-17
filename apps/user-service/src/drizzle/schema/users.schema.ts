import { relations } from 'drizzle-orm';
import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { profiles } from './profiles.schema';
import { Many } from 'drizzle-orm';
import { userRoles } from './authorize.schema';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkId: varchar("clerk_id", { length: 255 }).notNull().unique(), // mapping sang Clerk user
  email: varchar("email", { length: 255 }).notNull(),
  username: varchar("username", { length: 50 }).notNull(),

  isActive: boolean("is_active").default(true).notNull(),
  deletedAt: timestamp("deleted_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});


export const userRelations = relations(users, ({one, many})=>({
  profile: one(profiles),
  userRoles:  many(userRoles)
}))
