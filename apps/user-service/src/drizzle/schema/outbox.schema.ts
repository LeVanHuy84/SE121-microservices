// outbox.schema.ts
import {
  pgEnum,
  pgTable,
  uuid,
  varchar,
  boolean,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { EVENT_DESTINATION } from 'src/constants';

export const eventDestinationEnum = pgEnum(
  'event_destination',
  Object.values(EVENT_DESTINATION) as [string, ...string[]]
);

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').defaultRandom().primaryKey(),

  destination: eventDestinationEnum('destination').notNull(),

  topic: varchar('topic', { length: 255 }).notNull(),

  eventType: varchar('event_type', { length: 255 }).notNull(),

  payload: jsonb('payload').$type<Record<string, any>>().notNull(),

  processed: boolean('processed').default(false).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
