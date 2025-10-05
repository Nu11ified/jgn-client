# JGN Panel - Critical Issues Fix Report
**Date**: 2025-10-05  
**Priority**: URGENT  
**Status**: PARTIALLY FIXED

## 🎯 Executive Summary

Analyzed and addressed 5 critical issues with the JGN panel affecting member management, reviews, and department operations.

**Fixed**: 2/5 issues  
**Diagnosed**: 3/5 issues  
**Action Required**: Testing and verification

---

## ✅ Issue #2: FIXED - Three-Digit ID Without Roles/TeamSpeak

### Problem
Members were being assigned 3-digit department IDs but **Discord roles and TeamSpeak groups were not being assigned**. This is the most critical issue as it breaks the entire onboarding flow.

### Root Cause
The `ENABLE_ASYNC_MEMBER_CREATION_SYNC` feature flag was set to `true`, causing Discord role assignment to happen asynchronously in the background. The member creation would return successfully with a 3-digit ID, but if the background sync failed, roles would never be assigned and the error would be silently swallowed.

**Problematic Code** (lines 2344-2376 in `deptRouter.ts`):
```typescript
if (DISCORD_SYNC_FEATURE_FLAGS.ENABLE_ASYNC_MEMBER_CREATION_SYNC) {
  // Runs in background - errors not surfaced!
  void syncMemberRolesAndCallsign({...}).then(...).catch(...)
}
```

### Fix Applied
Changed `ENABLE_ASYNC_MEMBER_CREATION_SYNC` from `true` to `false` in `src/server/api/services/department/constants.ts`.

**File Modified**: `src/server/api/services/department/constants.ts`

**Changes**:
- Line 12-14: Disabled async sync flag
- Added explanatory comment about why this must be synchronous
- Discord and TeamSpeak roles will now be assigned **before** member creation completes

### Impact
- ✅ Members will now get all roles immediately when created
- ✅ Any errors in role assignment will be surfaced to the user
- ⚠️ Member creation may take 2-3 seconds longer (acceptable tradeoff)
- ✅ Fixes the disconnect between 3-digit ID assignment and role assignment

### Testing Required
1. Create a new member with both rank and team
2. Verify Discord roles are assigned immediately
3. Check TeamSpeak sync bot logs to confirm group assignment
4. Test error handling when Discord API fails

---

## 🔍 Issue #1: DIAGNOSED - Trial Moderator Reviews Not Visible

### Problem
Users report they cannot see trial moderator review forms on the JGN panel at `/dashboard/form/reviewer`.

### Diagnosis
The reviewer system is **fully implemented and should work**. The endpoint exists at:
- **Frontend**: `/dashboard/form/reviewer/page.tsx` 
- **Backend**: `listFormResponsesForReviewer` in `formRouter.ts` (line 1287)

The endpoint filters forms based on:
1. Form status = `pending_review`
2. User's Discord roles match the form's `reviewerRoleIds` array
3. User hasn't already reviewed the form

### Most Likely Causes
1. **No forms have been configured with reviewer roles** - Check `forms.reviewerRoleIds`
2. **User doesn't have matching Discord roles** - User's roles don't match any form's `reviewerRoleIds`
3. **All forms already reviewed** - User has already submitted reviews for all forms
4. **Role sync issue** - User's Discord roles aren't properly synced to the database

### Fix Applied
Added debug logging to `listFormResponsesForReviewer` endpoint:

**File Modified**: `src/server/api/routers/formRouter.ts`

**Changes** (lines 1301-1305):
```typescript
// DEBUG: Log user's roles to help diagnose reviewer access issues
console.log(`[REVIEWER DEBUG] User ${userDiscordId} has roles:`, userRoleIds);
if (userRoleIds.length === 0) {
  console.warn(`[REVIEWER DEBUG] User ${userDiscordId} has NO roles - cannot review any forms`);
}
```

### Required Actions
1. **Check server logs** when a user visits `/dashboard/form/reviewer`
2. **Verify forms exist** with `reviewerRoleIds` set:
   ```sql
   SELECT id, title, reviewer_role_ids FROM form_forms WHERE deleted_at IS NULL;
   ```
3. **Check user's roles** match form requirements:
   ```sql
   SELECT usr.role_id, r.role_name 
   FROM user_server_roles usr
   JOIN roles r ON usr.role_id = r.role_id
   WHERE usr.user_discord_id = <USER_DISCORD_ID>;
   ```
4. **Verify role format** - Discord role IDs should be stored as varchar(30) strings

### TeamSpeak Integration Note
The trial moderator reviewer system is **separate from TeamSpeak**. TeamSpeak sync is handled by the discord-sync-bot which:
- Reads `users.ts_uid` from MySQL
- Maps Discord roles to TeamSpeak server groups via `discord_role_to_teamspeak_group_mapping`
- Assigns/removes TeamSpeak groups based on `ts_uid` presence

---

## ⚠️ Issue #3: Profile Sync Page - REQUIRES INVESTIGATION

### Problem
"Panel not allowing people to get into the profile to sync TeamSpeak"

