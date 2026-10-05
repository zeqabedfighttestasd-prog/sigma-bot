import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const ticketsTable = pgTable("tickets", {
  channelId: text("channel_id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  details: jsonb("details").$type<Record<string, string>>().notNull(),
  memberCount: integer("member_count"),
  screenshotUrl: text("screenshot_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const ticketRejectionsTable = pgTable(
  "ticket_rejections",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => ticketsTable.channelId, { onDelete: "cascade" }),
    staffId: text("staff_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({
      columns: [table.channelId, table.staffId],
    }),
  }),
);

export type Ticket = typeof ticketsTable.$inferSelect;
export type TicketRejection = typeof ticketRejectionsTable.$inferSelect;