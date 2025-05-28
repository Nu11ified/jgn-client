import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env";
import * as schema from "./schema";

// const globalForDb = globalThis as unknown as {
//   conn: postgres.Sql | undefined;
// };

// Create a new connection every time for testing
const conn = postgres(env.PG_URL);
// if (env.NODE_ENV !== "production") globalForDb.conn = conn;

//console.log("DEBUG: process.env.PG_URL:", process.env.PG_URL); // For direct check
//console.log("DEBUG: env.PG_URL from @/env:", env.PG_URL);     // For checking after t3-env processing
//console.log("DEBUG: postgres client object (conn) before drizzle:", conn);

export const postgrestDb = drizzle(conn, { schema });