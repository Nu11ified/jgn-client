import { eq, and, desc, gte, lte, count } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

export interface PerformanceReview {
    id: number;
    memberId: number;
    reviewerId: number;
    reviewPeriodStart: Date;
    reviewPeriodEnd: Date;
    overallRating: number; // 1-5 scale
    strengths: string;
    areasForImprovement: string;
    goals: string;
    recommendedActions: Array<"promotion" | "training" | "mentoring" | "disciplinary" | "no_action">;
    reviewDate: Date;
    nextReviewDate?: Date;
    isActive: boolean;
    createdAt: Date;
    updatedAt?: Date;
}

export interface PerformanceReviewResult {
    success: boolean;
    message: string;
    reviewId?: number;
    data?: PerformanceReview;
}

export async function conductPerformanceReview(params: {
    memberId: number;
    reviewerId: number;
    reviewPeriodStart: Date;
    reviewPeriodEnd: Date;
    overallRating: number;
    strengths: string;
    areasForImprovement: string;
    goals: string;
    recommendedActions: Array<"promotion" | "training" | "mentoring" | "disciplinary" | "no_action">;
}): Promise<PerformanceReviewResult> {
    try {
        const {
            memberId,
            reviewerId,
            reviewPeriodStart,
            reviewPeriodEnd,
            overallRating,
            strengths,
            areasForImprovement,
            goals,
            recommendedActions,
        } = params;

        // Validate member exists and is active
        const member = await postgrestDb
            .select({
                id: deptSchema.departmentMembers.id,
                isActive: deptSchema.departmentMembers.isActive,
                departmentId: deptSchema.departmentMembers.departmentId,
                roleplayName: deptSchema.departmentMembers.roleplayName,
            })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, memberId))
            .limit(1);

        if (member.length === 0) {
            return {
                success: false,
                message: "Member not found",
            };
        }

        if (!member[0]!.isActive) {
            return {
                success: false,
                message: "Cannot conduct review for inactive member",
            };
        }

        // Validate reviewer exists and has permissions
        const reviewer = await postgrestDb
            .select({
                id: deptSchema.departmentMembers.id,
                isActive: deptSchema.departmentMembers.isActive,
                departmentId: deptSchema.departmentMembers.departmentId,
                rankId: deptSchema.departmentMembers.rankId,
            })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, reviewerId))
            .limit(1);

        if (reviewer.length === 0) {
            return {
                success: false,
                message: "Reviewer not found",
            };
        }

        if (!reviewer[0]!.isActive) {
            return {
                success: false,
                message: "Reviewer is not active",
            };
        }

        // Check if reviewer is in same department
        if (reviewer[0]!.departmentId !== member[0]!.departmentId) {
            return {
                success: false,
                message: "Reviewer must be in the same department as the member",
            };
        }

        // Check if reviewer has permission to conduct reviews
        const hasPermission = await checkReviewPermissions(reviewerId);
        if (!hasPermission) {
            return {
                success: false,
                message: "Reviewer does not have permission to conduct performance reviews",
            };
        }

        // Validate review period
        if (reviewPeriodStart >= reviewPeriodEnd) {
            return {
                success: false,
                message: "Review period start date must be before end date",
            };
        }

        if (reviewPeriodEnd > new Date()) {
            return {
                success: false,
                message: "Review period end date cannot be in the future",
            };
        }

        // Validate rating
        if (overallRating < 1 || overallRating > 5) {
            return {
                success: false,
                message: "Overall rating must be between 1 and 5",
            };
        }

        // Check for existing review in the same period
        const existingReview = await checkExistingReview(memberId, reviewPeriodStart, reviewPeriodEnd);
        if (existingReview) {
            return {
                success: false,
                message: "A performance review already exists for this member in the specified period",
            };
        }

        // Calculate next review date (typically 6 months or 1 year)
        const nextReviewDate = new Date(reviewPeriodEnd);
        nextReviewDate.setMonth(nextReviewDate.getMonth() + 6); // 6 months from review period end

        // Create performance review record
        const [insertedReview] = await postgrestDb
            .insert(deptSchema.departmentPerformanceReviews)
            .values({
                memberId,
                reviewerId,
                reviewPeriodStart,
                reviewPeriodEnd,
                overallRating,
                strengths,
                areasForImprovement,
                goals,
                recommendedActions,
                reviewDate: new Date(),
                nextReviewDate,
                isActive: true,
            })
            .returning();

        if (!insertedReview) {
            return {
                success: false,
                message: "Failed to create performance review record",
            };
        }

        const reviewId = insertedReview.id;

        // Process recommended actions
        await processRecommendedActions(memberId, recommendedActions, reviewId);

        // Log the review activity
        await logReviewActivity(memberId, reviewerId, overallRating, recommendedActions);

        return {
            success: true,
            message: "Performance review conducted successfully",
            reviewId,
            data: {
                id: insertedReview.id,
                memberId: insertedReview.memberId,
                reviewerId: insertedReview.reviewerId,
                reviewPeriodStart: insertedReview.reviewPeriodStart,
                reviewPeriodEnd: insertedReview.reviewPeriodEnd,
                overallRating: insertedReview.overallRating,
                strengths: insertedReview.strengths,
                areasForImprovement: insertedReview.areasForImprovement,
                goals: insertedReview.goals,
                recommendedActions: insertedReview.recommendedActions as Array<"promotion" | "training" | "mentoring" | "disciplinary" | "no_action">,
                reviewDate: insertedReview.reviewDate,
                nextReviewDate: insertedReview.nextReviewDate ?? undefined,
                isActive: insertedReview.isActive,
                createdAt: insertedReview.createdAt,
                updatedAt: insertedReview.updatedAt ?? undefined,
            } as PerformanceReview,
        };
    } catch (error) {
        console.error("Error conducting performance review:", error);
        return {
            success: false,
            message: `Failed to conduct performance review: ${error}`,
        };
    }
}

