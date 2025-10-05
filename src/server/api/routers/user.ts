import { z } from "zod";
import axios from "axios";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { env } from "@/env";

// Define the base URL for your FastAPI backend
const API_BASE_URL = (env.INTERNAL_API_URL as string | undefined) ?? "http://localhost:8000";

// Response Type Interface based on OpenAPI Spec
interface UserInDB {
  username: string;
  ts_uid: string | null;
  is_moderator: boolean;
  is_admin: boolean;
  discord_id: string;
  api_key: string;
  last_synced: string; // date-time
}

// Input schema for updating TS UID based on OpenAPI Spec
const UserUpdateTsUidSchema = z.object({
  ts_uid: z.string().max(28).nullable().optional(),
});

const handleApiError = (error: unknown, operation: string): never => {
  if (axios.isAxiosError(error)) {
    console.error(`Axios error during ${operation}:`, error.response?.data ?? error.message);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `API request failed for ${operation}: ${error.response?.statusText ?? error.message}`,
      cause: error.response?.data,
    });
  }
  console.error(`Unknown error during ${operation}:`, error);
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `An unknown error occurred during ${operation}.`,
    cause: error,
  });
};

export const userRouter = createTRPCRouter({
  // GET /profile/me
  getMe: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/profile/me`,
          {
            headers: { "X-API-Key": ctx.dbUser.apiKey },
          }
        );
        const user = response.data as UserInDB;
        return {
          ...user,
          discordId: user.discord_id,
        };
      } catch (error) {
        handleApiError(error, "getMe");
      }
    }),

  // PATCH /profile/me/ts_uid
  updateMyTsUid: protectedProcedure
    .input(UserUpdateTsUidSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const response = await axios.patch(
          `${API_BASE_URL}/profile/me/ts_uid`,
          input,
          {
            headers: { "X-API-Key": ctx.dbUser.apiKey },
          }
        );
        const user = response.data as UserInDB;
        return {
          ...user,
          discordId: user.discord_id,
        };
      } catch (error) {
        handleApiError(error, "updateMyTsUid");
      }
    }),

  // NEW: Manual TeamSpeak sync trigger
  syncTeamSpeak: protectedProcedure
    .mutation(async ({ ctx }) => {
      try {
        // First, get user profile to check if ts_uid is set
        const userResponse = await axios.get(
          `${API_BASE_URL}/profile/me`,
          {
            headers: { "X-API-Key": ctx.dbUser.apiKey },
          }
        );
        const user = userResponse.data as UserInDB;

        if (!user.ts_uid || user.ts_uid.trim() === '') {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "TeamSpeak UID not set. Please update your profile with your TeamSpeak UID first.",
          });
        }

        // Trigger sync by calling the sync endpoint with high priority
        const M2M_API_KEY = env.M2M_API_KEY as string | undefined;
        if (!M2M_API_KEY) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Sync service not configured. Please contact an administrator.",
          });
        }

        // Call the sync endpoint to queue this user for immediate sync
        const syncResponse = await axios.post(
          `${API_BASE_URL}/admin/sync/queue_user`,
          {
            discord_user_id: user.discord_id,
            priority: 2, // High priority
          },
          {
            headers: { "X-API-Key": M2M_API_KEY },
            timeout: 5000,
          }
        );

        console.log(`TeamSpeak sync queued for user ${user.discord_id}:`, syncResponse.data);

        return {
          success: true,
          message: "TeamSpeak sync queued successfully. Your groups will be updated within 1-2 minutes.",
          queuePosition: syncResponse.data?.queue_position ?? null,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        
        if (axios.isAxiosError(error)) {
          // Check if it's a 404 (sync endpoint doesn't exist)
          if (error.response?.status === 404) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Sync service endpoint not available. The service may be temporarily down.",
            });
          }
        }
        
        handleApiError(error, "syncTeamSpeak");
      }
    }),
});

// export type UserRouter = typeof userRouter; // Optional: for type inference on client 