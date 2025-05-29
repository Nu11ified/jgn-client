import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "@/server/api/trpc";
import { db } from "@/server/db"; 
import { postgrestDb } from "@/server/postgres"; 
import type {
  NewForm,
  //NewFormResponse,
  NewFormCategory,
  ReviewerDecisionObject,
  FormResponseStatus,
  Form as PgForm, 
  FormResponse as PgFormResponse,
} from "@/server/postgres/schema/form";
import {
  forms,
  formCategories,
  formResponses,
  formQuestionSchema,
  formAnswerSchema,
  reviewerDecisionEnum,
  formResponseStatusEnum,
} from "@/server/postgres/schema/form";
import { userServerRoles, roles, users } from "@/server/db/schema/user-schema"; 
import { user as authUser, account as authAccount } from "@/server/db/schema/auth-schema"; // Added for auth tables
import { TRPCError } from "@trpc/server";
import { and, eq, sql as drizzleSql, count, desc, getTableColumns, isNull, inArray } from "drizzle-orm"; 

// Updated to fetch all roles for a user, irrespective of serverId
async function getAllUserRoleIds(userDiscordId: bigint): Promise<string[]> {
  const userRolesResult = await db
    .select({ roleId: userServerRoles.roleId })
    .from(userServerRoles)
    .where(eq(userServerRoles.userDiscordId, userDiscordId));
  // Ensure roleId is consistently handled as a string
  return userRolesResult.map((r: { roleId: string | bigint | number }) => String(r.roleId));
}

// hasRequiredRole remains the same, but now receives all user roles
function hasRequiredRole(allUserRoles: string[], requiredRolesForForm: ReadonlyArray<string> | string[] | null | undefined): boolean {
  if (!requiredRolesForForm || requiredRolesForForm.length === 0) return true;
  return allUserRoles.some((userRole) => requiredRolesForForm.includes(userRole));
}