export async function getPerformanceReviews(params: {
    memberId?: number;
    departmentId?: number;
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    offset?: number;
}): Promise<{
    reviews: PerformanceReview[];
    total: number;
}> {
    try {
        const { memberId, departmentId, dateFrom, dateTo, limit = 50, offset = 0 } = params;

        // Build where conditions
        const conditions = [];

        if (memberId) {
            conditions.push(eq(deptSchema.departmentPerformanceReviews.memberId, memberId));
        }

        if (departmentId) {
            // Join with members table to filter by department
            conditions.push(eq(deptSchema.departmentMembers.departmentId, departmentId));
        }

        if (dateFrom) {
            conditions.push(gte(deptSchema.departmentPerformanceReviews.reviewDate, dateFrom));
        }

        if (dateTo) {
            conditions.push(lte(deptSchema.departmentPerformanceReviews.reviewDate, dateTo));
        }

        // Add active filter
        conditions.push(eq(deptSchema.departmentPerformanceReviews.isActive, true));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Get reviews with member and reviewer info
        const reviewsQuery = postgrestDb
            .select({
                id: deptSchema.departmentPerformanceReviews.id,
                memberId: deptSchema.departmentPerformanceReviews.memberId,
                reviewerId: deptSchema.departmentPerformanceReviews.reviewerId,
                reviewPeriodStart: deptSchema.departmentPerformanceReviews.reviewPeriodStart,
                reviewPeriodEnd: deptSchema.departmentPerformanceReviews.reviewPeriodEnd,
                overallRating: deptSchema.departmentPerformanceReviews.overallRating,
                strengths: deptSchema.departmentPerformanceReviews.strengths,
                areasForImprovement: deptSchema.departmentPerformanceReviews.areasForImprovement,
                goals: deptSchema.departmentPerformanceReviews.goals,
                recommendedActions: deptSchema.departmentPerformanceReviews.recommendedActions,
                reviewDate: deptSchema.departmentPerformanceReviews.reviewDate,
                nextReviewDate: deptSchema.departmentPerformanceReviews.nextReviewDate,
                isActive: deptSchema.departmentPerformanceReviews.isActive,
                createdAt: deptSchema.departmentPerformanceReviews.createdAt,
                updatedAt: deptSchema.departmentPerformanceReviews.updatedAt,
            })
            .from(deptSchema.departmentPerformanceReviews);

        // Add join if filtering by department
        if (departmentId) {
            reviewsQuery.innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentPerformanceReviews.memberId, deptSchema.departmentMembers.id)
            );
        }

        if (whereClause) {
            reviewsQuery.where(whereClause);
        }

        const reviews = await reviewsQuery
            .orderBy(desc(deptSchema.departmentPerformanceReviews.reviewDate))
            .limit(limit)
            .offset(offset);

        // Get total count
        const totalQuery = postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentPerformanceReviews);

        if (departmentId) {
            totalQuery.innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentPerformanceReviews.memberId, deptSchema.departmentMembers.id)
            );
        }

        if (whereClause) {
            totalQuery.where(whereClause);
        }

        const [totalResult] = await totalQuery;
        const total = totalResult?.count ?? 0;

        // Transform to PerformanceReview interface
        const transformedReviews: PerformanceReview[] = reviews.map(review => ({
            id: review.id,
            memberId: review.memberId,
            reviewerId: review.reviewerId,
            reviewPeriodStart: review.reviewPeriodStart,
            reviewPeriodEnd: review.reviewPeriodEnd,
            overallRating: review.overallRating,
            strengths: review.strengths,
            areasForImprovement: review.areasForImprovement,
            goals: review.goals,
            recommendedActions: review.recommendedActions as Array<"promotion" | "training" | "mentoring" | "disciplinary" | "no_action">,
            reviewDate: review.reviewDate,
            nextReviewDate: review.nextReviewDate ?? undefined,
            isActive: review.isActive,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt ?? undefined,
        }));

        return {
            reviews: transformedReviews,
            total,
        };
    } catch (error) {
        console.error("Error getting performance reviews:", error);
        return {
            reviews: [],
            total: 0,
        };
    }
}

