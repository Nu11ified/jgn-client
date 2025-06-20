import { z } from "zod";
import axios from "axios";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { env } from "@/env";
import {
  ZodUserInDB,
  ZodServerInDB,
  ZodUserServerMembershipInDB,
  ZodRoleInDB,
  ZodUserServerRoleInDB,
  ZodBanHistoryInDB,
  ZodTeamSpeakServerGroupInDB,
  ZodUserTeamSpeakServerGroupInDB,
  ZodDiscordRoleToTeamSpeakGroupMappingInDB,
  type UserInDB,
  type ServerInDB,
  type UserServerMembershipInDB,
  type RoleInDB,
  type UserServerRoleInDB,
  type BanHistoryInDB,
  type TeamSpeakServerGroupInDB,
  type UserTeamSpeakServerGroupInDB,
  type DiscordRoleToTeamSpeakGroupMappingInDB,
} from "@/server/api/shared-types";

// Define the base URL for your FastAPI backend
const API_BASE_URL = (env.INTERNAL_API_URL as string | undefined) ?? "http://localhost:8000";

// --- Zod Schemas based on OpenAPI Spec ---

// Validation Error Schemas
const ZodValidationError = z.object({
  loc: z.array(z.union([z.string(), z.number()])),
  msg: z.string(),
  type: z.string(),
});

// Create/Update schemas (these remain local as they differ from the main schemas)
const ZodUserCreate = z.object({
  username: z.string(),
  ts_uid: z.string().nullable().optional(),
  is_moderator: z.boolean().default(false).optional(),
  is_admin: z.boolean().default(false).optional(),
  discord_id: z.string(),
});

const ZodUserUpdate = z.object({
  username: z.string().nullable().optional(),
  ts_uid: z.string().nullable().optional(),
  is_moderator: z.boolean().nullable().optional(),
  is_admin: z.boolean().nullable().optional(),
  api_key: z.string().nullable().optional(),
});

const ZodServerCreate = z.object({
  server_name: z.string(),
  server_id: z.string(),
});

const ZodServerUpdate = z.object({
  server_name: z.string().nullable().optional(),
});

const ZodUserServerMembershipCreate = z.object({
  is_banned: z.boolean().default(false).optional(),
  joined_at: z.string().datetime().nullable().optional(),
  left_at: z.string().datetime().nullable().optional(),
  user_discord_id: z.string(),
  server_id: z.string(),
});

const ZodUserServerMembershipUpdate = z.object({
  is_banned: z.boolean().nullable().optional(),
  joined_at: z.string().datetime().nullable().optional(),
  left_at: z.string().datetime().nullable().optional(),
});

const ZodRoleCreate = z.object({
  role_name: z.string(),
  server_id: z.string(),
  role_id: z.string(),
});

const ZodRoleUpdate = z.object({
  role_name: z.string().nullable().optional(),
});

const ZodUserServerRoleCreate = z.object({
  user_discord_id: z.string(),
  server_id: z.string(),
  role_id: z.string(),
});

const ZodBanHistoryCreate = z.object({
  server_id: z.string(),
  banned_by_user_id: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  user_discord_id: z.string(),
});

const ZodBanHistoryUpdate = z.object({
  reason: z.string().nullable().optional(),
});

const ZodTeamSpeakServerGroupCreate = z.object({
  name: z.string(),
  sgid: z.number().int(),
});

const ZodTeamSpeakServerGroupUpdate = z.object({
  name: z.string().nullable().optional(),
});

const ZodUserTeamSpeakServerGroupCreate = z.object({
  user_discord_id: z.string(),
  sgid: z.number().int(),
});

const ZodDiscordRoleToTeamSpeakGroupMappingCreate = z.object({
  teamspeak_sgid: z.number().int(),
  discord_role_id: z.string(),
});

const ZodDiscordRoleToTeamSpeakGroupMappingUpdate = z.object({
  teamspeak_sgid: z.number().int().nullable().optional(),
});

