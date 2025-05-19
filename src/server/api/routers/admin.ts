import { z } from "zod";
import axios from "axios";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { env } from "@/env";

// Define the base URL for your FastAPI backend
const API_BASE_URL = (env.INTERNAL_API_URL as string | undefined) ?? "http://localhost:8000";

// Response Type Interfaces based on OpenAPI Spec
interface UserInDB {
  username: string;
  ts_uid: string | null;
  is_moderator: boolean;
  is_admin: boolean;
  discord_id: number;
  api_key: string;
  last_synced: string; // date-time
}

interface ServerInDB {
  server_name: string;
  server_id: number;
}

interface UserServerMembershipInDB {
  is_banned: boolean;
  joined_at: string | null; // date-time
  left_at: string | null; // date-time
  id: number;
  user_discord_id: number;
  server_id: number;
}

interface RoleInDB {
  role_name: string;
  server_id: number;
  role_id: number;
}

interface UserServerRoleInDB {
  user_discord_id: number;
  server_id: number;
  role_id: number;
  id: number;
}

interface BanHistoryInDB {
  server_id: number;
  banned_by_user_id: number | null;
  reason: string | null;
  id: number;
  user_discord_id: number;
  banned_at: string; // date-time
}

interface TeamSpeakServerGroupInDB {
  name: string;
  sgid: number;
}

interface UserTeamSpeakServerGroupInDB {
  user_discord_id: number;
  sgid: number;
  id: number;
}

interface DiscordRoleToTeamSpeakGroupMappingInDB {
  teamspeak_sgid: number;
  discord_role_id: number;
}

interface SuccessResponse {
  success: true;
}

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

