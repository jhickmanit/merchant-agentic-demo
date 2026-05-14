import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const _placeholder = sqliteTable("_placeholder", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note").notNull().default("schema-stub-phase-0"),
});