export const formRouter = createTRPCRouter({
  // -------------------- ADMIN PROCEDURES --------------------
  createCategory: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(256),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<NewFormCategory> => {
      const result = await postgrestDb
        .insert(formCategories)
        .values({
          name: input.name,
          description: input.description,
        })
        .returning()
        .execute();
      const newCategory = result[0];
      if (!newCategory) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create category.",
        });
      }
      return newCategory;
    }),

  deleteCategory: adminProcedure
    .input(z.object({ categoryId: z.number().int() }))
    .mutation(async ({ input }) => {
      await postgrestDb
        .update(forms)
        .set({ categoryId: null })
        .where(eq(forms.categoryId, input.categoryId))
        .execute();
      await postgrestDb
        .delete(formCategories)
        .where(eq(formCategories.id, input.categoryId))
        .execute();
      return { success: true, categoryId: input.categoryId };
    }),

  createForm: adminProcedure
    .input(
      z.object({
        title: z.string().min(1).max(256),
        description: z.string().optional(),
        questions: z.array(formQuestionSchema),
        categoryId: z.number().int().optional().nullable(),
        accessRoleIds: z.array(z.string().min(17).max(30)).optional().default([]), // Discord Snowflake IDs
        reviewerRoleIds: z.array(z.string().min(17).max(30)).optional().default([]),
        finalApproverRoleIds: z.array(z.string().min(17).max(30)).optional().default([]),
        requiredReviewers: z.number().int().min(0).default(1),
        requiresFinalApproval: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }): Promise<NewForm> => {
      const result = await postgrestDb
        .insert(forms)
        .values({
          title: input.title,
          description: input.description,
          questions: input.questions,
          categoryId: input.categoryId,
          accessRoleIds: input.accessRoleIds,
          reviewerRoleIds: input.reviewerRoleIds,
          finalApproverRoleIds: input.finalApproverRoleIds,
          requiredReviewers: input.requiredReviewers,
          requiresFinalApproval: input.requiresFinalApproval,
        })
        .returning()
        .execute();

      const newForm = result[0];
      if (!newForm) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create form.",
        });
      }
      return newForm;
    }),

  editForm: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        title: z.string().min(1).max(256).optional(),
        description: z.string().optional().nullable(),
        questions: z.array(formQuestionSchema).optional(),
        categoryId: z.number().int().optional().nullable(),
        accessRoleIds: z.array(z.string().min(17).max(30)).optional(),
        reviewerRoleIds: z.array(z.string().min(17).max(30)).optional(),
        finalApproverRoleIds: z.array(z.string().min(17).max(30)).optional(),
        requiredReviewers: z.number().int().min(0).optional(),
        requiresFinalApproval: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updateData } = input;
      const result = await postgrestDb
        .update(forms)
        .set(updateData)
        .where(eq(forms.id, id))
        .returning()
        .execute();
      
      const updatedForm = result[0];
      if (!updatedForm) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Form with ID ${id} not found.`,
        });
      }
      return updatedForm;
    }),

  deleteForm: adminProcedure
    .input(z.object({ formId: z.number().int() }))
    .mutation(async ({ input }) => {
      // Soft delete
      const result = await postgrestDb
        .update(forms)
        .set({ deletedAt: new Date() })
        .where(eq(forms.id, input.formId))
        .returning({ id: forms.id })
        .execute();

      const deletedForm = result[0];
      if (!deletedForm) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Form with ID ${input.formId} not found.`,
        });
      }
      return { success: true, formId: input.formId };
    }),

  // -------------------- PROTECTED PROCEDURES (USER FACING) --------------------
  submitResponse: protectedProcedure
    .input(z.object({ formId: z.number().int(), answers: z.array(formAnswerSchema) }))
    .mutation(async ({ ctx, input }): Promise<PgFormResponse> => {
      const [targetForm] = await postgrestDb
        .select({ id: forms.id, accessRoleIds: forms.accessRoleIds, requiredReviewers: forms.requiredReviewers, requiresFinalApproval: forms.requiresFinalApproval })
        .from(forms)
        .where(and(eq(forms.id, input.formId), drizzleSql`${forms.deletedAt} IS NULL`))
        .limit(1).execute();

      if (!targetForm) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Form not found or has been deleted." });
      }

      if (!ctx.dbUser?.discordId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found in context." });
      }
      const userDiscordId = ctx.dbUser.discordId;
      const userRoles = await getAllUserRoleIds(userDiscordId);

      if (!hasRequiredRole(userRoles, targetForm.accessRoleIds)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have the required role to submit this form." });
      }
      
      let initialStatus: FormResponseStatus = formResponseStatusEnum.enum.pending_review;
      if (targetForm.requiredReviewers === 0) {
        initialStatus = targetForm.requiresFinalApproval 
          ? formResponseStatusEnum.enum.pending_approval 
          : formResponseStatusEnum.enum.approved;
      }

      // Check for an existing draft
      const [existingDraft] = await postgrestDb.select()
        .from(formResponses)
        .where(and(
          eq(formResponses.formId, input.formId),
          eq(formResponses.userId, ctx.session.user.id),
          eq(formResponses.status, formResponseStatusEnum.enum.draft)
        ))
        .limit(1).execute();

      if (existingDraft) {
        // Update the draft to a submitted response
        const [updatedResponse] = await postgrestDb
          .update(formResponses)
          .set({
            answers: input.answers,
            status: initialStatus,
            submittedAt: new Date(), // Set submittedAt on actual submission
            updatedAt: new Date(),
          })
          .where(eq(formResponses.id, existingDraft.id))
          .returning().execute();
        if (!updatedResponse) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update draft to submitted response." });
        }
        return updatedResponse;
      } else {
        // Create a new response
        const [newResponse] = await postgrestDb
          .insert(formResponses)
          .values({ formId: input.formId, userId: ctx.session.user.id, answers: input.answers, status: initialStatus, submittedAt: new Date() })
          .returning().execute();
        if (!newResponse) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to submit form response." });
        }
        return newResponse;
      }
    }),

  reviewResponse: protectedProcedure
    .input(
      z.object({
        responseId: z.number().int(),
        decision: reviewerDecisionEnum,
        comments: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const responseToReview = await postgrestDb
        .query.formResponses.findFirst({
          where: eq(formResponses.id, input.responseId),
          with: {
            form: {
              columns: {
                reviewerRoleIds: true,
                requiredReviewers: true,
                requiresFinalApproval: true,
              },
            },
          },
        });

      if (!responseToReview) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Form response not found." });
      }
      if (!responseToReview.form) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not load associated form details. This should not happen." });
      }
      
      const currentResponseStatus: FormResponseStatus = responseToReview.status;
      if (currentResponseStatus !== formResponseStatusEnum.enum.pending_review) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This response is not currently pending review." });
      }

      if (!ctx.dbUser?.discordId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found in context." });
      }
      const userDiscordId = ctx.dbUser.discordId;
      const userRoles = await getAllUserRoleIds(userDiscordId);

      if (!hasRequiredRole(userRoles, responseToReview.form.reviewerRoleIds)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have the required role to review this form.",
        });
      }
      
      const existingReview = responseToReview.reviewerDecisions?.find(
        (d: ReviewerDecisionObject) => d.userId === ctx.session.user.id
      );
      if (existingReview) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You have already reviewed this response." });
      }

      const newDecision: ReviewerDecisionObject = {
        reviewerName: ctx.session.user.name,
        userId: ctx.session.user.id,
        decision: input.decision,
        reviewedAt: new Date(),
        comments: input.comments,
      };
      
      const updatedDecisions = [...(responseToReview.reviewerDecisions ?? []), newDecision];
      
      // Add the current reviewer's ID to the reviewerIds array if not already present
      const currentReviewerId = ctx.session.user.id;
      const updatedReviewerIds = Array.from(new Set([...(responseToReview.reviewerIds ?? []), currentReviewerId]));

      let newApprovedCount = responseToReview.reviewersApprovedCount;
      let newDeniedCount = responseToReview.reviewersDeniedCount;
      if (input.decision === reviewerDecisionEnum.enum.yes) {
        newApprovedCount++;
      } else {
        newDeniedCount++;
      }

      let newStatus: FormResponseStatus = currentResponseStatus;
      const requiredReviewers = responseToReview.form.requiredReviewers;
      const totalReviewsSubmitted = newApprovedCount + newDeniedCount;

      if (requiredReviewers === 0) {
        newStatus = responseToReview.form.requiresFinalApproval
          ? formResponseStatusEnum.enum.pending_approval
          : formResponseStatusEnum.enum.approved;
      } else if (totalReviewsSubmitted >= requiredReviewers) {
        if (newApprovedCount > newDeniedCount) {
          newStatus = responseToReview.form.requiresFinalApproval
            ? formResponseStatusEnum.enum.pending_approval
            : formResponseStatusEnum.enum.approved;
        } else {
          newStatus = formResponseStatusEnum.enum.denied_by_review;
        }
      } else {
        newStatus = formResponseStatusEnum.enum.pending_review;
      }

      const result = await postgrestDb
        .update(formResponses)
        .set({
          reviewerDecisions: updatedDecisions,
          reviewerIds: updatedReviewerIds, // Save the updated array of reviewer IDs
          reviewersApprovedCount: newApprovedCount,
          reviewersDeniedCount: newDeniedCount,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(formResponses.id, input.responseId))
        .returning()
        .execute();
      const updatedResponse = result[0];
      if (!updatedResponse) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to record review." });
      }
      return updatedResponse;
    }),

  approveResponse: protectedProcedure
    .input(
      z.object({
        responseId: z.number().int(),
        decision: z.boolean(),
        comments: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const responseToApprove = await postgrestDb
        .query.formResponses.findFirst({
          where: eq(formResponses.id, input.responseId),
          with: {
            form: {
              columns: {
                finalApproverRoleIds: true,
              },
            },
          },
        });

      if (!responseToApprove) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Form response not found." });
      }
      if (!responseToApprove.form) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not load associated form details. This should not happen." });
      }
      
      const currentApprovalStatus: FormResponseStatus = responseToApprove.status;
      if (currentApprovalStatus !== formResponseStatusEnum.enum.pending_approval) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This response is not currently pending final approval." });
      }

      if (!ctx.dbUser?.discordId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found in context." });
      }
      const userDiscordId = ctx.dbUser.discordId;
      const userRoles = await getAllUserRoleIds(userDiscordId);

      if (!hasRequiredRole(userRoles, responseToApprove.form.finalApproverRoleIds)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have the required role to approve/deny this form." });
      }

      const newStatus: FormResponseStatus = input.decision
        ? formResponseStatusEnum.enum.approved
        : formResponseStatusEnum.enum.denied_by_approval;

      const result = await postgrestDb
        .update(formResponses)
        .set({ finalApproverId: ctx.session.user.id, finalApprovalDecision: input.decision, finalApprovedAt: new Date(), finalApprovalComments: input.comments, status: newStatus, updatedAt: new Date() })
        .where(eq(formResponses.id, input.responseId))
        .returning().execute();
      const updatedResponse = result[0];
      if (!updatedResponse) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to record final approval." });
      }
      return updatedResponse;
    }),
  
  // -------------------- LISTING PROCEDURES & UI HELPERS --------------------
  listCategories: adminProcedure.query(async () => {
    const categoriesWithCounts = await postgrestDb
      .select({
        ...getTableColumns(formCategories),
        formsCount: drizzleSql<number>`count(DISTINCT ${forms.id})`.mapWith(Number),
      })
      .from(formCategories)
      .leftJoin(forms, and(eq(forms.categoryId, formCategories.id), isNull(forms.deletedAt)))
      .groupBy(formCategories.id)
      .orderBy(desc(formCategories.createdAt))
      .execute();
    return categoriesWithCounts.map(c => ({...c, formsCount: c.formsCount ?? 0})); 
  }),

  listForms: protectedProcedure
    .input(
      z.object({
        categoryId: z.number().int().optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.number().int().optional(), // For offset-based pagination
      })
    )
    .query(async ({ input }) => {
      const whereClauses = [drizzleSql`${forms.deletedAt} IS NULL`];
      if (input.categoryId) {
        whereClauses.push(eq(forms.categoryId, input.categoryId));
      }

      const formItems = await postgrestDb
        .select({ // Select all necessary fields
          id: forms.id,
          title: forms.title,
          description: forms.description,
          questions: forms.questions,
          categoryId: forms.categoryId,
          accessRoleIds: forms.accessRoleIds,
          reviewerRoleIds: forms.reviewerRoleIds,
          finalApproverRoleIds: forms.finalApproverRoleIds,
          requiredReviewers: forms.requiredReviewers,
          requiresFinalApproval: forms.requiresFinalApproval,
          createdAt: forms.createdAt,
          // TODO: Consider if other fields like updatedAt or createdBy are needed
        })
        .from(forms)
        .where(and(...whereClauses))
        .orderBy(drizzleSql`${forms.createdAt} DESC`)
        .limit(input.limit)
        .offset(input.cursor ?? 0)
        .execute();
      
      // For more robust pagination, consider cursor-based pagination on a unique, sequential column like createdAt + id.
      // For now, this is offset-based.
      let nextCursor: number | undefined = undefined;
      if (formItems.length === input.limit) {
        nextCursor = (input.cursor ?? 0) + formItems.length;
      }

      return {
        items: formItems,
        nextCursor,
      };
    }),

  getFormById: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const [form] = await postgrestDb
        .select()
        .from(forms)
        .where(and(eq(forms.id, input.id), drizzleSql`${forms.deletedAt} IS NULL`))
        .limit(1)
        .execute();

      if (!form) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Form not found or has been deleted." });
      }
      
      if (!ctx.dbUser?.discordId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found in context." });
      }
      const userDiscordId = ctx.dbUser.discordId;
      const userRoles = await getAllUserRoleIds(userDiscordId);
      if (!hasRequiredRole(userRoles, form.accessRoleIds)) {
         // If form.accessRoleIds is null or empty, hasRequiredRole returns true, allowing access.
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this form." });
      }

      return form as PgForm; // Cast to ensure all fields from schema are available
    }),

  listResponsesForForm: adminProcedure // Or protected with specific roles if non-admins can see responses
    .input(
      z.object({
        formId: z.number().int(),
        status: formResponseStatusEnum.optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(), // Typically a timestamp or ID for cursor pagination
      })
    )
    .query(async ({ input }) => {
      const whereClauses = [eq(formResponses.formId, input.formId)];
      if (input.status) {
        whereClauses.push(eq(formResponses.status, input.status));
      }

      if (input.cursor) {
        whereClauses.push(drizzleSql`${formResponses.submittedAt} < ${new Date(input.cursor)}`);
      }

      const responseItems = await postgrestDb.query.formResponses.findMany({
        where: and(...whereClauses),
        orderBy: (responses, { desc }) => [desc(responses.submittedAt)],
        limit: input.limit + 1, 
      });

      let nextCursor: string | undefined = undefined;
      if (responseItems.length > input.limit) {
        const nextItem = responseItems.pop(); 
        if (nextItem) {
            nextCursor = nextItem.submittedAt.toISOString();
        }
      }

      // Step 1: Collect all unique JWT sub IDs (string user.id from auth-schema)
      const jwtSubIds = new Set<string>();
      responseItems.forEach(item => {
        if (item.userId) jwtSubIds.add(item.userId);
        if (item.finalApproverId) jwtSubIds.add(item.finalApproverId);
        item.reviewerDecisions?.forEach(decision => {
          if (decision.userId) jwtSubIds.add(decision.userId);
        });
      });

      const finalUserDetailsMap = new Map<string, { fullName?: string | null; discordId?: string | null }>();

      if (jwtSubIds.size > 0) {
        // Step 2: Get accountId (Discord ID string) from authAccount table using jwtSubIds
        const accountInfos = await db
          .select({
            userId: authAccount.userId, // This is the JWT Sub ID
            discordAccountId: authAccount.accountId, // This is the Discord ID (string)
          })
          .from(authAccount)
          .where(inArray(authAccount.userId, Array.from(jwtSubIds)))
          .execute();

        const jwtSubToDiscordIdMap = new Map<string, string>();
        accountInfos.forEach(acc => {
          if (acc.discordAccountId) { // Ensure discordAccountId is not null
            jwtSubToDiscordIdMap.set(acc.userId, acc.discordAccountId);
          }
        });
        
        const discordIdStrings = Array.from(jwtSubToDiscordIdMap.values());
        const discordIdsToFetch = discordIdStrings.map(id => BigInt(id)).filter(id => !isNaN(Number(id)));

        if (discordIdsToFetch.length > 0) {
          // Step 3: Get username from users table using discordIds (bigint)
          const userSchemaDetails = await db
            .select({
              retrievedDiscordId: users.discordId, // bigint
              username: users.username, // string (this will be fullName)
            })
            .from(users)
            .where(inArray(users.discordId, discordIdsToFetch))
            .execute();

          const discordIdToUsernameMap = new Map<string, string>();
          userSchemaDetails.forEach(ud => {
            discordIdToUsernameMap.set(String(ud.retrievedDiscordId), ud.username ?? 'Unknown User');
          });

          // Step 4: Populate the finalUserDetailsMap (jwtSubId -> { fullName, discordId })
          jwtSubToDiscordIdMap.forEach((discordIdStr, jwtSub) => {
            const username = discordIdToUsernameMap.get(discordIdStr);
            finalUserDetailsMap.set(jwtSub, {
              fullName: username,
              discordId: discordIdStr,
            });
          });
        }
      }

      const augmentedItems = responseItems.map(item => {
        const submitterDetails = item.userId ? finalUserDetailsMap.get(item.userId) : undefined;
        const finalApproverDetails = item.finalApproverId ? finalUserDetailsMap.get(item.finalApproverId) : undefined;

        const augmentedReviewerDecisions = item.reviewerDecisions?.map(decision => {
          const reviewerDetails = decision.userId ? finalUserDetailsMap.get(decision.userId) : undefined;
          return {
            ...decision,
            reviewerFullName: reviewerDetails?.fullName ?? decision.reviewerName, // Fallback to existing reviewerName
            reviewerDiscordId: reviewerDetails?.discordId,
          };
        });

        return {
          ...item,
          submitterFullName: submitterDetails?.fullName,
          submitterDiscordId: submitterDetails?.discordId,
          finalApproverFullName: finalApproverDetails?.fullName,
          finalApproverDiscordId: finalApproverDetails?.discordId,
          reviewerDecisions: augmentedReviewerDecisions,
        };
      });

      return {
        items: augmentedItems as (PgFormResponse & { /* type augmented fields */ })[],
        nextCursor,
      };
    }),

  getResponseById: protectedProcedure
    .input(z.object({ responseId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const response = await postgrestDb.query.formResponses.findFirst({
        where: eq(formResponses.id, input.responseId),
        with: {
          form: true, // Get full form details
        },
      });

      if (!response) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Form response not found." });
      }

      let canView = false;
      if (response.userId === ctx.session.user.id) {
        canView = true;
      } else {
        if (!ctx.dbUser?.discordId) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found for role-based access check." });
        }
        const userRoleIds = await getAllUserRoleIds(ctx.dbUser.discordId);
        const formForResponse = response.form;
        if (!formForResponse) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Associated form details are missing for access control check." });
        }
        const isReviewer = hasRequiredRole(userRoleIds, formForResponse.reviewerRoleIds);
        const isFinalApprover = hasRequiredRole(userRoleIds, formForResponse.finalApproverRoleIds);
        
        // Allow reviewers to view responses in pending_review status
        if (response.status === formResponseStatusEnum.enum.pending_review && isReviewer) {
          canView = true;
        }
        
        // Allow final approvers to view any response for forms where they have the final approver role
        if (isFinalApprover) {
          canView = true;
        }
      }
      if (!canView) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this specific form response." });
      }

      const jwtSubIds = new Set<string>();
      if (response.userId) jwtSubIds.add(response.userId);
      if (response.finalApproverId) jwtSubIds.add(response.finalApproverId);
      response.reviewerDecisions?.forEach(decision => {
        if (decision.userId) jwtSubIds.add(decision.userId);
      });

      const finalUserDetailsMap = new Map<string, { fullName?: string | null; discordId?: string | null }>();

      if (jwtSubIds.size > 0) {
        const accountInfos = await db
          .select({
            userId: authAccount.userId,
            discordAccountId: authAccount.accountId,
          })
          .from(authAccount)
          .where(inArray(authAccount.userId, Array.from(jwtSubIds)))
          .execute();

        const jwtSubToDiscordIdMap = new Map<string, string>();
        accountInfos.forEach(acc => {
          if (acc.discordAccountId) {
            jwtSubToDiscordIdMap.set(acc.userId, acc.discordAccountId);
          }
        });

        const discordIdStrings = Array.from(jwtSubToDiscordIdMap.values());
        const discordIdsToFetch = discordIdStrings.map(id => BigInt(id)).filter(id => !isNaN(Number(id)));

        if (discordIdsToFetch.length > 0) {
          const userSchemaDetails = await db
            .select({
              retrievedDiscordId: users.discordId,
              username: users.username,
            })
            .from(users)
            .where(inArray(users.discordId, discordIdsToFetch))
            .execute();

          const discordIdToUsernameMap = new Map<string, string>();
          userSchemaDetails.forEach(ud => {
            discordIdToUsernameMap.set(String(ud.retrievedDiscordId), ud.username ?? 'Unknown User');
          });

          jwtSubToDiscordIdMap.forEach((discordIdStr, jwtSub) => {
            const username = discordIdToUsernameMap.get(discordIdStr);
            finalUserDetailsMap.set(jwtSub, {
              fullName: username,
              discordId: discordIdStr,
            });
          });
        }
      }

      const submitterDetails = response.userId ? finalUserDetailsMap.get(response.userId) : undefined;
      const finalApproverDetails = response.finalApproverId ? finalUserDetailsMap.get(response.finalApproverId) : undefined;

      const augmentedReviewerDecisions = response.reviewerDecisions?.map(decision => {
        const reviewerDetails = decision.userId ? finalUserDetailsMap.get(decision.userId) : undefined;
        return {
          ...decision,
          reviewerFullName: reviewerDetails?.fullName ?? decision.reviewerName, // Fallback to existing reviewerName
          reviewerDiscordId: reviewerDetails?.discordId,
        };
      });

      return {
        ...(response as PgFormResponse & { form: PgForm }), // Cast the base response
        submitterFullName: submitterDetails?.fullName,
        submitterDiscordId: submitterDetails?.discordId,
        finalApproverFullName: finalApproverDetails?.fullName,
        finalApproverDiscordId: finalApproverDetails?.discordId,
        reviewerDecisions: augmentedReviewerDecisions,
        // form: response.form, // Already included in the spread PgFormResponse & { form: PgForm }
      };
    }),
  
  listUserSubmissions: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(), // submittedAt timestamp
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const whereClauses = [eq(formResponses.userId, userId)];

      if (input.cursor) {
        whereClauses.push(drizzleSql`${formResponses.submittedAt} < ${new Date(input.cursor)}`);
      }

      const submissions = await postgrestDb.query.formResponses.findMany({
        where: and(...whereClauses),
        orderBy: (responses, { desc }) => [desc(responses.submittedAt)],
        limit: input.limit + 1,
        with: {
          form: { columns: { id: true, title: true } }, // Include basic form info
        },
      });

      let nextCursor: string | undefined = undefined;
      if (submissions.length > input.limit) {
        const nextItem = submissions.pop();
        if (nextItem) {
            nextCursor = nextItem.submittedAt.toISOString();
        }
      }
      
      // Explicitly type the items in the return if necessary for UI consumption
      const typedSubmissions = submissions.map(s => ({
        ...s,
        form: s.form as { id: number; title: string | null } | undefined,
      }));

      return {
        items: typedSubmissions,
        nextCursor,
      };
    }),

  listFormResponsesForReviewer: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
        cursor: z.string().optional(), // response ID as cursor
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.dbUser?.discordId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found." });
      }
      const userDiscordId = ctx.dbUser.discordId;
      const userRoleIds = await getAllUserRoleIds(userDiscordId);

      const conditions = [
        eq(formResponses.status, formResponseStatusEnum.enum.pending_review),
        userRoleIds.length > 0 
          ? drizzleSql`${forms.reviewerRoleIds} && ARRAY[${drizzleSql.join(userRoleIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}]::varchar[]`
          : drizzleSql`FALSE`, // If user has no roles, they can't match any reviewerRoleIds that require roles
        drizzleSql`NOT (EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${formResponses.reviewerDecisions}) AS decision
          WHERE (decision->>'userId')::text = ${ctx.session.user.id}
        ))`
      ];

      if (input.cursor) {
        const cursorItem = await postgrestDb.query.formResponses.findFirst({
          where: eq(formResponses.id, parseInt(input.cursor, 10)),
          columns: { submittedAt: true, id: true }
        });
        if (cursorItem?.submittedAt) {
          conditions.push(
            drizzleSql`(${formResponses.submittedAt} < ${cursorItem.submittedAt}) OR 
                       (${formResponses.submittedAt} = ${cursorItem.submittedAt} AND ${formResponses.id} < ${cursorItem.id})`
          );
        }
      }

      const items = await postgrestDb.select({
        responseId: formResponses.id,
        responseStatus: formResponses.status,
        submittedAt: formResponses.submittedAt,
        formId: forms.id,
        formTitle: forms.title,
        formDescription: forms.description,
        reviewerDecisions: formResponses.reviewerDecisions,
      })
      .from(formResponses)
      .innerJoin(forms, eq(formResponses.formId, forms.id))
      .where(and(...conditions))
      .orderBy(desc(formResponses.submittedAt), desc(formResponses.id))
      .limit(input.limit + 1)
      .execute();

      let nextCursor: string | undefined = undefined;
      if (items.length > input.limit) {
        const nextItem = items.pop();
        if (nextItem) {
          nextCursor = nextItem.responseId.toString();
        }
      }
      
      return {
        items: items.map(item => ({
          ...item,
          reviewerDecisions: item.reviewerDecisions ?? [],
        })),
        nextCursor,
      };
    }),

  listFormResponsesForFinalApprover: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
        cursor: z.string().optional(), // response ID as cursor
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.dbUser?.discordId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found." });
      }
      const userDiscordId = ctx.dbUser.discordId;
      const userRoleIds = await getAllUserRoleIds(userDiscordId);

      const conditions = [
        eq(formResponses.status, formResponseStatusEnum.enum.pending_approval),
        userRoleIds.length > 0
          ? drizzleSql`${forms.finalApproverRoleIds} && ARRAY[${drizzleSql.join(userRoleIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}]::varchar[]`
          : drizzleSql`FALSE` // If user has no roles, they can't match any finalApproverRoleIds that require roles
      ];

      if (input.cursor) {
        const cursorItem = await postgrestDb.query.formResponses.findFirst({
          where: eq(formResponses.id, parseInt(input.cursor, 10)),
          columns: { submittedAt: true, id: true }
        });
        if (cursorItem?.submittedAt) {
           conditions.push(
            drizzleSql`(${formResponses.submittedAt} < ${cursorItem.submittedAt}) OR 
                       (${formResponses.submittedAt} = ${cursorItem.submittedAt} AND ${formResponses.id} < ${cursorItem.id})`
          );
        }
      }

      const items = await postgrestDb.select({
        responseId: formResponses.id,
        responseStatus: formResponses.status,
        submittedAt: formResponses.submittedAt,
        formId: forms.id,
        formTitle: forms.title,
        formDescription: forms.description,
      })
      .from(formResponses)
      .innerJoin(forms, eq(formResponses.formId, forms.id))
      .where(and(...conditions))
      .orderBy(desc(formResponses.submittedAt), desc(formResponses.id))
      .limit(input.limit + 1)
      .execute();

      let nextCursor: string | undefined = undefined;
      if (items.length > input.limit) {
        const nextItem = items.pop();
        if (nextItem) {
          nextCursor = nextItem.responseId.toString();
        }
      }
      return { items, nextCursor };
    }),

  // -------------------- DRAFT FUNCTIONALITY --------------------
  saveDraft: protectedProcedure
    .input(z.object({
      formId: z.number().int(),
      answers: z.array(formAnswerSchema),
      responseId: z.number().int().optional(), // If updating an existing draft
    }))
    .mutation(async ({ ctx, input }): Promise<PgFormResponse> => {
      const userId = ctx.session.user.id;

      // Check if form exists and is not deleted
      const [targetForm] = await postgrestDb.select({ id: forms.id, accessRoleIds: forms.accessRoleIds })
        .from(forms)
        .where(and(eq(forms.id, input.formId), drizzleSql`${forms.deletedAt} IS NULL`))
        .limit(1).execute();

      if (!targetForm) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Form not found or has been deleted." });
      }
      
      if (!ctx.dbUser?.discordId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found in context." });
      }
      const userDiscordId = ctx.dbUser.discordId;
      const userRoles = await getAllUserRoleIds(userDiscordId);
      if (!hasRequiredRole(userRoles, targetForm.accessRoleIds)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to interact with this form." });
      }

      const draftData = {
        formId: input.formId,
        userId: userId,
        answers: input.answers,
        status: formResponseStatusEnum.enum.draft,
        updatedAt: new Date(),
      };

      let existingDraftId = input.responseId;

      // If responseId is not provided, check if a draft already exists for this user and form
      if (!existingDraftId) {
        const [existingDraft] = await postgrestDb.select({ id: formResponses.id })
            .from(formResponses)
            .where(and(
                eq(formResponses.formId, input.formId),
                eq(formResponses.userId, userId),
                eq(formResponses.status, formResponseStatusEnum.enum.draft)
            ))
            .limit(1).execute();
        if (existingDraft) {
            existingDraftId = existingDraft.id;
        }
      }

      if (existingDraftId) {
        // Update existing draft
        const [updatedDraft] = await postgrestDb
          .update(formResponses)
          .set(draftData)
          .where(and(eq(formResponses.id, existingDraftId), eq(formResponses.userId, userId)))
          .returning().execute();
        if (!updatedDraft) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update draft. It might have been submitted or deleted." });
        }
        return updatedDraft;
      } else {
        // Create new draft
        const [newDraft] = await postgrestDb
          .insert(formResponses)
          .values({ ...draftData, submittedAt: new Date() })
          .returning().execute();
        if (!newDraft) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save draft." });
        }
        return newDraft;
      }
    }),

  getUserDraft: protectedProcedure
    .input(z.object({ formId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // Use findFirst with correct type from relations if possible, or select specific fields
      const draft = await postgrestDb.query.formResponses.findFirst({
        where: and(
          eq(formResponses.formId, input.formId),
          eq(formResponses.userId, userId),
          eq(formResponses.status, formResponseStatusEnum.enum.draft)
        ),
        with: { form: { columns: { id: true, title: true } } } 
      });
      // The cast for `s.form` in listUserSubmissions might be a good pattern here too if needed.
      // For now, relying on Drizzle's inferred type for the `with` clause.
      return draft; // Let tRPC infer the return type based on what Drizzle provides with relations
    }),

  getCurrentUserServerRoles: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session?.user?.id) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
    }
    if (!ctx.dbUser?.discordId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found in context for fetching roles." });
    }
    const userDiscordId = ctx.dbUser.discordId;
    
    const userRolesResult = await db
      .select({
        roleId: userServerRoles.roleId,
        serverId: userServerRoles.serverId,
        roleName: roles.roleName, // Get roleName from the imported roles table
      })
      .from(userServerRoles)
      .leftJoin(roles, eq(userServerRoles.roleId, roles.roleId)) 
      .where(eq(userServerRoles.userDiscordId, userDiscordId));
      
    return userRolesResult.map(r => ({ 
        ...r, 
        roleId: String(r.roleId),
        roleName: r.roleName ?? "Unknown Role"
    }));
  }),

  listCategoriesPublic: protectedProcedure.query(async () => {
    // Similar to admin listCategories, but without admin protection
    // We also only want categories that might have accessible forms for the user,
    // but that filtering is complex here. Let's return all non-empty categories for now.
    // Or, more simply, just all categories. The client can filter/hide empty ones.
    const categoriesWithCounts = await postgrestDb
      .select({
        ...getTableColumns(formCategories),
        formsCount: drizzleSql<number>`count(DISTINCT ${forms.id})`.mapWith(Number),
      })
      .from(formCategories)
      .leftJoin(forms, and(eq(forms.categoryId, formCategories.id), isNull(forms.deletedAt))) // only count non-deleted forms
      .groupBy(formCategories.id)
      .orderBy(desc(formCategories.createdAt))
      .execute();
    // Filter out categories with no active forms or make formsCount explicitly number
    return categoriesWithCounts.map(c => ({...c, formsCount: c.formsCount ?? 0}));
  }),

  listAllOutcomesForFinalApprover: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.number().optional(), // response ID as cursor
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.dbUser?.discordId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User Discord ID not found." });
      }

      // Get user's roles from MySQL database
      const userRoles = await db
        .select({ roleId: userServerRoles.roleId })
        .from(userServerRoles)
        .where(eq(userServerRoles.userDiscordId, ctx.dbUser.discordId))
        .execute();

      const userRoleIds = userRoles.map(r => String(r.roleId));

      if (userRoleIds.length === 0) {
        return { items: [], nextCursor: undefined };
      }

      // Build conditions for the query
      const conditions = [
        drizzleSql`${forms.finalApproverRoleIds} && ARRAY[${drizzleSql.join(userRoleIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}]::varchar[]`,
        drizzleSql`${forms.deletedAt} IS NULL`,
        drizzleSql`${formResponses.status} != ${formResponseStatusEnum.enum.draft}`,
      ];

      if (input.cursor) {
        conditions.push(drizzleSql`${formResponses.id} < ${input.cursor}`);
      }

      // Get form responses with form details
      const responses = await postgrestDb
        .select({
          id: formResponses.id,
          formId: formResponses.formId,
          userId: formResponses.userId,
          status: formResponses.status,
          submittedAt: formResponses.submittedAt,
          reviewerDecisions: formResponses.reviewerDecisions,
          reviewersApprovedCount: formResponses.reviewersApprovedCount,
          reviewersDeniedCount: formResponses.reviewersDeniedCount,
          finalApproverId: formResponses.finalApproverId,
          finalApprovalDecision: formResponses.finalApprovalDecision,
          finalApprovedAt: formResponses.finalApprovedAt,
          finalApprovalComments: formResponses.finalApprovalComments,
          form: {
            id: forms.id,
            title: forms.title,
            description: forms.description,
          },
        })
        .from(formResponses)
        .innerJoin(forms, eq(formResponses.formId, forms.id))
        .where(and(...conditions))
        .orderBy(desc(formResponses.id))
        .limit(input.limit + 1)
        .execute();

      // Handle pagination
      let nextCursor: number | undefined;
      if (responses.length > input.limit) {
        const nextItem = responses.pop();
        nextCursor = nextItem?.id;
      }

      // Get all unique user IDs from responses
      const userIds = new Set<string>();
      responses.forEach(response => {
        if (response.userId) userIds.add(response.userId);
        if (response.finalApproverId) userIds.add(response.finalApproverId);
        response.reviewerDecisions?.forEach(decision => {
          if (decision.userId) userIds.add(decision.userId);
        });
      });

      // Get user details from auth and user tables
      const userDetails = await db
        .select({
          userId: authAccount.userId,
          discordId: authAccount.accountId,
          username: users.username,
        })
        .from(authAccount)
        .innerJoin(users, eq(users.discordId, drizzleSql`CAST(${authAccount.accountId} AS UNSIGNED)`) )
        .where(inArray(authAccount.userId, Array.from(userIds)))
        .execute();

      // Create a map of user details
      const userDetailsMap = new Map(
        userDetails.map(detail => [detail.userId, {
          discordId: detail.discordId,
          fullName: detail.username,
        }])
      );

      // Augment responses with user details
      const augmentedResponses = responses.map(response => {
        const submitter = userDetailsMap.get(response.userId);
        const finalApprover = response.finalApproverId ? userDetailsMap.get(response.finalApproverId) : undefined;
        
        const augmentedReviewerDecisions = response.reviewerDecisions?.map(decision => ({
          ...decision,
          reviewerFullName: userDetailsMap.get(decision.userId)?.fullName ?? decision.reviewerName,
          reviewerDiscordId: userDetailsMap.get(decision.userId)?.discordId,
        }));

        return {
          ...response,
          submitterFullName: submitter?.fullName,
          submitterDiscordId: submitter?.discordId,
          finalApproverFullName: finalApprover?.fullName,
          finalApproverDiscordId: finalApprover?.discordId,
          reviewerDecisions: augmentedReviewerDecisions,
        };
      });

      return {
        items: augmentedResponses,
        nextCursor,
      };
    }),
});

export type FormRouter = typeof formRouter; 