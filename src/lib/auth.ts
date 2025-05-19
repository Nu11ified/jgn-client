import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/server/db"; // your drizzle instance
import { env } from "@/env";
import { nextCookies } from "better-auth/next-js";
 
export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "mysql", // or "mysql", "sqlite"
    }),
    socialProviders: { 
        discord: { 
           clientId: env.DISCORD_CLIENT_ID, 
           clientSecret: env.DISCORD_CLIENT_SECRET, 
        }, 
    }, 
    plugins: [nextCookies()] 
});