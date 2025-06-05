import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { updateUserRankFromDiscordRoles } from "../services/department/rankSyncService";
import { updateUserTeamFromDiscordRoles } from "../services/department/teamSyncService";

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

            console.log(`Received Discord update for user: ${input.discordId}`);

            try {
                const rankUpdateResult = await updateUserRankFromDiscordRoles(input.discordId);
                const teamUpdateResult = await updateUserTeamFromDiscordRoles(input.discordId);

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
                console.error("Error processing discord update for discordId:", input.discordId, error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "An error occurred while processing the Discord update.",
                });
            }
        }),
}); 