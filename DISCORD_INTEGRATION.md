# Discord Integration for Department System

This document explains how the Discord role synchronization system works for the department management system.

## Overview

The Discord integration automatically synchronizes department ranks with Discord roles, ensuring that when someone gets promoted/demoted in the system, their Discord roles are updated accordingly. It also handles the reverse - when Discord roles change, the database ranks are updated.

## Architecture Flow

```
1. User gets promoted/demoted in department system
   ↓
2. System validates permissions and rank limits  
   ↓
3. Discord role management API is called to add/remove roles
   ↓
4. If Discord fails: promotion/demotion fails (error returned to user)
   ↓
5. If Discord succeeds: promotion/demotion succeeds (success returned to user)
   ↓
6. Discord bot detects role change and calls webhook with user's Discord ID
   ↓
7. Webhook looks up user's current Discord roles and updates database ranks
```

## Components

### 1. Rank Update by Discord ID Endpoint
- **Endpoint**: `deptRouter.discord.updateRankByDiscordId`
- **Purpose**: Updates a user's department ranks based on their current Discord roles
- **How it works**:
  - Fetches user's current Discord roles from the API
  - Checks all departments where the user is a member
  - For each department, finds the highest rank they should have based on their Discord roles
  - Updates the database if ranks have changed

### 2. Discord Webhook Endpoint
- **Endpoint**: `deptRouter.discord.webhook`
- **Purpose**: Receives notifications when any Discord role changes for a user
- **Triggers**: Called by Discord bot when role changes are detected
- **Input**: Only Discord user ID (no specific role information needed)
- **Action**: Looks up user's current Discord roles and updates all department ranks accordingly

### 3. Promotion/Demotion Discord Integration
- **Endpoints**: `deptRouter.user.promotions.promote` and `deptRouter.user.promotions.demote`
- **New Approach**: Discord-first validation and updates
- **Flow**:
  1. Validate permissions and rank limits
  2. Record promotion/demotion in history (for audit trail)
  3. Call Discord API to update roles
  4. If Discord succeeds: return success (database will be updated by webhook)
  5. If Discord fails: return error (no database changes made)
- **Benefits**: Discord and database never get out of sync

### 4. Discord Role Management API
- **Function**: `manageDiscordRole(action, userDiscordId, roleId, serverId)`
- **Purpose**: Wrapper for calling the Discord role management API
- **Actions**: 'add' or 'remove'
- **Error Handling**: Logs errors but doesn't throw to prevent blocking database operations

## API Key Security

All Discord integration endpoints use API key authentication:
- **Discord webhook and manual sync**: Use `DEPARTMENT_TRAINING_API_KEY`
- **Discord role management (internal API calls)**: Use `M2M_API_KEY`

## Database Schema Integration

### Required Fields
- `departments.discordGuildId`: Links department to Discord server
- `departmentRanks.discordRoleId`: Links rank to Discord role

## Data Flow
1. **Promotion Flow**: Discord API → Webhook → Database (Discord as source of truth)
2. **Webhook Flow**: Discord → Database
3. **Sync Flow**: Discord roles → Database ranks (highest rank wins)

## Implementation Approaches

### Current Implementation: Discord First ✅
```
1. Validate promotion  
2. Call Discord API to update roles
3. Return success/failure based on Discord response
4. Webhook automatically updates database
```
**Pros**: Discord is source of truth, always in sync
**Cons**: Slower user feedback, depends on Discord API availability

### Alternative: Database First
```
1. Validate promotion
2. Update database rank
3. Call Discord API to update roles
4. Log errors if Discord fails
```
**Pros**: Fast user feedback, database consistency
**Cons**: Database and Discord can get out of sync if API fails

### Hybrid: Transaction with Rollback
```
1. Validate promotion
2. Update database rank  
3. Call Discord API
4. If Discord fails: rollback database changes
5. If Discord succeeds: webhook confirms sync
```
**Pros**: Best of both worlds
**Cons**: More complex implementation

## Usage Examples

### 1. Manual Rank Update
```typescript
// Update user's ranks based on current Discord roles
await api.dept.discord.updateRankByDiscordId.mutate({
  apiKey: process.env.DEPARTMENT_TRAINING_API_KEY,
  discordId: "123456789",
  departmentId: 1 // optional - updates all departments if omitted
});
```

### 2. Discord Bot Webhook Call
```javascript
// Bot calls this when ANY Discord roles change for a user
fetch('/api/trpc/dept.discord.webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiKey: process.env.DEPARTMENT_TRAINING_API_KEY,
    discordId: "123456789"
    // No need to specify which role changed - we look up current state
  })
});
```

### 3. Promotion with Discord Integration
```typescript
// Promotes user and automatically updates Discord roles
const result = await api.dept.user.promotions.promote.mutate({
  memberId: 1,
  toRankId: 5,
  reason: "Excellent performance",
  notes: "Promoted to Sergeant"
});

// New response format:
// {
//   success: true,
//   message: "Promotion successful. Discord roles updated.",
//   memberId: 1,
//   fromRankId: 3,
//   toRankId: 5,
//   discordId: "123456789"
// }

// Database will be updated automatically when webhook receives Discord bot notification
```

## Error Handling

### Discord API Failures
- Promotion/demotion operations continue even if Discord update fails
- Errors are logged for monitoring
- Database remains consistent

### Webhook Failures
- Returns error status but doesn't affect Discord state
- Failed updates can be retried manually

### Rate Limiting
- Discord API calls are made asynchronously
- No built-in rate limiting (should be handled by Discord API)

## Configuration

### Environment Variables
```env
# For Discord webhook and manual sync endpoints
DEPARTMENT_TRAINING_API_KEY=your-training-api-key

# For internal Discord role management API calls
M2M_API_KEY=your-m2m-api-key

# Discord API base URL
INTERNAL_API_URL=http://localhost:8000
```

### Department Setup
1. Create department with Discord Guild ID
2. Create ranks with Discord Role IDs
3. Ensure Discord bot has permissions to manage roles
4. Configure webhook URL in Discord bot

## Monitoring and Debugging

### Logs
- Discord API successes/failures are logged
- Rank update results include changed departments
- Webhook calls are tracked

### Manual Sync
If synchronization gets out of sync, run manual update:
```typescript
await api.dept.discord.updateRankByDiscordId.mutate({
  apiKey: process.env.DEPARTMENT_TRAINING_API_KEY,
  discordId: "user-discord-id"
});
```

## Security Considerations

1. **API Key Protection**: All endpoints require valid API keys
2. **Discord Permissions**: Bot needs role management permissions
3. **Rate Limiting**: Consider implementing rate limits for webhook endpoints
4. **Validation**: All inputs are validated with Zod schemas
5. **Error Isolation**: Discord failures don't affect core functionality

## Future Enhancements

1. **Batch Operations**: Update multiple users at once
2. **Conflict Resolution**: Handle cases where Discord and database disagree
3. **Audit Trail**: Track all Discord role changes
4. **Role Mapping**: Support for role hierarchies and complex mappings
5. **Retry Logic**: Automatic retry for failed Discord API calls 