// --- End of Zod Schemas ---

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
      .input(ZodUserCreate)
      .output(ZodUserInDB)
      .mutation(async ({ ctx, input }): Promise<UserInDB> => {
        try {
          const response = await axios.post<UserInDB>(
            `${API_BASE_URL}/admin/users/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "createUser");
        }
      }),

    // GET /admin/users/
    listUsers: adminProcedure
      .input(
        z.object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(1000),
        })
      )
      .output(z.array(ZodUserInDB))
      .query(async ({ ctx, input }): Promise<UserInDB[]> => {
        try {
          const response = await axios.get<UserInDB[]>(
            `${API_BASE_URL}/admin/users/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "listUsers");
        }
      }),

    // GET /admin/users/{discord_id}
    getUser: adminProcedure
      .input(z.object({ discord_id: z.string() }))
      .output(ZodUserInDB)
      .query(async ({ ctx, input }): Promise<UserInDB> => {
        try {
          const response = await axios.get<UserInDB>(
            `${API_BASE_URL}/admin/users/${input.discord_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "getUser");
        }
      }),

    // PUT /admin/users/{discord_id}
    updateUser: adminProcedure
      .input(
        ZodUserUpdate.extend({
          discord_id: z.string(),
        })
      )
      .output(ZodUserInDB)
      .mutation(async ({ ctx, input }): Promise<UserInDB> => {
        const { discord_id, ...updateData } = input;
        try {
          const response = await axios.put<UserInDB>(
            `${API_BASE_URL}/admin/users/${discord_id}`,
            updateData,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "updateUser");
        }
      }),

    // DELETE /admin/users/{discord_id}
    deleteUser: adminProcedure
      .input(z.object({ discord_id: z.string() }))
      .mutation(async ({ ctx, input }): Promise<void> => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/users/${input.discord_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return;
        } catch (error) {
          return handleApiError(error, "deleteUser");
        }
      }),
  }),

  // Server Admin Endpoints
  servers: createTRPCRouter({
    // POST /admin/servers/
    createServer: adminProcedure
      .input(ZodServerCreate)
      .output(ZodServerInDB)
      .mutation(async ({ ctx, input }): Promise<ServerInDB> => {
        try {
          const response = await axios.post<ServerInDB>(
            `${API_BASE_URL}/admin/servers/`,
            input,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "createServer");
        }
      }),

    // GET /admin/servers/
    listServers: adminProcedure
      .input(
        z.object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(1000),
        })
      )
      .output(z.array(ZodServerInDB))
      .query(async ({ ctx, input }): Promise<ServerInDB[]> => {
        try {
          const response = await axios.get<ServerInDB[]>(
            `${API_BASE_URL}/admin/servers/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "listServers");
        }
      }),

    // GET /admin/servers/{server_id}
    getServer: adminProcedure
      .input(z.object({ server_id: z.string() }))
      .output(ZodServerInDB)
      .query(async ({ ctx, input }): Promise<ServerInDB> => {
        try {
          const response = await axios.get<ServerInDB>(
            `${API_BASE_URL}/admin/servers/${input.server_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "getServer");
        }
      }),

    // PUT /admin/servers/{server_id}
    updateServer: adminProcedure
      .input(
        ZodServerUpdate.extend({
          server_id: z.string(),
        })
      )
      .output(ZodServerInDB)
      .mutation(async ({ ctx, input }): Promise<ServerInDB> => {
        const { server_id, ...updateData } = input;
        try {
          const response = await axios.put<ServerInDB>(
            `${API_BASE_URL}/admin/servers/${server_id}`,
            updateData,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "updateServer");
        }
      }),

    // DELETE /admin/servers/{server_id}
    deleteServer: adminProcedure
      .input(z.object({ server_id: z.string() }))
      .mutation(async ({ ctx, input }): Promise<void> => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/servers/${input.server_id}`,
            {
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return;
        } catch (error) {
          return handleApiError(error, "deleteServer");
        }
      }),
  }),

  // User Server Memberships Admin Endpoints
  userServerMemberships: createTRPCRouter({
    // POST /admin/user_server_memberships/
    createUserServerMembership: adminProcedure
      .input(ZodUserServerMembershipCreate)
      .output(ZodUserServerMembershipInDB)
      .mutation(async ({ ctx, input }): Promise<UserServerMembershipInDB> => {
        try {
          const response = await axios.post<UserServerMembershipInDB>(
            `${API_BASE_URL}/admin/user_server_memberships/`,
            input,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "createUserServerMembership");
        }
      }),
    
    // GET /admin/user_server_memberships/
    listUserServerMemberships: adminProcedure
      .input(
        z.object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(1000),
        })
      )
      .output(z.array(ZodUserServerMembershipInDB))
      .query(async ({ ctx, input }): Promise<UserServerMembershipInDB[]> => {
        try {
          const response = await axios.get<UserServerMembershipInDB[]>(
            `${API_BASE_URL}/admin/user_server_memberships/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "listUserServerMemberships");
        }
      }),

    // GET /admin/user_server_memberships/users/{user_discord_id}/servers/{server_id}
    getUserServerMembership: adminProcedure
      .input(z.object({ user_discord_id: z.string(), server_id: z.string() }))
      .output(ZodUserServerMembershipInDB)
      .query(async ({ ctx, input }): Promise<UserServerMembershipInDB> => {
        try {
          const response = await axios.get<UserServerMembershipInDB>(
            `${API_BASE_URL}/admin/user_server_memberships/users/${input.user_discord_id}/servers/${input.server_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "getUserServerMembership");
        }
      }),
    
    // PUT /admin/user_server_memberships/users/{user_discord_id}/servers/{server_id}
    updateUserServerMembership: adminProcedure
      .input(
        ZodUserServerMembershipUpdate.extend({
          user_discord_id: z.string(),
          server_id: z.string(),
        })
      )
      .output(ZodUserServerMembershipInDB)
      .mutation(async ({ ctx, input }): Promise<UserServerMembershipInDB> => {
        const { user_discord_id, server_id, ...updateData } = input;
        try {
          const response = await axios.put<UserServerMembershipInDB>(
            `${API_BASE_URL}/admin/user_server_memberships/users/${user_discord_id}/servers/${server_id}`,
            updateData,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "updateUserServerMembership");
        }
      }),

    // DELETE /admin/user_server_memberships/users/{user_discord_id}/servers/{server_id}
    deleteUserServerMembership: adminProcedure
      .input(z.object({ user_discord_id: z.string(), server_id: z.string() }))
      .mutation(async ({ ctx, input }): Promise<void> => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/user_server_memberships/users/${input.user_discord_id}/servers/${input.server_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return;
        } catch (error) {
          return handleApiError(error, "deleteUserServerMembership");
        }
      }),
  }),

  // Role Admin Endpoints
  roles: createTRPCRouter({
    // POST /admin/roles/
    createRole: adminProcedure
      .input(ZodRoleCreate)
      .output(ZodRoleInDB)
      .mutation(async ({ ctx, input }): Promise<RoleInDB> => {
        try {
          const response = await axios.post<RoleInDB>(
            `${API_BASE_URL}/admin/roles/`,
            input,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "createRole");
        }
      }),

    // GET /admin/roles/
    listRoles: adminProcedure
      .input(
        z.object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(1000),
        })
      )
      .output(z.array(ZodRoleInDB))
      .query(async ({ ctx, input }): Promise<RoleInDB[]> => {
        try {
          const response = await axios.get<RoleInDB[]>(
            `${API_BASE_URL}/admin/roles/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "listRoles");
        }
      }),

    // GET /admin/roles/{role_id}
    getRole: adminProcedure
      .input(z.object({ role_id: z.string() }))
      .output(ZodRoleInDB)
      .query(async ({ ctx, input }): Promise<RoleInDB> => {
        try {
          const response = await axios.get<RoleInDB>(
            `${API_BASE_URL}/admin/roles/${input.role_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "getRole");
        }
      }),

    // PUT /admin/roles/{role_id}
    updateRole: adminProcedure
      .input(
        ZodRoleUpdate.extend({
          role_id: z.string(),
        })
      )
      .output(ZodRoleInDB)
      .mutation(async ({ ctx, input }): Promise<RoleInDB> => {
        const { role_id, ...updateData } = input;
        try {
          const response = await axios.put<RoleInDB>(
            `${API_BASE_URL}/admin/roles/${role_id}`,
            updateData,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "updateRole");
        }
      }),
    
    // DELETE /admin/roles/{role_id}
    deleteRole: adminProcedure
      .input(z.object({ role_id: z.string() }))
      .mutation(async ({ ctx, input }): Promise<void> => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/roles/${input.role_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return;
        } catch (error) {
          return handleApiError(error, "deleteRole");
        }
      }),
  }),

  // User Server Roles Admin Endpoints
  userServerRoles: createTRPCRouter({
    // POST /admin/user_server_roles/
    createUserServerRole: adminProcedure
      .input(ZodUserServerRoleCreate)
      .output(ZodUserServerRoleInDB)
      .mutation(async ({ ctx, input }): Promise<UserServerRoleInDB> => {
        try {
          const response = await axios.post<UserServerRoleInDB>(
            `${API_BASE_URL}/admin/user_server_roles/`,
            input,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "createUserServerRole");
        }
      }),

    // GET /admin/user_server_roles/
    listUserServerRoles: adminProcedure
      .input(
        z.object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(1000),
        })
      )
      .output(z.array(ZodUserServerRoleInDB))
      .query(async ({ ctx, input }): Promise<UserServerRoleInDB[]> => {
        try {
          const response = await axios.get<UserServerRoleInDB[]>(
            `${API_BASE_URL}/admin/user_server_roles/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "listUserServerRoles");
        }
      }),

    // GET /admin/user_server_roles/users/{user_discord_id}/servers/{server_id}/roles/{role_id}
    getUserServerRole: adminProcedure
      .input(z.object({ user_discord_id: z.string(), server_id: z.string(), role_id: z.string() }))
      .output(ZodUserServerRoleInDB)
      .query(async ({ ctx, input }): Promise<UserServerRoleInDB> => {
        try {
          const response = await axios.get<UserServerRoleInDB>(
            `${API_BASE_URL}/admin/user_server_roles/users/${input.user_discord_id}/servers/${input.server_id}/roles/${input.role_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "getUserServerRole");
        }
      }),
    
    // DELETE /admin/user_server_roles/users/{user_discord_id}/servers/{server_id}/roles/{role_id}
    deleteUserServerRole: adminProcedure
      .input(z.object({ user_discord_id: z.string(), server_id: z.string(), role_id: z.string() }))
      .mutation(async ({ ctx, input }): Promise<void> => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/user_server_roles/users/${input.user_discord_id}/servers/${input.server_id}/roles/${input.role_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return;
        } catch (error) {
          return handleApiError(error, "deleteUserServerRole");
        }
      }),
  }),

  // Ban History Admin Endpoints
  banHistory: createTRPCRouter({
    // POST /admin/ban_history/
    createBanHistory: adminProcedure
      .input(ZodBanHistoryCreate)
      .output(ZodBanHistoryInDB)
      .mutation(async ({ ctx, input }): Promise<BanHistoryInDB> => {
        try {
          const response = await axios.post<BanHistoryInDB>(
            `${API_BASE_URL}/admin/ban_history/`,
            input,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "createBanHistory");
        }
      }),

    // GET /admin/ban_history/
    listBanHistory: adminProcedure
      .input(
        z.object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(1000),
        })
      )
      .output(z.array(ZodBanHistoryInDB))
      .query(async ({ ctx, input }): Promise<BanHistoryInDB[]> => {
        try {
          const response = await axios.get<BanHistoryInDB[]>(
            `${API_BASE_URL}/admin/ban_history/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "listBanHistory");
        }
      }),

    // GET /admin/ban_history/{bh_id}
    getBanHistoryEntry: adminProcedure
      .input(z.object({ bh_id: z.number().int() }))
      .output(ZodBanHistoryInDB)
      .query(async ({ ctx, input }): Promise<BanHistoryInDB> => {
        try {
          const response = await axios.get<BanHistoryInDB>(
            `${API_BASE_URL}/admin/ban_history/${input.bh_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "getBanHistoryEntry");
        }
      }),

    // PUT /admin/ban_history/{bh_id}
    updateBanHistoryEntry: adminProcedure
      .input(
        ZodBanHistoryUpdate.extend({
          bh_id: z.number().int(),
        })
      )
      .output(ZodBanHistoryInDB)
      .mutation(async ({ ctx, input }): Promise<BanHistoryInDB> => {
        const { bh_id, ...updateData } = input;
        try {
          const response = await axios.put<BanHistoryInDB>(
            `${API_BASE_URL}/admin/ban_history/${bh_id}`,
            updateData,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "updateBanHistoryEntry");
        }
      }),
    
    // DELETE /admin/ban_history/{bh_id}
    deleteBanHistoryEntry: adminProcedure
      .input(z.object({ bh_id: z.number().int() }))
      .mutation(async ({ ctx, input }): Promise<void> => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/ban_history/${input.bh_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return;
        } catch (error) {
          return handleApiError(error, "deleteBanHistoryEntry");
        }
      }),
  }),

  // TeamSpeak Server Groups Admin Endpoints
  teamSpeakGroups: createTRPCRouter({
    // POST /admin/teamspeak_groups/
    createTsGroup: adminProcedure
      .input(ZodTeamSpeakServerGroupCreate)
      .output(ZodTeamSpeakServerGroupInDB)
      .mutation(async ({ ctx, input }): Promise<TeamSpeakServerGroupInDB> => {
        try {
          const response = await axios.post<TeamSpeakServerGroupInDB>(
            `${API_BASE_URL}/admin/teamspeak_groups/`,
            input,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "createTsGroup");
        }
      }),

    // GET /admin/teamspeak_groups/
    listTsGroups: adminProcedure
      .input(
        z.object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(1000),
        })
      )
      .output(z.array(ZodTeamSpeakServerGroupInDB))
      .query(async ({ ctx, input }): Promise<TeamSpeakServerGroupInDB[]> => {
        try {
          const response = await axios.get<TeamSpeakServerGroupInDB[]>(
            `${API_BASE_URL}/admin/teamspeak_groups/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "listTsGroups");
        }
      }),

    // GET /admin/teamspeak_groups/{sgid}
    getTsGroup: adminProcedure
      .input(z.object({ sgid: z.number().int() }))
      .output(ZodTeamSpeakServerGroupInDB)
      .query(async ({ ctx, input }): Promise<TeamSpeakServerGroupInDB> => {
        try {
          const response = await axios.get<TeamSpeakServerGroupInDB>(
            `${API_BASE_URL}/admin/teamspeak_groups/${input.sgid}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "getTsGroup");
        }
      }),

    // PUT /admin/teamspeak_groups/{sgid}
    updateTsGroup: adminProcedure
      .input(
        ZodTeamSpeakServerGroupUpdate.extend({
          sgid: z.number().int(),
        })
      )
      .output(ZodTeamSpeakServerGroupInDB)
      .mutation(async ({ ctx, input }): Promise<TeamSpeakServerGroupInDB> => {
        const { sgid, ...updateData } = input;
        try {
          const response = await axios.put<TeamSpeakServerGroupInDB>(
            `${API_BASE_URL}/admin/teamspeak_groups/${sgid}`,
            updateData,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "updateTsGroup");
        }
      }),

    // DELETE /admin/teamspeak_groups/{sgid}
    deleteTsGroup: adminProcedure
      .input(z.object({ sgid: z.number().int() }))
      .mutation(async ({ ctx, input }): Promise<void> => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/teamspeak_groups/${input.sgid}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return;
        } catch (error) {
          return handleApiError(error, "deleteTsGroup");
        }
      }),
    
    // POST /admin/teamspeak_groups/sync_from_ts_server
    adminSyncAllTsGroups: adminProcedure
      .output(z.object({}).passthrough())
      .mutation(async ({ ctx }): Promise<Record<string, unknown>> => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/admin/teamspeak_groups/sync_from_ts_server`,
            {},
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data as Record<string, unknown>;
        } catch (error) {
          return handleApiError(error, "adminSyncAllTsGroups");
        }
      }),
  }),

  // User TeamSpeak Server Groups Admin Endpoints
  userTeamSpeakGroups: createTRPCRouter({
    // POST /admin/user_teamspeak_groups/
    createUserTsGroup: adminProcedure
      .input(ZodUserTeamSpeakServerGroupCreate)
      .output(ZodUserTeamSpeakServerGroupInDB)
      .mutation(async ({ ctx, input }): Promise<UserTeamSpeakServerGroupInDB> => {
        try {
          const response = await axios.post<UserTeamSpeakServerGroupInDB>(
            `${API_BASE_URL}/admin/user_teamspeak_groups/`,
            input,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "createUserTsGroup");
        }
      }),

    // GET /admin/user_teamspeak_groups/
    listUserTsGroups: adminProcedure
      .input(
        z.object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(1000),
        })
      )
      .output(z.array(ZodUserTeamSpeakServerGroupInDB))
      .query(async ({ ctx, input }): Promise<UserTeamSpeakServerGroupInDB[]> => {
        try {
          const response = await axios.get<UserTeamSpeakServerGroupInDB[]>(
            `${API_BASE_URL}/admin/user_teamspeak_groups/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "listUserTsGroups");
        }
      }),

    // GET /admin/user_teamspeak_groups/users/{user_discord_id}/sgids/{sgid}
    getUserTsGroup: adminProcedure
      .input(z.object({ user_discord_id: z.string(), sgid: z.number().int() }))
      .output(ZodUserTeamSpeakServerGroupInDB)
      .query(async ({ ctx, input }): Promise<UserTeamSpeakServerGroupInDB> => {
        try {
          const response = await axios.get<UserTeamSpeakServerGroupInDB>(
            `${API_BASE_URL}/admin/user_teamspeak_groups/users/${input.user_discord_id}/sgids/${input.sgid}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "getUserTsGroup");
        }
      }),
    
    // DELETE /admin/user_teamspeak_groups/users/{user_discord_id}/sgids/{sgid}
    deleteUserTsGroup: adminProcedure
      .input(z.object({ user_discord_id: z.string(), sgid: z.number().int() }))
      .mutation(async ({ ctx, input }): Promise<void> => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/user_teamspeak_groups/users/${input.user_discord_id}/sgids/${input.sgid}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return;
        } catch (error) {
          return handleApiError(error, "deleteUserTsGroup");
        }
      }),
  }),

  // Discord Role to TeamSpeak Group Mappings Admin Endpoints
  roleMappings: createTRPCRouter({
    // POST /admin/role_mappings/
    createRoleMapping: adminProcedure
      .input(ZodDiscordRoleToTeamSpeakGroupMappingCreate)
      .output(ZodDiscordRoleToTeamSpeakGroupMappingInDB)
      .mutation(async ({ ctx, input }): Promise<DiscordRoleToTeamSpeakGroupMappingInDB> => {
        try {
          const response = await axios.post<DiscordRoleToTeamSpeakGroupMappingInDB>(
            `${API_BASE_URL}/admin/role_mappings/`,
            input,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "createRoleMapping");
        }
      }),

    // GET /admin/role_mappings/
    listRoleMappings: adminProcedure
      .input(
        z.object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(1000),
        })
      )
      .output(z.array(ZodDiscordRoleToTeamSpeakGroupMappingInDB))
      .query(async ({ ctx, input }): Promise<DiscordRoleToTeamSpeakGroupMappingInDB[]> => {
        try {
          const response = await axios.get<DiscordRoleToTeamSpeakGroupMappingInDB[]>(
            `${API_BASE_URL}/admin/role_mappings/`,
            {
              params: input,
              headers: { "X-API-Key": ctx.dbUser.apiKey },
            }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "listRoleMappings");
        }
      }),

    // GET /admin/role_mappings/{discord_role_id}
    getRoleMapping: adminProcedure
      .input(z.object({ discord_role_id: z.string() }))
      .output(ZodDiscordRoleToTeamSpeakGroupMappingInDB)
      .query(async ({ ctx, input }): Promise<DiscordRoleToTeamSpeakGroupMappingInDB> => {
        try {
          const response = await axios.get<DiscordRoleToTeamSpeakGroupMappingInDB>(
            `${API_BASE_URL}/admin/role_mappings/${input.discord_role_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "getRoleMapping");
        }
      }),

    // PUT /admin/role_mappings/{discord_role_id}
    updateRoleMapping: adminProcedure
      .input(
        ZodDiscordRoleToTeamSpeakGroupMappingUpdate.extend({
          discord_role_id: z.string(),
        })
      )
      .output(ZodDiscordRoleToTeamSpeakGroupMappingInDB)
      .mutation(async ({ ctx, input }): Promise<DiscordRoleToTeamSpeakGroupMappingInDB> => {
        const { discord_role_id, ...updateData } = input;
        try {
          const response = await axios.put<DiscordRoleToTeamSpeakGroupMappingInDB>(
            `${API_BASE_URL}/admin/role_mappings/${discord_role_id}`,
            updateData,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return response.data;
        } catch (error) {
          return handleApiError(error, "updateRoleMapping");
        }
      }),
    
    // DELETE /admin/role_mappings/{discord_role_id}
    deleteRoleMapping: adminProcedure
      .input(z.object({ discord_role_id: z.string() }))
      .mutation(async ({ ctx, input }): Promise<void> => {
        try {
          await axios.delete(
            `${API_BASE_URL}/admin/role_mappings/${input.discord_role_id}`,
            { headers: { "X-API-Key": ctx.dbUser.apiKey } }
          );
          return;
        } catch (error) {
          return handleApiError(error, "deleteRoleMapping");
        }
      }),
  }),
});

// Export type router type signature, NOT the router itself.
// export type AdminRouter = typeof adminRouter; // This is usually done in the root router file

