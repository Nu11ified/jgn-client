# Issues Analysis - October 2025

## Status: ⚠️ NOT FULLY FIXED

### Issue #1: Trial Moderator Reviews Not Visible
**Status**: ❓ Uncertain - Generic review system exists but no specific "trial moderator" workflow found

**Files to Check**:
- `src/app/dashboard/departments/[departmentId]/reviews/page.tsx`
- `src/server/api/routers/department/deptMore.ts` (lines 798-850)
- `src/server/api/services/department/performanceReviewService.ts`

**Problem**: The current implementation uses generic "performance reviews". There's no specific filter or workflow for "trial moderators" mentioned in the bug report.

**Fix Needed**:
1. Add a member type/status field for "trial_moderator"
2. Filter reviews by this status in the UI
3. Add specific permissions check for viewing trial moderator reviews

---

### Issue #2: Three-Digit Assignment Without Roles
**Status**: 🔴 PARTIALLY BROKEN

**Files with Issues**:
- `src/server/api/services/department/memberSyncService.ts` (lines 110-143)
- `src/server/api/services/department/callsignService.ts` (lines 25-81)

**Problem**: 
1. Callsign with ID number is assigned even if Discord/TeamSpeak role sync fails
2. No atomic transaction ensuring both ID assignment AND role assignment succeed together
3. Partial failures are logged but don't roll back the ID assignment

**Code Issue**:
```typescript
// Line 110-117 in memberSyncService.ts
const failedChanges = roleManagementResults.filter(r => !r.success);
if (failedChanges.length > 0) {
  console.warn(`⚠️ ${failedChanges.length}/${roleChanges.length} role changes failed`);
  // ❌ NO THROW HERE - continues to return success: true
}

return {
  success: true,  // ❌ ALWAYS RETURNS SUCCESS
  message: "Member sync completed successfully",
  roleManagementResults: roleManagementResults.length > 0 ? roleManagementResults : undefined,
};
```

**Fix Needed**:
```typescript
// Check for critical role failures (rank roles)
const criticalFailures = failedChanges.filter(f => f.message?.includes('rank'));
if (criticalFailures.length > 0) {
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `Critical role assignment failed: ${criticalFailures.map(f => f.message).join(', ')}`
  });
}
```

---

### Issue #3: Panel Not Allowing TeamSpeak Sync
**Status**: 🔴 MISSING FEATURE

**Files**:
- `src/app/dashboard/profile/page.tsx`
- `src/app/_components/dashboard/profile/UserProfileDisplay.tsx`

**Problem**: The profile page only shows a form to **update** `ts_uid`, but there's NO button to trigger a manual sync. The bot does auto-sync in the background, but users can't force it.

**Missing Component**: A "Sync Now" button that calls an endpoint like `/api/sync-teamspeak`

**Fix Needed**:
1. Add mutation: `api.user.syncTeamSpeak.useMutation()`
2. Add button in `UserProfileDisplay.tsx`:
```tsx
<Button onClick={() => syncMutation.mutate()}>
  <RefreshCw className="mr-2" />
  Sync TeamSpeak Now
</Button>
```
3. Create tRPC endpoint that:
   - Validates user has `ts_uid` set
   - Calls discord-sync-bot sync endpoint or queues user
   - Returns sync status

---

### Issue #4: Page Sits and Won't Allow Editing Ranks
**Status**: ❓ NEEDS INVESTIGATION

**Files to Check**:
- `src/app/dashboard/departments/[departmentId]/management/page.tsx`
- `src/app/_components/admin/UsersClient.tsx`

**Possible Causes**:
1. **Loading state never resolves** - Check if queries are hanging
2. **Permission checks fail silently** - `checkPermission` queries might be stuck
3. **Form validation errors** - Zodschemas might be rejecting valid inputs

**Debugging Steps**:
1. Add console.logs for query states:
```typescript
console.log('Loading:', isLoading, 'Error:', error, 'Data:', data);
```
2. Check browser console for TRPC errors
3. Verify permissions are being returned correctly

**Type Safety Issue**:
The code has proper TypeScript types, but runtime validation might fail silently. Need to add error boundaries and explicit error displays.

---

### Issue #5: Members Can't Be Removed from Departments
**Status**: 🔴 INCOMPLETE IMPLEMENTATION

**Files with Issues**:
- `src/server/api/services/department/discordRoleManager.ts` (line 323-470)
- Missing: `src/server/api/routers/deptRouter.ts` - no `removeMember` endpoint found

**Problem**:
1. `removeDiscordRolesForInactiveMember` only removes Discord roles
2. Does NOT:
   - Set `isActive = false` in database
   - Set `left_at` timestamp
   - Remove TeamSpeak groups
   - Clean up team memberships

**Code Issue**:
```typescript
// discordRoleManager.ts line 323
export const removeDiscordRolesForInactiveMember = async (...) => {
  // ... removes Discord roles ...
  
  // ❌ MISSING: Database updates
  // ❌ MISSING: TeamSpeak group removal
  // ❌ MISSING: Team membership cleanup
  
  return { success: true, ... };
};
```

