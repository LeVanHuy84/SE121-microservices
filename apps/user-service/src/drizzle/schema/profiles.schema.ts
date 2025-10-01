import { pgTable, uuid, varchar, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.schema";
import { relations } from "drizzle-orm";
import { pgEnum } from "drizzle-orm/pg-core";
import { PRIVACY_LEVEL } from "src/constants";
export const privacyLevelEnum = pgEnum(
  "privacy_level",
  ...[Object.values(PRIVACY_LEVEL) as [string, ...string[]]]
);

export const profiles = pgTable("profiles", {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id, { onDelete: "cascade" }),

  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  avatarUrl: text("avatar_url"),
  coverImageUrl: text("cover_image_url"),
  bio: varchar("bio", { length: 255 }),

  stats: jsonb("stats").default({ friends: 0, posts: 0 }).notNull(),
  privacyLevel: privacyLevelEnum("privacy_level")
    .default(PRIVACY_LEVEL.PUBLIC)
    .notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const profileRelations = relations(profiles, ({ one }) => ({
  user: one(users, {
    fields: [profiles.userId],
    references: [users.id]
  })
}))
