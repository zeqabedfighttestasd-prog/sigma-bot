import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const staffApplicationDenialsTable = pgTable(
  "staff_application_denials",
  {
    applicantId: text("applicant_id").primaryKey(),
    deniedAt: timestamp("denied_at", { withTimezone: true }).notNull(),
  },
);

export type StaffApplicationDenial =
  typeof staffApplicationDenialsTable.$inferSelect;