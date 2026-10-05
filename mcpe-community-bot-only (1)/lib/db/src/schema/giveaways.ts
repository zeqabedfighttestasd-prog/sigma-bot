import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const giveawaysTable = pgTable("giveaways", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull().unique(),
  prize: text("prize").notNull(),
  winners: integer("winners").notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const giveawayEntriesTable = pgTable(
  "giveaway_entries",
  {
    giveawayId: text("giveaway_id")
      .notNull()
      .references(() => giveawaysTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({
      columns: [table.giveawayId, table.userId],
    }),
  }),
);

export type Giveaway = typeof giveawaysTable.$inferSelect;
export type GiveawayEntry = typeof giveawayEntriesTable.$inferSelect;