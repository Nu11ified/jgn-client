import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { updateUserRankFromDiscordRoles } from "../services/department/rankSyncService";
import { updateUserTeamFromDiscordRoles } from "../services/department/teamSyncService";
import { fetchUserDiscordRoles } from "../services/department/discordRoleManager";

// Simple in-memory guards to prevent duplicate, bursty updates per user
const activeDiscordUpdates = new Set<string>();
const lastDiscordUpdateAt = new Map<string, number>();
const DISCORD_UPDATE_COOLDOWN_MS = 2000; // 2s soft cooldown to smooth bursts

const validateApiKey = (apiKey: string): boolean => {
    const validApiKey = process.env.DEPARTMENT_TRAINING_API_KEY;
    if (!validApiKey) {
      console.error("⚠️ Training API key not configured in environment");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Training API key not configured",
      });
    }
  
    if (apiKey.length !== validApiKey.length) {
      return false;
    }
  
    let mismatch = 0;
    for (let i = 0; i < apiKey.length; i++) {
      mismatch |= apiKey.charCodeAt(i) ^ validApiKey.charCodeAt(i);
    }
  
    return mismatch === 0;
};
  

export const discordRouter = createTRPCRouter({
    onDiscordUpdate: publicProcedure
        .input(
            z.object({
                apiKey: z.string().min(1, "API key is required"),
                discordId: z.string().min(1, "Discord ID is required"),
            })
        )
        .mutation(async ({ input }) => {
            if (!validateApiKey(input.apiKey)) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "Invalid API key",
                });
            }

            const discordId = input.discordId;
            console.log(`Received Discord update for user: ${discordId}`);

            // Drop duplicate in-flight requests for the same user
            if (activeDiscordUpdates.has(discordId)) {
                return {
                    success: true,
                    message: `Update already in progress for ${discordId}. Skipping duplicate.`,
                };
            }

            // Soft cooldown to smooth bursts for the same user
            const lastAt = lastDiscordUpdateAt.get(discordId);
            if (lastAt && Date.now() - lastAt < DISCORD_UPDATE_COOLDOWN_MS) {
                return {
                    success: true,
                    message: `Update for ${discordId} skipped due to cooldown.`,
                };
            }

            activeDiscordUpdates.add(discordId);
            try {
                // Fetch user roles ONCE and reuse for both rank and team updates
                let userRoles;
                try {
                    userRoles = await fetchUserDiscordRoles(discordId);
                } catch (fetchErr) {
                    console.error("Failed to fetch Discord roles (pre-fetch) for", discordId, fetchErr);
                    // Soft-fail to avoid hammering upstream and reduce error storms
                    return {
                        success: true,
                        message: `Skipped processing for ${discordId} due to backend unavailability.`,
                    };
                }

                const rankUpdateResult = await updateUserRankFromDiscordRoles(discordId, undefined, userRoles);
                const teamUpdateResult = await updateUserTeamFromDiscordRoles(discordId, undefined, 0, 2, userRoles);

                if (!rankUpdateResult.success || !teamUpdateResult.success) {
                    console.error("Error processing discord update", { rankUpdateResult, teamUpdateResult });
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: "Failed to process Discord update.",
                    });
                }

                return {
                    success: true,
                    message: "Discord update processed successfully.",
                    rankUpdate: rankUpdateResult.message,
                    teamUpdate: teamUpdateResult.message,
                };
            } catch (error) {
                console.error("Error processing discord update for discordId:", discordId, error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "An error occurred while processing the Discord update.",
                });
            } finally {
                activeDiscordUpdates.delete(discordId);
                lastDiscordUpdateAt.set(discordId, Date.now());
            }
        }),
});
