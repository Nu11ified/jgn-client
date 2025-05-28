// drizzle.pg.config.ts
import { defineConfig } from "drizzle-kit";
import { env } from "@/env";

export default defineConfig({
  dialect: "postgresql",
  // Point to your PostgreSQL schema files.
  // This can be a glob pattern or an array of paths.
  schema: [
    "./src/server/postgres/schema.ts",
  ],
  out: "./drizzle/postgres", 
  dbCredentials: {
    url: env.PG_URL, 
  },
  verbose: true, // Optional: for more detailed output
  strict: false,   // Optional: set to true to always ask for approval
});