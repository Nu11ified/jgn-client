import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { adminRouter } from "@/server/api/routers/admin";
import { userRouter } from "@/server/api/routers/user";
import { formRouter } from "@/server/api/routers/formRouter";
import { deptRouter } from "@/server/api/routers/deptRouter";
import { discordRouter } from "./routers/discordRouter";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
    admin: adminRouter,
    user: userRouter,
    form: formRouter,
    dept: deptRouter,
    discord: discordRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