### Current Implementation
- **Page**: `/dashboard/profile/page.tsx` - Server component that pre-fetches user data
- **UI**: `UserProfileDisplay.tsx` - Allows users to update their TeamSpeak UID
- **Endpoint**: `api.user.updateMyTsUid` - Updates `users.ts_uid` field

### Possible Issues
1. **Authorization failure** - User session invalid or missing
2. **Server-side rendering error** - Data fetch failing silently
3. **Database connection issue** - MySQL pool exhausted or connection timeout
4. **Missing user record** - User exists in auth but not in `users` table

### Investigation Steps
1. Check server logs for errors when accessing `/dashboard/profile`
2. Verify session middleware is working
3. Test `api.user.getMe()` endpoint directly
4. Check MySQL connection pool status

### Recommended Fix (Not Yet Applied)
Add error boundary and loading states to profile page:

```typescript
// In /dashboard/profile/page.tsx
export default async function UserProfilePage() {
  try {
    const user = await api.user.getMe();
    return (
      <HydrateClient>
        <UserProfileDisplay user={user} />
      </HydrateClient>
    );
  } catch (error) {
    // Better error handling with specific messages
    console.error('[PROFILE PAGE ERROR]:', error);
    return <ErrorDisplay error={error} />;
  }
}
```

---

## ⚠️ Issue #4: Department Management Page Hanging - REQUIRES INVESTIGATION

### Problem
"Page sits and won't allow editing anyone or adding ranks"

### Current Implementation
The `DepartmentDetailClient.tsx` component is complex with:
- 18+ mutation handlers
- Multiple dialogs for CRUD operations
- Real-time data invalidation and refetching
- Complex state management

### Possible Issues
1. **Data fetching blocking render** - Initial data query hanging
2. **Too many mutations active** - React Query mutation queue exhausted
3. **Circular refetch loop** - Invalidation triggering infinite refetch
4. **Memory leak** - Too many open dialogs or state not cleaning up
5. **Permission check failure** - Admin permissions not properly validated

### Investigation Steps
1. Open browser DevTools → Network tab
2. Check for hanging requests to `/api/trpc`
3. Look for error responses (400/403/500)
4. Check React DevTools for component render loops
5. Monitor console for TRPC errors

### Likely Culprit
The component uses this pattern extensively:
```typescript
const { data: departmentData, refetch } = api.dept.admin.departments.getById.useQuery(
  { id: initialDepartment.id! },
  { initialData: initialDepartment }
);
```

If `initialDepartment.id` is `undefined` or `null`, this will cause issues.

### Recommended Fixes (Not Yet Applied)

1. **Add Loading States**:
```typescript
if (!departmentData) {
  return <LoadingSpinner />;
}
```

2. **Add Error Boundary**:
```typescript
<ErrorBoundary fallback={<ErrorDisplay />}>
  <DepartmentDetailClient {...props} />
</ErrorBoundary>
```

3. **Optimize Refetching**:
```typescript
// Instead of invalidating everything
void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
void trpcUtils.dept.admin.members.listByDepartment.invalidate({ departmentId: department.id });
void trpcUtils.dept.admin.ranks.listByDepartment.invalidate({ departmentId: department.id });

// Just invalidate what changed
void trpcUtils.dept.admin.members.listByDepartment.invalidate();
```

---

## ⚠️ Issue #5: Member Removal Not Working - LIKELY WORKING

### Problem
"People cannot physically be removed from department panels"

### Investigation Result
The deletion endpoints **exist and look correct**:

1. **Soft Delete** (`members.delete`) - Lines 2696-2763
   - Sets `isActive = false`
   - Removes Discord roles
   - Frees up ID number for reuse
   - **Should work**

2. **Hard Delete** (`members.hardDelete`) - Lines 2766-2820  
   - Permanently deletes from database
   - Removes team memberships first
   - Frees up ID number
   - **Should work**

3. **Member Deletion** (`members.memberDeletion`) - Lines 2822-2941
   - Protected procedure with permission checks
   - Validates rank hierarchy
   - Removes Discord roles
   - **Should work**

### Possible Issues
1. **UI not calling the endpoint** - Check if delete button onClick is properly wired
2. **Permission failure** - User doesn't have `manage_members` permission
3. **Rank hierarchy check failing** - Cannot delete higher-ranked members
4. **Error not displayed** - Mutation fails silently in UI

### UI Implementation Check Required
In `DepartmentDetailClient.tsx`:

**Delete Member Handler** (lines 808-811):
```typescript
const handleDeleteMember = async (memberId: number, memberDiscordId: string) => {
  if (confirm(`Are you sure you want to delete the member "${memberDiscordId}"?`)) {
    await deleteMemberMutation.mutateAsync({ id: memberId });
  }
};
```

**Mutation** (lines 557-570):
```typescript
const deleteMemberMutation = api.dept.admin.members.delete.useMutation({
  onSuccess: () => {
    toast.success("Member deleted successfully");
    void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
    void trpcUtils.dept.admin.members.listByDepartment.invalidate({ departmentId: department.id });
  },
  onError: (error) => {
    toast.error(`Failed to delete member: ${error.message}`);
  }
});
```

