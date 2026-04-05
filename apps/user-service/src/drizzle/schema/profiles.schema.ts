import {
  customType,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";
import { relations, sql } from "drizzle-orm";
import { PRIVACY_LEVEL } from "src/constants";
export const privacyLevelEnum = pgEnum(
  "privacy_level",
  ...[Object.values(PRIVACY_LEVEL) as [string, ...string[]]]
);

const PROFILE_SEMANTIC_EMBEDDING_DIMENSIONS = 768;

const pgVector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? PROFILE_SEMANTIC_EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    if (typeof value !== "string") {
      return [];
    }

    const normalized = value.trim();
    if (!normalized.startsWith("[") || !normalized.endsWith("]")) {
      return [];
    }

    const inner = normalized.slice(1, -1).trim();
    if (!inner) {
      return [];
    }

    return inner
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
  },
});

export const profiles = pgTable("profiles", {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id, { onDelete: "cascade" }),

  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  avatarUrl: text("avatar_url"),
  coverImage: jsonb("cover_image"),
  bio: varchar("bio", { length: 255 }),
  location: varchar("location", { length: 120 }),
  jobTitle: varchar("job_title", { length: 120 }),
  company: varchar("company", { length: 120 }),
  school: varchar("school", { length: 120 }),
  interests: jsonb("interests").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  semanticProfileText: text("semantic_profile_text"),
  semanticEmbedding: pgVector("semantic_embedding", {
    dimensions: PROFILE_SEMANTIC_EMBEDDING_DIMENSIONS,
  }).$type<number[]>(),
  semanticEmbeddingUpdatedAt: timestamp("semantic_embedding_updated_at"),

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
