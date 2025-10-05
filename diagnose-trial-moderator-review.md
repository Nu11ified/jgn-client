# Trial Moderator Review Issue - Diagnostic Guide

## Issue Summary
You cannot see or do trial moderator reviews on the JGN panel. This appears to be a role-based authorization issue with the form review system.

## Root Cause Analysis

Based on code review, the issue is likely one of the following:

### 1. **Missing Role Assignment in Database** (Most Likely)
The form system checks if users have the appropriate `reviewerRoleIds` to view pending reviews. 

**Location**: `src/server/api/routers/formRouter.ts:1287-1393` (listFormResponsesForReviewer)

**Key Logic**:
```typescript
// Line 1299-1305: Gets user's roles from MySQL
const userRoleIds = await getAllUserRoleIds(userDiscordId);

// Line 1310-1311: SQL check - form's reviewerRoleIds must overlap with user's roles
drizzleSql`${forms.reviewerRoleIds} && ARRAY[${drizzleSql.join(userRoleIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}]::varchar[]`
```

**Problem**: If the trial moderator form doesn't have your Discord role ID in its `reviewerRoleIds` array, you won't see any pending reviews.

### 2. **Form Not Created or Misconfigured**
The trial moderator review form may not exist, or it may have empty/incorrect `reviewerRoleIds`.

### 3. **User Has No Roles in Database**
The debug logging shows (line 1302-1305):
```typescript
console.log(`[REVIEWER DEBUG] User ${userDiscordId} has roles:`, userRoleIds);
if (userRoleIds.length === 0) {
  console.warn(`[REVIEWER DEBUG] User ${userDiscordId} has NO roles - cannot review any forms`);
}
```

## Diagnostic Steps

### Step 1: Check Server Logs
When you visit `/dashboard/form/reviewer`, check your server console for:
```
[REVIEWER DEBUG] User <your_discord_id> has roles: [...]
```

If this shows an empty array, your roles aren't synced from Discord to MySQL.

### Step 2: Verify Your Roles in Database
Run this query in your MySQL database:
```sql
-- Replace <your_discord_id> with your actual Discord ID
SELECT 
  usr.roleId,
  r.roleName
FROM user_server_roles usr
LEFT JOIN roles r ON usr.roleId = r.roleId
WHERE usr.userDiscordId = <your_discord_id>;
```

Expected output: You should see roles like "Trial Moderator" or similar.

### Step 3: Check Trial Moderator Form Configuration
Query your PostgreSQL database:
```sql
-- Find forms related to trial moderator
SELECT 
  id,
  title,
  reviewerRoleIds,
  accessRoleIds,
  requiresFinalApproval
FROM form_forms
WHERE deletedAt IS NULL
  AND (
    title ILIKE '%trial%moderator%'
    OR title ILIKE '%moderator%review%'
  );
```

Look for the `reviewerRoleIds` array - it should contain Discord role IDs that match your roles from Step 2.

### Step 4: Check for Pending Reviews
Query PostgreSQL for any responses awaiting review:
```sql
SELECT 
  fr.id as response_id,
  f.title as form_title,
  f.reviewerRoleIds,
  fr.status,
  fr.submittedAt
FROM form_responses fr
JOIN form_forms f ON fr.formId = f.id
WHERE fr.status = 'pending_review'
  AND f.deletedAt IS NULL
ORDER BY fr.submittedAt DESC;
```

### Step 5: Verify Your User Context
Add a protected procedure to check your current auth context:
```typescript
// In src/server/api/routers/formRouter.ts, add:
debugCurrentUser: protectedProcedure.query(async ({ ctx }) => {
  if (!ctx.dbUser?.discordId) {
    return { error: "No Discord ID in context" };
  }
  
  const userRoles = await getAllUserRoleIds(ctx.dbUser.discordId);
  
  return {
    sessionUserId: ctx.session.user.id,
    dbUserDiscordId: ctx.dbUser.discordId.toString(),
    roles: userRoles,
    isAdmin: ctx.dbUser.isAdmin
  };
})
```

Then call it from the frontend:
```typescript
const { data } = api.form.debugCurrentUser.useQuery();
console.log("My auth context:", data);
```

## Common Fixes

### Fix 1: Sync Discord Roles to MySQL
If your roles aren't showing up in MySQL, trigger a manual sync:

1. Check if there's a sync endpoint in the codebase
2. Or manually insert your role:
```sql
INSERT INTO user_server_roles (userDiscordId, serverId, roleId)
VALUES (
  <your_discord_id>,
  <server_id>,
  <trial_moderator_role_id>
);
```

### Fix 2: Add Your Role to Form's reviewerRoleIds
Update the trial moderator form to include your role:
```sql
-- First, find the trial moderator role ID from Discord
-- Then update the form
UPDATE form_forms
SET reviewerRoleIds = array_append(reviewerRoleIds, '<your_role_id>'::varchar)
WHERE title ILIKE '%trial%moderator%'
  AND NOT ('<your_role_id>' = ANY(reviewerRoleIds));
```

### Fix 3: Create Trial Moderator Form (if missing)
If the form doesn't exist, create it via the admin panel at `/dashboard/admin/forms` or via tRPC:
```typescript
await api.form.createForm.mutate({
  title: "Trial Moderator Review",
  description: "Review trial moderator applications",
  questions: [
    {
      id: crypto.randomUUID(),
      type: "long_answer",
      text: "Candidate Discord Name and ID"
    },
    {
      id: crypto.randomUUID(),
      type: "long_answer",
      text: "Review Comments"
    },
    {
      id: crypto.randomUUID(),
      type: "true_false",
      text: "Recommend for approval?"
    }
  ],
  reviewerRoleIds: ["<trial_moderator_role_id>"], // Your Discord role ID
  finalApproverRoleIds: ["<senior_moderator_role_id>"],
  requiredReviewers: 2,
  requiresFinalApproval: true
});
```

## Database Schema Reference

### MySQL Tables (Auth & Roles)
- `user_server_roles`: Maps Discord users to their roles
  - `userDiscordId` (BIGINT)
  - `roleId` (VARCHAR)
  - `serverId` (BIGINT)

### PostgreSQL Tables (Forms)
- `form_forms`: Form definitions
  - `reviewerRoleIds` (VARCHAR[]) - Discord role IDs that can review
  - `accessRoleIds` (VARCHAR[]) - Discord role IDs that can submit
  - `finalApproverRoleIds` (VARCHAR[]) - Discord role IDs that can final approve

- `form_responses`: Form submissions
  - `status` - One of: draft, submitted, pending_review, denied_by_review, pending_approval, approved, denied_by_approval
  - `formId` - References form_forms.id
  - `userId` - Auth user ID (not Discord ID!)

## Role ID Format
Discord role IDs are "Snowflakes" - 17-19 digit numbers stored as:
- **MySQL**: BIGINT or VARCHAR
- **PostgreSQL forms**: VARCHAR(30) in arrays
- **API boundaries**: Strings

Example: `"1234567890123456789"`

## Next Steps

1. Run diagnostic steps 1-4 above
2. Share the output with me (sanitize sensitive IDs if needed)
3. Based on results, we'll apply the appropriate fix

## Code References
- Form router: `src/server/api/routers/formRouter.ts`
- Role fetching: Line 34-41 (getAllUserRoleIds)
- Reviewer listing: Line 1287-1393 (listFormResponsesForReviewer)
- Review authorization: Line 796-911 (reviewResponse)
- Frontend: `src/app/dashboard/form/reviewer/page.tsx`
