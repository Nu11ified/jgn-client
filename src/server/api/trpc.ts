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
  const session = await auth.api.getSession({ headers: opts.headers });
  let dbUser: typeof userSchema.users.$inferSelect | null = null;

  const betterAuthUserId = session?.user?.id; // Using optional chaining

  if (betterAuthUserId) {
    const accountRecord = await db
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

    if (accountRecord?.accountId) { // Optional chaining for accountId
      try {
        // userSchema.users.discordId is { mode: "number" }, so compare with Number
        const discordIdAsNumber = Number(accountRecord.accountId);
        if (isNaN(discordIdAsNumber)) {
          console.error("accountId from authSchema.account is not a valid number string:", accountRecord.accountId);
        } else {
          const userRecord = await db
            .select()
            .from(userSchema.users)
            .where(eq(userSchema.users.discordId, discordIdAsNumber))
            .limit(1)
            .then((res) => res[0]);
          if (userRecord) {
            dbUser = userRecord;
          }
        }
      } catch (e) {
        console.error("Error converting/fetching user by discordId:", e);
      }
    }
  }

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
