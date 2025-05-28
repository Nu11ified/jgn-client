import { sql } from "drizzle-orm";
import { index, pgTableCreator } from "drizzle-orm/pg-core";
import { z } from "zod";
import { relations } from "drizzle-orm";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `form_${name}`);

// Zod schema for Question ID
const questionIdSchema = z.string().uuid().or(z.string().min(1)); // Allowing UUID or any non-empty string for flexibility

// Zod schema for different question types
const baseQuestionSchema = z.object({
  id: questionIdSchema, // Unique ID for the question within the form
  text: z.string(),
});

const trueFalseQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("true_false"),
});

const multipleChoiceQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("multiple_choice"),
  options: z.array(z.string()),
  allowMultiple: z.boolean().default(false),
});

const shortAnswerQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("short_answer"),
  maxLength: z.number().optional(),
});

const longAnswerQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("long_answer"),
  supportsMarkdown: z.boolean().default(false),
  maxLength: z.number().optional(),
});

export const formQuestionSchema = z.union([
  trueFalseQuestionSchema,
  multipleChoiceQuestionSchema,
  shortAnswerQuestionSchema,
  longAnswerQuestionSchema,
]);

export type FormQuestion = z.infer<typeof formQuestionSchema>;

// Zod schema for answers
const baseAnswerSchema = z.object({
  questionId: questionIdSchema, // Refers to the FormQuestion.id
});

const trueFalseAnswerSchema = baseAnswerSchema.extend({
  type: z.literal("true_false"),
  answer: z.boolean(),
});

const multipleChoiceAnswerSchema = baseAnswerSchema.extend({
  type: z.literal("multiple_choice"),
  answer: z.array(z.string()), // Array of selected option(s)
});

const shortAnswerAnswerSchema = baseAnswerSchema.extend({
  type: z.literal("short_answer"),
  answer: z.string(),
});

const longAnswerAnswerSchema = baseAnswerSchema.extend({
  type: z.literal("long_answer"),
  answer: z.string(),
});

export const formAnswerSchema = z.union([
  trueFalseAnswerSchema,
  multipleChoiceAnswerSchema,
  shortAnswerAnswerSchema,
  longAnswerAnswerSchema,
]);

export type FormAnswer = z.infer<typeof formAnswerSchema>;


// Table for Form Categories
export const formCategories = createTable(
  "categories",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar("name", { length: 256 }).notNull().unique(),
    description: d.text("description"),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  })
);

export type FormCategory = typeof formCategories.$inferSelect;
export type NewFormCategory = typeof formCategories.$inferInsert;

// Table for Forms
export const forms = createTable(
  "forms",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    title: d.varchar("title", { length: 256 }).notNull(),
    description: d.text("description"),
    questions: d.jsonb("questions").$type<FormQuestion[]>().notNull(), // Array of questions with explicit IDs
    categoryId: d.integer("category_id").references(() => formCategories.id, { onDelete: "set null" }),
    // Discord Role IDs for access control
    accessRoleIds: d.varchar("access_role_ids", { length: 30 }).array().default(sql`'{}'::varchar[]`), // Roles that can view/submit
    reviewerRoleIds: d.varchar("reviewer_role_ids", { length: 30 }).array().default(sql`'{}'::varchar[]`), // Roles that can review
    finalApproverRoleIds: d.varchar("final_approver_role_ids", { length: 30 }).array().default(sql`'{}'::varchar[]`), // Roles for final approval
    requiredReviewers: d.integer("required_reviewers").default(1).notNull(),
    requiresFinalApproval: d.boolean("requires_final_approval").default(true).notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    // Soft delete
    deletedAt: d.timestamp("deleted_at", { withTimezone: true }),
  }),
  (t) => [
    index("form_title_idx").on(t.title),
    index("form_category_id_idx").on(t.categoryId),
  ]
);

export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;

// Enum for Form Response Status/Stages
export const formResponseStatusEnum = z.enum([
  "draft",            // User is drafting the response, not yet submitted
  "submitted",        // User has submitted the form
  "pending_review",   // Awaiting reviewer action
  "denied_by_review", // Rejected by reviewers
  "pending_approval", // Approved by reviewers, awaiting final approval (if required)
  "approved",         // Approved (either by reviewers if no final approval, or by final approver)
  "denied_by_approval", // Rejected by final approver
]);
export type FormResponseStatus = z.infer<typeof formResponseStatusEnum>;

// Enum for Reviewer Decision
export const reviewerDecisionEnum = z.enum(["yes", "no"]);
export type ReviewerDecision = z.infer<typeof reviewerDecisionEnum>;

export type ReviewerDecisionObject = {
  reviewerName: string;
  userId: string; // Changed from varchar(30) to string for generic Zod type
  decision: ReviewerDecision;
  reviewedAt: Date | string; // Date for Zod, string for DB representation
  comments?: string;
};

// Table for Form Responses
export const formResponses = createTable(
  "responses",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    formId: d.integer("form_id").references(() => forms.id, { onDelete: "cascade" }).notNull(),
    userId: d.text("user_id").notNull(), // Discord User ID
    answers: d.jsonb("answers").$type<FormAnswer[]>().notNull(), // Array of answers referencing question IDs
    status: d.varchar("status", { length: 50, enum: formResponseStatusEnum.options }).default("submitted").notNull(),
    reviewerDecisions: d.jsonb("reviewer_decisions").$type<ReviewerDecisionObject[]>().default([]),
    //multiple reviewers
    reviewerIds: d.text("reviewer_ids").array().default(sql`'{}'::text[]`), // User ID of the reviewers
    reviewersApprovedCount: d.integer("reviewers_approved_count").default(0).notNull(),
    reviewersDeniedCount: d.integer("reviewers_denied_count").default(0).notNull(),
    finalApproverId: d.text("final_approver_id"), // User ID of the final approver
    finalApprovalDecision: d.boolean("final_approval_decision"), // true for yes, false for no
    finalApprovedAt: d.timestamp("final_approved_at", { withTimezone: true }),
    finalApprovalComments: d.text("final_approval_comments"),
    submittedAt: d
      .timestamp("submitted_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("response_form_id_idx").on(t.formId),
    index("response_user_id_idx").on(t.userId),
    index("response_status_idx").on(t.status),
  ]
);

export type FormResponse = typeof formResponses.$inferSelect;
export type NewFormResponse = typeof formResponses.$inferInsert;

// Junction table for many-to-many relationship between forms and access roles (if needed for more complex queries, otherwise array is fine)
// For now, sticking with array types in the forms table for simplicity.

// Junction table for reviewers (if we need more details than just role IDs, or if a user can be a reviewer for specific responses)
// For now, reviewerRoleIds on the form and storing decisions on the response.

// Junction table for approvers (similar to reviewers)
// For now, finalApproverRoleIds on the form and storing decision on the response.

// --- RELATIONS ---
export const formCategoriesRelations = relations(formCategories, ({ many }) => ({
  forms: many(forms),
}));

export const formsRelations = relations(forms, ({ one, many }) => ({
  category: one(formCategories, {
    fields: [forms.categoryId],
    references: [formCategories.id],
  }),
  responses: many(formResponses),
}));

export const formResponsesRelations = relations(formResponses, ({ one }) => ({
  form: one(forms, {
    fields: [formResponses.formId],
    references: [forms.id],
  }),
  // If you had a users table in Postgres to link userId to, you'd define it here.
  // For now, userId is a varchar and assumed to be linked externally (e.g., to your MySQL users table via application logic).
}));
