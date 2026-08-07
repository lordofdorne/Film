import { defineConfig } from "drizzle-kit";

/**
 * Drizzle owns the application tables and nothing else. pg-boss creates and
 * migrates its own tables in the `pgboss` schema; listing it here would produce
 * migrations that fight the queue on every deploy.
 */
export default defineConfig({
  schema: "./src/schema/tables.ts",
  out: "./migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATIONS ?? "" },
});
