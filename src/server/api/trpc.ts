/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { eq, and } from "drizzle-orm";

import { db } from "@/server/db";
import { auth } from "@/lib/auth";
import * as userSchema from "@/server/db/schema/user-schema";
import * as authSchema from "@/server/db/schema/auth-schema";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: opts.headers });
    console.log("[createTRPCContext] auth.api.getSession result:", session);
  } catch (error) {
    console.error("[createTRPCContext] Error calling auth.api.getSession:", error);
    // Potentially re-throw or handle, depending on desired behavior if session call fails
  }

  let dbUser: typeof userSchema.users.$inferSelect | null = null;
  const betterAuthUserId = session?.user?.id;
  console.log("[createTRPCContext] betterAuthUserId:", betterAuthUserId);

  if (betterAuthUserId) {
    let accountRecord: typeof authSchema.account.$inferSelect | undefined = undefined;
    try {
      console.log("[createTRPCContext] Attempting to fetch accountRecord for userId:", betterAuthUserId);
      accountRecord = await db
        .select()
        .from(authSchema.account)
        .where(
          and(
            eq(authSchema.account.userId, betterAuthUserId),
            eq(authSchema.account.providerId, "discord")
          )
        )
        .limit(1)
        .then((res) => res[0]);
      console.log("[createTRPCContext] Fetched accountRecord:", accountRecord);
    } catch (error) {
      console.error("[createTRPCContext] Error fetching accountRecord from DB:", error);
    }

    if (accountRecord?.accountId) {
      console.log("[createTRPCContext] accountRecord.accountId found:", accountRecord.accountId);
      try {
        const discordIdBigInt = BigInt(accountRecord.accountId);
        console.log("[createTRPCContext] Attempting to fetch userRecord for discordIdBigInt:", discordIdBigInt);
        
        const userRecord = await db
          .select()
          .from(userSchema.users)
          .where(eq(userSchema.users.discordId, discordIdBigInt))
          .limit(1)
          .then((res) => res[0]);
        console.log("[createTRPCContext] Fetched userRecord:", userRecord);

        if (userRecord) {
          dbUser = userRecord;
          console.log("[createTRPCContext] dbUser populated:", dbUser);
        } else {
          console.log("[createTRPCContext] No userRecord found for discordId:", discordIdBigInt);
        }
      } catch (e) {
        console.error("[createTRPCContext] Error processing accountRecord.accountId or fetching userRecord:", e);
        if (e instanceof Error && e.message.includes("Cannot convert")) {
          console.error("[createTRPCContext] Potential BigInt conversion error for accountId:", accountRecord.accountId);
        }
      }
    } else {
      console.log("[createTRPCContext] No accountRecord.accountId found or accountRecord is undefined.");
    }
  } else {
    console.log("[createTRPCContext] No betterAuthUserId provided or session is null.");
  }

  console.log("[createTRPCContext] Returning context with dbUser:", dbUser, "and session:", session);
  return {
    db,
    headers: opts.headers,
    session, // better-auth session
    dbUser,  // Your custom user record from userSchema.users (includes apiKey, isAdmin)
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
// Infer the context type that will be used in procedures
type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected procedure (authenticated users only)
 * Ensures session and dbUser (with apiKey and discordId) are present in context.
 */
export const protectedProcedure = t.procedure.use(timingMiddleware).use(
  async ({ ctx, next }) => {
    if (!ctx.session || !ctx.dbUser) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        // Types are narrowed: session and dbUser are non-nullable
        session: ctx.session,
        dbUser: ctx.dbUser,
        db: ctx.db,
        headers: ctx.headers,
      },
    });
  }
);

/**
 * Admin procedure (admin users only)
 * Ensures user is an admin and dbUser (with apiKey and discordId) is present.
 */
export const adminProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    // ctx.dbUser is already guaranteed to be non-null by protectedProcedure
    if (!ctx.dbUser.isAdmin) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next({
      ctx, // Context is already correctly typed and populated by protectedProcedure
    });
  }
);