export async function updatePerformanceReview(
    reviewId: number,
    updates: Partial<PerformanceReview>,
    updatedBy: number
): Promise<{ success: boolean; message: string }> {
    try {
        // Validate review exists
        const review = await getReviewById(reviewId);
        if (!review) {
            return {
                success: false,
                message: "Performance review not found",
            };
        }

        // Check permissions
        const canUpdate = await checkReviewUpdatePermissions(reviewId, updatedBy);
        if (!canUpdate) {
            return {
                success: false,
                message: "Insufficient permissions to update this performance review",
            };
        }

        // Prepare update data
        const updateData: Partial<typeof deptSchema.departmentPerformanceReviews.$inferInsert> = {};

        if (updates.overallRating !== undefined) {
            if (updates.overallRating < 1 || updates.overallRating > 5) {
                return {
                    success: false,
                    message: "Overall rating must be between 1 and 5",
                };
            }
            updateData.overallRating = updates.overallRating;
        }

        if (updates.strengths !== undefined) updateData.strengths = updates.strengths;
        if (updates.areasForImprovement !== undefined) updateData.areasForImprovement = updates.areasForImprovement;
        if (updates.goals !== undefined) updateData.goals = updates.goals;
        if (updates.recommendedActions !== undefined) updateData.recommendedActions = updates.recommendedActions;
        if (updates.nextReviewDate !== undefined) updateData.nextReviewDate = updates.nextReviewDate;
        if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

        // Update the review
        await postgrestDb
            .update(deptSchema.departmentPerformanceReviews)
            .set(updateData)
            .where(eq(deptSchema.departmentPerformanceReviews.id, reviewId));

        return {
            success: true,
            message: "Performance review updated successfully",
        };
    } catch (error) {
        console.error("Error updating performance review:", error);
        return {
            success: false,
            message: `Failed to update performance review: ${error}`,
        };
    }
}

