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
  discord_id: number;
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
        return response.data as UserInDB;
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
          input, // requestBody is UserUpdateTsUid which matches the input schema
          {
            headers: { "X-API-Key": ctx.dbUser.apiKey },
          }
        );
        return response.data as UserInDB;
      } catch (error) {
        handleApiError(error, "updateMyTsUid");
      }
    }),
});

// export type UserRouter = typeof userRouter; // Optional: for type inference on client 