**Fix Needed**:
Create complete removal function:
```typescript
export const removeMemberFromDepartment = async (memberId: number) => {
  // 1. Remove Discord roles
  await removeDiscordRolesForInactiveMember(...);
  
  // 2. Remove TeamSpeak groups
  await removeTeamSpeakGroups(...);
  
  // 3. Update database
  await postgrestDb
    .update(deptSchema.departmentMembers)
    .set({
      isActive: false,
      leftAt: new Date(),
      primaryTeamId: null,
      rankId: null
    })
    .where(eq(deptSchema.departmentMembers.id, memberId));
  
  // 4. Remove team memberships
  await postgrestDb
    .delete(deptSchema.departmentTeamMemberships)
    .where(eq(deptSchema.departmentTeamMemberships.memberId, memberId));
};
```

---

## Real-Time Sync Issues

### Discord Sync Bot (`discord-sync-bot/bot.py`)

**Issue**: Webhook failures can cause inconsistent state
- **Line 762-764**: Re-queues user on webhook failure, but doesn't track failure reasons
- **Line 714-724**: Webhook verification checks response JSON, but if webhook service is down, user is re-queued indefinitely

**Type Safety**: Python bot has NO type checking. All data is dynamically typed and prone to runtime errors.

**Fix Needed**:
1. Add max retry count for webhooks
2. Add dead letter queue for permanently failed syncs
3. Add typed data classes using `dataclasses` or `pydantic`

---

## Overall Type Safety Assessment

### TypeScript (jgn-client): ⚠️ 70% Type-Safe
- Has proper TypeScript types
- Uses Zod for runtime validation
- **BUT**: Many functions return `success: true` even on partial failures
- **BUT**: No transaction management for multi-step operations

### Python (discord-sync-bot): 🔴 0% Type-Safe
- Pure Python with no type hints
- No runtime validation
- Relies on string parsing and dynamic types
- Prone to crashes on unexpected data

---

## Critical Fixes Needed

### Priority 1: Fix Issue #2 (ID Assignment Without Roles)
```typescript
// In memberSyncService.ts
export const syncMemberRolesAndCallsign = async (request: SyncMemberRequest) => {
  // ... existing code ...
  
  const criticalFailures = roleManagementResults.filter(
    r => !r.success && r.message?.includes('rank')
  );
  
  if (criticalFailures.length > 0) {
    // Rollback callsign assignment if it was done
    await postgrestDb
      .update(deptSchema.departmentMembers)
      .set({ departmentIdNumber: null, callsign: null })
      .where(eq(deptSchema.departmentMembers.id, memberId));
    
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Rank role assignment failed. Changes rolled back.`
    });
  }
};
```

### Priority 2: Add Manual Sync Button (Issue #3)
Create new file: `src/server/api/routers/user.ts`
```typescript
export const userRouter = createTRPCRouter({
  // ... existing routes ...
  
  syncTeamSpeak: protectedProcedure
    .mutation(async ({ ctx }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(schema.users.discordId, String(ctx.session.user.discordId))
      });
      
      if (!user?.ts_uid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'TeamSpeak UID not set. Please update your profile first.'
        });
      }
      
      // Add user to sync queue with high priority
      await addToSyncQueue(user.discordId, priority: 2);
      
      return { success: true, message: 'Sync queued. Changes will appear within 1-2 minutes.' };
    })
});
```

### Priority 3: Complete Member Removal (Issue #5)
Add endpoint in `deptRouter.ts`:
```typescript
removeMember: protectedProcedure
  .input(z.object({
    memberId: z.number(),
    departmentId: z.number()
  }))
  .mutation(async ({ input, ctx }) => {
    // Check permissions
    const canManage = await checkPermission(ctx.dbUser.discordId, input.departmentId, 'manage_members');
    if (!canManage) throw new TRPCError({ code: 'FORBIDDEN' });
    
    // Start transaction
    return await postgrestDb.transaction(async (tx) => {
      // 1. Remove Discord roles
      await removeDiscordRolesForInactiveMember(...);
      
      // 2. Update member status
      await tx.update(deptSchema.departmentMembers)
        .set({ isActive: false, leftAt: new Date() })
        .where(eq(deptSchema.departmentMembers.id, input.memberId));
      
      // 3. Clean up teams
      await tx.delete(deptSchema.departmentTeamMemberships)
        .where(eq(deptSchema.departmentTeamMemberships.memberId, input.memberId));
      
      return { success: true };
    });
  })
```

---

## Conclusion

**Can I confirm the issues are fixed and type-safe?**

**❌ NO** - The codebase has the following problems:

1. **Issue #2**: Partially broken - ID assignment happens without guaranteeing role assignment
2. **Issue #3**: Missing feature - No manual sync button in UI
3. **Issue #5**: Incomplete - Only removes Discord roles, not full member removal
4. **Type Safety**: TypeScript parts are mostly type-safe, but Python bot has zero type safety
5. **Error Handling**: Many functions return success even on partial failures
6. **Transaction Management**: No database transactions for multi-step operations

**Recommended Actions**:
1. Apply the Priority 1-3 fixes above
2. Add comprehensive error logging and monitoring
3. Implement database transactions for all multi-step operations
4. Add Python type hints to discord-sync-bot using `mypy`
5. Add end-to-end integration tests for critical workflows