export async function getReviewStatistics(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<{
    totalReviews: number;
    averageRating: number;
    ratingDistribution: Record<number, number>;
    recommendedActionsCount: Record<string, number>;
    reviewsOverdue: number;
}> {
    try {
        // Get all reviews for the department in the date range
        const reviews = await postgrestDb
            .select({
                id: deptSchema.departmentPerformanceReviews.id,
                overallRating: deptSchema.departmentPerformanceReviews.overallRating,
                recommendedActions: deptSchema.departmentPerformanceReviews.recommendedActions,
                nextReviewDate: deptSchema.departmentPerformanceReviews.nextReviewDate,
            })
            .from(deptSchema.departmentPerformanceReviews)
            .innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentPerformanceReviews.memberId, deptSchema.departmentMembers.id)
            )
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    eq(deptSchema.departmentPerformanceReviews.isActive, true),
                    gte(deptSchema.departmentPerformanceReviews.reviewDate, startDate),
                    lte(deptSchema.departmentPerformanceReviews.reviewDate, endDate)
                )
            );

        const totalReviews = reviews.length;

        // Calculate average rating
        const totalRating = reviews.reduce((sum, review) => sum + review.overallRating, 0);
        const averageRating = totalReviews > 0 ? totalRating / totalReviews : 0;

        // Calculate rating distribution
        const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        reviews.forEach(review => {
            ratingDistribution[review.overallRating] = (ratingDistribution[review.overallRating] || 0) + 1;
        });

        // Calculate recommended actions count
        const recommendedActionsCount: Record<string, number> = {
            promotion: 0,
            training: 0,
            mentoring: 0,
            disciplinary: 0,
            no_action: 0,
        };

        reviews.forEach(review => {
            const actions = review.recommendedActions as string[];
            actions.forEach(action => {
                if (recommendedActionsCount[action] !== undefined) {
                    recommendedActionsCount[action]++;
                }
            });
        });

        // Calculate overdue reviews
        const currentDate = new Date();
        const reviewsOverdue = reviews.filter(review =>
            review.nextReviewDate && review.nextReviewDate < currentDate
        ).length;

        return {
            totalReviews,
            averageRating: Math.round(averageRating * 100) / 100, // Round to 2 decimal places
            ratingDistribution,
            recommendedActionsCount,
            reviewsOverdue,
        };
    } catch (error) {
        console.error("Error getting review statistics:", error);
        throw error;
    }
}

// Helper functions

async function checkReviewPermissions(reviewerId: number): Promise<boolean> {
    try {
        // Get reviewer's rank and permissions
        const reviewer = await postgrestDb
            .select({
                rankId: deptSchema.departmentMembers.rankId,
            })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, reviewerId))
            .limit(1);

        if (reviewer.length === 0) return false;

        const rankId = reviewer[0]!.rankId;
        if (!rankId) return false;

        // Get rank permissions
        const rank = await postgrestDb
            .select({
                permissions: deptSchema.departmentRanks.permissions,
                level: deptSchema.departmentRanks.level,
            })
            .from(deptSchema.departmentRanks)
            .where(eq(deptSchema.departmentRanks.id, rankId))
            .limit(1);

        if (rank.length === 0) return false;

        const permissions = rank[0]!.permissions;
        const level = rank[0]!.level;

        // Check if has permission to manage members or is high enough rank
        return permissions.manage_members || permissions.manage_department || level >= 3;
    } catch (error) {
        console.error("Error checking review permissions:", error);
        return false;
    }
}

async function checkExistingReview(
    memberId: number,
    startDate: Date,
    endDate: Date
): Promise<boolean> {
    try {
        // Check for overlapping review periods
        const existingReviews = await postgrestDb
            .select({ id: deptSchema.departmentPerformanceReviews.id })
            .from(deptSchema.departmentPerformanceReviews)
            .where(
                and(
                    eq(deptSchema.departmentPerformanceReviews.memberId, memberId),
                    eq(deptSchema.departmentPerformanceReviews.isActive, true),
                    // Check for overlapping periods
                    and(
                        lte(deptSchema.departmentPerformanceReviews.reviewPeriodStart, endDate),
                        gte(deptSchema.departmentPerformanceReviews.reviewPeriodEnd, startDate)
                    )
                )
            )
            .limit(1);

        return existingReviews.length > 0;
    } catch (error) {
        console.error("Error checking existing review:", error);
        return false;
    }
}