export const adminRouter = createTRPCRouter({
  // User Admin Endpoints
  users: createTRPCRouter({
    // POST /admin/users/
    createUser: adminProcedure
      .input(
        z.object({
          username: z.string(),
          ts_uid: z.string().nullable().optional(),
          is_moderator: z.boolean().optional().default(false),
          is_admin: z.boolean().optional().default(false),
          discord_id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/users/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserInDB;
        } catch (error) {
          handleApiError(error, "createUser");
        }
      }),

    // GET /admin/users/
    listUsers: adminProcedure
      .input(
        z.object({
          skip: z.number().optional().default(0),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/users/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserInDB[];
        } catch (error) {
          handleApiError(error, "listUsers");
        }
      }),

    // GET /admin/users/{discord_id}
    getUser: adminProcedure
      .input(z.object({ discord_id: z.number() }))
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/users/${input.discord_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserInDB;
        } catch (error) {
          handleApiError(error, "getUser");
        }
      }),

    // PUT /admin/users/{discord_id}
    updateUser: adminProcedure
      .input(
        z.object({
          discord_id: z.number(),
          username: z.string().optional(),
          ts_uid: z.string().nullable().optional(),
          is_moderator: z.boolean().optional(),
          is_admin: z.boolean().optional(),
          api_key: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { discord_id, ...updateData } = input;
        try {
          const response = await axios.put(
            `${API_BASE_URL}/admin/users/${discord_id}`,
            updateData,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserInDB;
        } catch (error) {
          handleApiError(error, "updateUser");
        }
      }),

    // DELETE /admin/users/{discord_id}
    deleteUser: adminProcedure
      .input(z.object({ discord_id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/users/${input.discord_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return { success: true } as SuccessResponse;
        } catch (error) {
          handleApiError(error, "deleteUser");
        }
      }),
  }),

  // Server Admin Endpoints
  servers: createTRPCRouter({
    // POST /admin/servers/
    createServer: adminProcedure
      .input(
        z.object({
          server_name: z.string(),
          server_id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/servers/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as ServerInDB;
        } catch (error) {
          handleApiError(error, "createServer");
        }
      }),

    // GET /admin/servers/
    listServers: adminProcedure
      .input(
        z.object({
          skip: z.number().optional().default(0),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/servers/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as ServerInDB[];
        } catch (error) {
          handleApiError(error, "listServers");
        }
      }),

    // GET /admin/servers/{server_id}
    getServer: adminProcedure
      .input(z.object({ server_id: z.number() }))
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/servers/${input.server_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as ServerInDB;
        } catch (error) {
          handleApiError(error, "getServer");
        }
      }),

    // PUT /admin/servers/{server_id}
    updateServer: adminProcedure
      .input(
        z.object({
          server_id: z.number(),
          server_name: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { server_id, ...updateData } = input;
        try {
          const response = await axios.put(
            `${API_BASE_URL}/admin/servers/${server_id}`,
            updateData,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as ServerInDB;
        } catch (error) {
          handleApiError(error, "updateServer");
        }
      }),

    // DELETE /admin/servers/{server_id}
    deleteServer: adminProcedure
      .input(z.object({ server_id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/servers/${input.server_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return { success: true } as SuccessResponse;
        } catch (error) {
          handleApiError(error, "deleteServer");
        }
      }),
  }),

  // User Server Membership Admin Endpoints
  userServerMemberships: createTRPCRouter({
    // POST /admin/user_server_memberships/
    createUserServerMembership: adminProcedure
      .input(
        z.object({
          is_banned: z.boolean().optional().default(false),
          joined_at: z.string().datetime({ offset: true }).nullable().optional(),
          left_at: z.string().datetime({ offset: true }).nullable().optional(),
          user_discord_id: z.number(),
          server_id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/user_server_memberships/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserServerMembershipInDB;
        } catch (error) {
          handleApiError(error, "createUserServerMembership");
        }
      }),
    
    // GET /admin/user_server_memberships/
    listUserServerMemberships: adminProcedure
      .input(
        z.object({
          skip: z.number().optional().default(0),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/user_server_memberships/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserServerMembershipInDB[];
        } catch (error) {
          handleApiError(error, "listUserServerMemberships");
        }
      }),

    // GET /admin/user_server_memberships/users/{user_discord_id}/servers/{server_id}
    getUserServerMembership: adminProcedure
      .input(
        z.object({
          user_discord_id: z.number(),
          server_id: z.number(),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/user_server_memberships/users/${input.user_discord_id}/servers/${input.server_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserServerMembershipInDB;
        } catch (error) {
          handleApiError(error, "getUserServerMembership");
        }
      }),
    
    // PUT /admin/user_server_memberships/users/{user_discord_id}/servers/{server_id}
    updateUserServerMembership: adminProcedure
      .input(
        z.object({
          user_discord_id: z.number(),
          server_id: z.number(),
          is_banned: z.boolean().optional(),
          joined_at: z.string().datetime({ offset: true }).nullable().optional(),
          left_at: z.string().datetime({ offset: true }).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { user_discord_id, server_id, ...updateData } = input;
        try {
          const response = await axios.put(
            `${API_BASE_URL}/admin/user_server_memberships/users/${user_discord_id}/servers/${server_id}`,
            updateData,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserServerMembershipInDB;
        } catch (error) {
          handleApiError(error, "updateUserServerMembership");
        }
      }),

    // DELETE /admin/user_server_memberships/users/{user_discord_id}/servers/{server_id}
    deleteUserServerMembership: adminProcedure
      .input(
        z.object({
          user_discord_id: z.number(),
          server_id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/user_server_memberships/users/${input.user_discord_id}/servers/${input.server_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return { success: true } as SuccessResponse;
        } catch (error) {
          handleApiError(error, "deleteUserServerMembership");
        }
      }),
  }),

  // Role Admin Endpoints
  roles: createTRPCRouter({
    // POST /admin/roles/
    createRole: adminProcedure
      .input(
        z.object({
          role_name: z.string(),
          server_id: z.number(),
          role_id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/roles/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as RoleInDB;
        } catch (error) {
          handleApiError(error, "createRole");
        }
      }),

    // GET /admin/roles/
    listRoles: adminProcedure
      .input(
        z.object({
          skip: z.number().optional().default(0),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/roles/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as RoleInDB[];
        } catch (error) {
          handleApiError(error, "listRoles");
        }
      }),

    // GET /admin/roles/{role_id}
    getRole: adminProcedure
      .input(z.object({ role_id: z.number() }))
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/roles/${input.role_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as RoleInDB;
        } catch (error) {
          handleApiError(error, "getRole");
        }
      }),

    // PUT /admin/roles/{role_id}
    updateRole: adminProcedure
      .input(
        z.object({
          role_id: z.number(),
          role_name: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { role_id, ...updateData } = input;
        try {
          const response = await axios.put(
            `${API_BASE_URL}/admin/roles/${role_id}`,
            updateData,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as RoleInDB;
        } catch (error) {
          handleApiError(error, "updateRole");
        }
      }),

    // DELETE /admin/roles/{role_id}
    deleteRole: adminProcedure
      .input(z.object({ role_id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/roles/${input.role_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return { success: true } as SuccessResponse;
        } catch (error) {
          handleApiError(error, "deleteRole");
        }
      }),
  }),

  // User Server Role Admin Endpoints
  userServerRoles: createTRPCRouter({
    // POST /admin/user_server_roles/
    createUserServerRole: adminProcedure
      .input(
        z.object({
          user_discord_id: z.number(),
          server_id: z.number(),
          role_id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/user_server_roles/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserServerRoleInDB;
        } catch (error) {
          handleApiError(error, "createUserServerRole");
        }
      }),
    
    // GET /admin/user_server_roles/
    listUserServerRoles: adminProcedure
      .input(
        z.object({
          skip: z.number().optional().default(0),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/user_server_roles/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserServerRoleInDB[];
        } catch (error) {
          handleApiError(error, "listUserServerRoles");
        }
      }),

    // GET /admin/user_server_roles/users/{user_discord_id}/servers/{server_id}/roles/{role_id}
    getUserServerRole: adminProcedure
      .input(
        z.object({
          user_discord_id: z.number(),
          server_id: z.number(),
          role_id: z.number(),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/user_server_roles/users/${input.user_discord_id}/servers/${input.server_id}/roles/${input.role_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserServerRoleInDB;
        } catch (error) {
          handleApiError(error, "getUserServerRole");
        }
      }),

    // DELETE /admin/user_server_roles/users/{user_discord_id}/servers/{server_id}/roles/{role_id}
    deleteUserServerRole: adminProcedure
      .input(
        z.object({
          user_discord_id: z.number(),
          server_id: z.number(),
          role_id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/user_server_roles/users/${input.user_discord_id}/servers/${input.server_id}/roles/${input.role_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return { success: true } as SuccessResponse;
        } catch (error) {
          handleApiError(error, "deleteUserServerRole");
        }
      }),
  }),

  // Ban History Admin Endpoints
  banHistory: createTRPCRouter({
    // POST /admin/ban_history/
    createBanHistory: adminProcedure
      .input(
        z.object({
          server_id: z.number(),
          banned_by_user_id: z.number().nullable().optional(),
          reason: z.string().nullable().optional(),
          user_discord_id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/ban_history/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as BanHistoryInDB;
        } catch (error) {
          handleApiError(error, "createBanHistory");
        }
      }),

    // GET /admin/ban_history/
    listBanHistory: adminProcedure
      .input(
        z.object({
          skip: z.number().optional().default(0),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/ban_history/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as BanHistoryInDB[];
        } catch (error) {
          handleApiError(error, "listBanHistory");
        }
      }),
    
    // GET /admin/ban_history/{bh_id}
    getBanHistoryEntry: adminProcedure
      .input(z.object({ bh_id: z.number() }))
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/ban_history/${input.bh_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as BanHistoryInDB;
        } catch (error) {
          handleApiError(error, "getBanHistoryEntry");
        }
      }),

    // PUT /admin/ban_history/{bh_id}
    updateBanHistoryEntry: adminProcedure
      .input(
        z.object({
          bh_id: z.number(),
          reason: z.string().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { bh_id, ...updateData } = input;
        try {
          const response = await axios.put(
            `${API_BASE_URL}/admin/ban_history/${bh_id}`,
            updateData,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as BanHistoryInDB;
        } catch (error) {
          handleApiError(error, "updateBanHistoryEntry");
        }
      }),
    
    // DELETE /admin/ban_history/{bh_id}
    deleteBanHistoryEntry: adminProcedure
      .input(z.object({ bh_id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/ban_history/${input.bh_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return { success: true } as SuccessResponse;
        } catch (error) {
          handleApiError(error, "deleteBanHistoryEntry");
        }
      }),
  }),

  // TeamSpeak Server Group Admin Endpoints
  teamSpeakServerGroups: createTRPCRouter({
    // POST /admin/teamspeak_groups/
    createTsGroup: adminProcedure
      .input(
        z.object({
          name: z.string(),
          sgid: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/teamspeak_groups/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as TeamSpeakServerGroupInDB;
        } catch (error) {
          handleApiError(error, "createTsGroup");
        }
      }),

    // GET /admin/teamspeak_groups/
    listTsGroups: adminProcedure
      .input(
        z.object({
          skip: z.number().optional().default(0),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/teamspeak_groups/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as TeamSpeakServerGroupInDB[];
        } catch (error) {
          handleApiError(error, "listTsGroups");
        }
      }),

    // GET /admin/teamspeak_groups/{sgid}
    getTsGroup: adminProcedure
      .input(z.object({ sgid: z.number() }))
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/teamspeak_groups/${input.sgid}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as TeamSpeakServerGroupInDB;
        } catch (error) {
          handleApiError(error, "getTsGroup");
        }
      }),

    // PUT /admin/teamspeak_groups/{sgid}
    updateTsGroup: adminProcedure
      .input(
        z.object({
          sgid: z.number(),
          name: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { sgid, ...updateData } = input;
        try {
          const response = await axios.put(
            `${API_BASE_URL}/admin/teamspeak_groups/${sgid}`,
            updateData,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as TeamSpeakServerGroupInDB;
        } catch (error) {
          handleApiError(error, "updateTsGroup");
        }
      }),

    // DELETE /admin/teamspeak_groups/{sgid}
    deleteTsGroup: adminProcedure
      .input(z.object({ sgid: z.number() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/teamspeak_groups/${input.sgid}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return { success: true } as SuccessResponse;
        } catch (error) {
          handleApiError(error, "deleteTsGroup");
        }
      }),
    
    // POST /admin/teamspeak_groups/sync_from_ts_server
    syncAllTsGroups: adminProcedure
      .mutation(async ({ ctx }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/teamspeak_groups/sync_from_ts_server`,
            {}, // Empty body as per OpenAPI spec for this endpoint
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as object; // Expecting an empty JSON object {}
        } catch (error) {
          handleApiError(error, "syncAllTsGroups");
        }
      }),
  }),

  // User TeamSpeak Server Group Admin Endpoints
  userTeamSpeakServerGroups: createTRPCRouter({
    // POST /admin/user_teamspeak_groups/
    createUserTsGroup: adminProcedure
      .input(
        z.object({
          user_discord_id: z.number(),
          sgid: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/user_teamspeak_groups/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserTeamSpeakServerGroupInDB;
        } catch (error) {
          handleApiError(error, "createUserTsGroup");
        }
      }),

    // GET /admin/user_teamspeak_groups/
    listUserTsGroups: adminProcedure
      .input(
        z.object({
          skip: z.number().optional().default(0),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/user_teamspeak_groups/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserTeamSpeakServerGroupInDB[];
        } catch (error) {
          handleApiError(error, "listUserTsGroups");
        }
      }),
    
    // GET /admin/user_teamspeak_groups/users/{user_discord_id}/sgids/{sgid}
    getUserTsGroup: adminProcedure
      .input(
        z.object({
          user_discord_id: z.number(),
          sgid: z.number(),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/user_teamspeak_groups/users/${input.user_discord_id}/sgids/${input.sgid}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as UserTeamSpeakServerGroupInDB;
        } catch (error) {
          handleApiError(error, "getUserTsGroup");
        }
      }),
    
    // DELETE /admin/user_teamspeak_groups/users/{user_discord_id}/sgids/{sgid}
    deleteUserTsGroup: adminProcedure
      .input(
        z.object({
          user_discord_id: z.number(),
          sgid: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/user_teamspeak_groups/users/${input.user_discord_id}/sgids/${input.sgid}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return { success: true } as SuccessResponse;
        } catch (error) {
          handleApiError(error, "deleteUserTsGroup");
        }
      }),
  }),

  // Discord Role to TeamSpeak Group Mapping Admin Endpoints
  roleMappings: createTRPCRouter({
    // POST /admin/role_mappings/
    createRoleMapping: adminProcedure
      .input(
        z.object({
          teamspeak_sgid: z.number(),
          discord_role_id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/role_mappings/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as DiscordRoleToTeamSpeakGroupMappingInDB;
        } catch (error) {
          handleApiError(error, "createRoleMapping");
        }
      }),

    // GET /admin/role_mappings/
    listRoleMappings: adminProcedure
      .input(
        z.object({
          skip: z.number().optional().default(0),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/role_mappings/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as DiscordRoleToTeamSpeakGroupMappingInDB[];
        } catch (error) {
          handleApiError(error, "listRoleMappings");
        }
      }),
    
    // GET /admin/role_mappings/{discord_role_id}
    getRoleMapping: adminProcedure
      .input(z.object({ discord_role_id: z.number() }))
      .query(async ({ ctx, input }) => {
        try {
          const response = await axios.get(
            `${API_BASE_URL}/admin/role_mappings/${input.discord_role_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as DiscordRoleToTeamSpeakGroupMappingInDB;
        } catch (error) {
          handleApiError(error, "getRoleMapping");
        }
      }),

    // PUT /admin/role_mappings/{discord_role_id}
    updateRoleMapping: adminProcedure
      .input(
        z.object({
          discord_role_id: z.number(),
          teamspeak_sgid: z.number().optional(), // Based on DiscordRoleToTeamSpeakGroupMappingUpdate
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { discord_role_id, ...updateData } = input;
        try {
          const response = await axios.put(
            `${API_BASE_URL}/admin/role_mappings/${discord_role_id}`,
            updateData,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data as DiscordRoleToTeamSpeakGroupMappingInDB;
        } catch (error) {
          handleApiError(error, "updateRoleMapping");
        }
      }),

    // DELETE /admin/role_mappings/{discord_role_id}
    deleteRoleMapping: adminProcedure
      .input(z.object({ discord_role_id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/role_mappings/${input.discord_role_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return { success: true } as SuccessResponse;
        } catch (error) {
          handleApiError(error, "deleteRoleMapping");
        }
      }),
  }),
});

// export type AdminRouter = typeof adminRouter; // Optional: for type inference on client