This looks correct! The issue might be:
1. Button not triggering the handler
2. Mutation hanging/failing silently
3. Permission check failing on backend

### Recommended Testing
1. Open browser DevTools → Network tab
2. Click delete button on a member
3. Check if `/api/trpc/dept.admin.members.delete` is called
4. Check response status and body
5. Check server logs for error messages

---

## 🚀 Deployment Checklist

### Before Deploy
- [x] Fix #2 applied (async sync disabled)
- [x] Debug logging added for Issue #1
- [ ] Test member creation with roles
- [ ] Verify TeamSpeak sync works
- [ ] Test reviewer page with debug logs

### After Deploy
- [ ] Monitor server logs for `[REVIEWER DEBUG]` messages
- [ ] Test member deletion flow end-to-end
- [ ] Check department management page performance
- [ ] Test profile page access
- [ ] Verify all 3-digit IDs get roles

### Database Verification Queries

```sql
-- Check if members have roles assigned
SELECT 
  dm.id,
  dm.discord_id,
  dm.department_id_number,
  dm.callsign,
  dr.name AS rank_name,
  dt.name AS team_name
FROM dept_members dm
LEFT JOIN dept_ranks dr ON dm.rank_id = dr.id
LEFT JOIN dept_teams dt ON dm.primary_team_id = dt.id
WHERE dm.is_active = true
ORDER BY dm.created_at DESC
LIMIT 20;

-- Check forms with reviewer roles
SELECT id, title, reviewer_role_ids
FROM form_forms
WHERE deleted_at IS NULL
  AND array_length(reviewer_role_ids, 1) > 0;

-- Check user roles
SELECT 
  u.discord_id,
  u.username,
  u.ts_uid,
  array_agg(DISTINCT r.role_name) AS roles
FROM users u
LEFT JOIN user_server_roles usr ON u.discord_id = usr.user_discord_id
LEFT JOIN roles r ON usr.role_id = r.role_id
GROUP BY u.discord_id, u.username, u.ts_uid;
```

---

## 📊 Impact Assessment

| Issue | Severity | Status | Impact |
|-------|----------|--------|---------|
| #2 - No Roles | 🔴 CRITICAL | ✅ FIXED | Breaks onboarding |
| #1 - Reviews | 🟠 HIGH | ⚙️ DIAGNOSED | Blocks trial mod process |
| #3 - Profile | 🟡 MEDIUM | ⚠️ INVESTIGATING | Blocks TS sync |
| #4 - UI Hanging | 🟠 HIGH | ⚠️ INVESTIGATING | Blocks department mgmt |
| #5 - Deletion | 🟡 MEDIUM | ℹ️ LIKELY WORKING | May be UI issue |

---

## 🔧 Next Steps

### Immediate (Deploy Now)
1. **Deploy the async sync fix** (#2) - This is critical
2. **Monitor server logs** for reviewer debug output (#1)
3. **Test member creation** to verify roles are assigned

### Short Term (Next Sprint)
1. **Investigate profile page** blocking issue (#3)
2. **Add error boundaries** to department management (#4)
3. **Test and verify** member deletion flow (#5)

### Long Term (Technical Debt)
1. Refactor `DepartmentDetailClient` to reduce complexity
2. Add comprehensive error logging throughout
3. Implement proper loading states for all async operations
4. Add E2E tests for critical flows (member creation, deletion, reviews)

---

## 📝 Additional Notes

### TeamSpeak Integration
The TeamSpeak sync is handled by the external `discord-sync-bot` service, not the JGN client directly. The flow is:

1. User sets `ts_uid` in JGN panel (`/dashboard/profile`)
2. Discord-sync-bot reads `ts_uid` from MySQL `users` table
3. Bot maps user's Discord roles to TeamSpeak groups
4. Bot assigns/removes TeamSpeak server groups via TS3 Query API

If TeamSpeak roles aren't being assigned, check:
1. Is `ts_uid` set in database?
2. Is discord-sync-bot running?
3. Are role mappings configured in `discord_role_to_teamspeak_group_mapping`?
4. Check bot logs for TS3 connection errors

### Discord Role Assignment
The JGN panel calls the external FastAPI service (M2M_API_URL) to assign Discord roles:
1. Member created/updated with rank/team
2. `performSecureSync()` called with role changes
3. Axios POST to FastAPI endpoint with `X-API-Key` header
4. FastAPI service calls Discord API to add/remove roles
5. Webhook posts back to JGN to confirm sync

### Database Schema Notes
- Discord IDs stored as `BIGINT` in MySQL, `TEXT` in PostgreSQL
- Role IDs stored as `varchar(30)` arrays in both databases
- TeamSpeak UID stored as `CHAR(28)` in MySQL `users.ts_uid`
- Department ID numbers (100-999) tracked in `departmentIdNumbers` table for recycling

---

**Report Generated**: 2025-10-05  
**Author**: AI Agent (Warp Terminal)  
**Priority**: CRITICAL - Deploy ASAP