async function processRecommendedActions(
    memberId: number,
    actions: string[],
    reviewId: number
): Promise<void> {
    try {
        for (const action of actions) {
            switch (action) {
                case "promotion":
                    console.log(`Flagging member ${memberId} for promotion consideration (Review ID: ${reviewId})`);
                    // Could create a promotion recommendation record linked to this review
                    break;
                case "training":
                    console.log(`Scheduling additional training for member ${memberId} (Review ID: ${reviewId})`);
                    // Could create training assignments linked to this review
                    break;
                case "mentoring":
                    console.log(`Assigning mentor to member ${memberId} (Review ID: ${reviewId})`);
                    // Could create mentoring assignments linked to this review
                    break;
                case "disciplinary":
                    console.log(`Flagging member ${memberId} for disciplinary review (Review ID: ${reviewId})`);
                    // Could create disciplinary action records linked to this review
                    break;
                case "no_action":
                    console.log(`No additional action required for member ${memberId} (Review ID: ${reviewId})`);
                    break;
            }
        }
    } catch (error) {
        console.error("Error processing recommended actions:", error);
    }
}

async function logReviewActivity(
    memberId: number,
    reviewerId: number,
    rating: number,
    actions: string[]
): Promise<void> {
    try {
        // Get member and reviewer information for logging
        const [memberInfo] = await postgrestDb
            .select({
                roleplayName: deptSchema.departmentMembers.roleplayName,
                departmentId: deptSchema.departmentMembers.departmentId,
                discordId: deptSchema.departmentMembers.discordId,
            })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, memberId))
            .limit(1);

        const [reviewerInfo] = await postgrestDb
            .select({
                roleplayName: deptSchema.departmentMembers.roleplayName,
                discordId: deptSchema.departmentMembers.discordId,
            })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, reviewerId))
            .limit(1);

        if (!memberInfo || !reviewerInfo) {
            console.error("Could not find member or reviewer information for logging");
            return;
        }

        // Create a comprehensive activity log entry
        const activityData = {
            type: "performance_review_conducted",
            memberId,
            reviewerId,
            memberName: memberInfo.roleplayName || "Unknown",
            reviewerName: reviewerInfo.roleplayName || "Unknown",
            memberDiscordId: memberInfo.discordId,
            reviewerDiscordId: reviewerInfo.discordId,
            departmentId: memberInfo.departmentId,
            rating,
            recommendedActions: actions,
            timestamp: new Date(),
        };

        // Log to console for immediate visibility
        console.log("Performance Review Activity:", {
            action: "Performance review conducted",
            member: `${memberInfo.roleplayName} (${memberInfo.discordId})`,
            reviewer: `${reviewerInfo.roleplayName} (${reviewerInfo.discordId})`,
            rating: `${rating}/5`,
            actions: actions.join(", "),
            timestamp: new Date().toISOString(),
        });

        // TODO: In a production system, you would insert this into an audit/activity log table
        // Example structure for future implementation:
        // await postgrestDb.insert(deptSchema.departmentActivityLog).values({
        //     departmentId: memberInfo.departmentId,
        //     actorId: reviewerId,
        //     targetId: memberId,
        //     actionType: "performance_review_conducted",
        //     details: activityData,
        //     createdAt: new Date(),
        // });

        // For now, we'll store the activity data in a way that can be easily retrieved
        // This could be enhanced to integrate with existing logging systems
        
    } catch (error) {
        console.error("Error logging review activity:", error);
        // Don't throw the error as logging shouldn't break the main flow
    }
}

