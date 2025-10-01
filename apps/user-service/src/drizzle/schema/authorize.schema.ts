import { pgTable, serial, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { primaryKey } from 'drizzle-orm/pg-core';
import { PgTable } from 'drizzle-orm/pg-core';
import { integer } from 'drizzle-orm/pg-core';
import { index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';


export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: varchar('description', { length: 255 }),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },

  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('user_idx').on(table.userId)
  ]
);
export const roleRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles)
}))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  roles: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id]
  }),
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id]
  })
}))