async function getReviewById(reviewId: number): Promise<PerformanceReview | null> {
    try {
        const [review] = await postgrestDb
            .select({
                id: deptSchema.departmentPerformanceReviews.id,
                memberId: deptSchema.departmentPerformanceReviews.memberId,
                reviewerId: deptSchema.departmentPerformanceReviews.reviewerId,
                reviewPeriodStart: deptSchema.departmentPerformanceReviews.reviewPeriodStart,
                reviewPeriodEnd: deptSchema.departmentPerformanceReviews.reviewPeriodEnd,
                overallRating: deptSchema.departmentPerformanceReviews.overallRating,
                strengths: deptSchema.departmentPerformanceReviews.strengths,
                areasForImprovement: deptSchema.departmentPerformanceReviews.areasForImprovement,
                goals: deptSchema.departmentPerformanceReviews.goals,
                recommendedActions: deptSchema.departmentPerformanceReviews.recommendedActions,
                reviewDate: deptSchema.departmentPerformanceReviews.reviewDate,
                nextReviewDate: deptSchema.departmentPerformanceReviews.nextReviewDate,
                isActive: deptSchema.departmentPerformanceReviews.isActive,
                createdAt: deptSchema.departmentPerformanceReviews.createdAt,
                updatedAt: deptSchema.departmentPerformanceReviews.updatedAt,
            })
            .from(deptSchema.departmentPerformanceReviews)
            .where(eq(deptSchema.departmentPerformanceReviews.id, reviewId))
            .limit(1);

        if (!review) {
            return null;
        }

        return {
            id: review.id,
            memberId: review.memberId,
            reviewerId: review.reviewerId,
            reviewPeriodStart: review.reviewPeriodStart,
            reviewPeriodEnd: review.reviewPeriodEnd,
            overallRating: review.overallRating,
            strengths: review.strengths,
            areasForImprovement: review.areasForImprovement,
            goals: review.goals,
            recommendedActions: review.recommendedActions as Array<"promotion" | "training" | "mentoring" | "disciplinary" | "no_action">,
            reviewDate: review.reviewDate,
            nextReviewDate: review.nextReviewDate ?? undefined,
            isActive: review.isActive,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt ?? undefined,
        };
    } catch (error) {
        console.error("Error getting review by ID:", error);
        return null;
    }
}

async function checkReviewUpdatePermissions(reviewId: number, updatedBy: number): Promise<boolean> {
    try {
        // Get the review to check who created it
        const [review] = await postgrestDb
            .select({
                reviewerId: deptSchema.departmentPerformanceReviews.reviewerId,
                memberId: deptSchema.departmentPerformanceReviews.memberId,
            })
            .from(deptSchema.departmentPerformanceReviews)
            .where(eq(deptSchema.departmentPerformanceReviews.id, reviewId))
            .limit(1);

        if (!review) return false;

        // Allow the original reviewer to update their own review
        if (review.reviewerId === updatedBy) {
            return true;
        }

        // Check if the updater has management permissions
        const hasManagementPermission = await checkReviewPermissions(updatedBy);
        if (hasManagementPermission) {
            return true;
        }

        // Get the updater's information to check if they're in the same department
        const [updater] = await postgrestDb
            .select({
                departmentId: deptSchema.departmentMembers.departmentId,
                rankId: deptSchema.departmentMembers.rankId,
            })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, updatedBy))
            .limit(1);

        if (!updater) return false;

        // Get the member being reviewed to check department
        const [reviewedMember] = await postgrestDb
            .select({
                departmentId: deptSchema.departmentMembers.departmentId,
            })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, review.memberId))
            .limit(1);

        if (!reviewedMember) return false;

        // Must be in the same department
        if (updater.departmentId !== reviewedMember.departmentId) {
            return false;
        }

        // Check if updater has sufficient rank level
        if (updater.rankId) {
            const [rank] = await postgrestDb
                .select({
                    level: deptSchema.departmentRanks.level,
                    permissions: deptSchema.departmentRanks.permissions,
                })
                .from(deptSchema.departmentRanks)
                .where(eq(deptSchema.departmentRanks.id, updater.rankId))
                .limit(1);

            if (rank && (rank.permissions.manage_members || rank.level >= 3)) {
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error("Error checking review update permissions:", error);
        return false;
    }
}