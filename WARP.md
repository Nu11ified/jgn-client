# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

- Project type: Next.js App Router (T3-style) with tRPC and Drizzle ORM
- Package manager: pnpm
- Node: 20.x recommended
- Databases: MySQL (auth/users/roles) + PostgreSQL (departments/forms and domain data)

Commands (run from repo root)
- Install deps: pnpm install
- Dev server: pnpm dev
- Build: pnpm build
- Preview (build then start): pnpm preview
- Start (prod server, assumes build has run): pnpm start
- Lint: pnpm lint
- Lint and fix: pnpm lint:fix
- Type-check: pnpm typecheck or pnpm check (lint + tsc)
- Format check: pnpm format:check
- Format write: pnpm format:write
- Drizzle Studio (MySQL): pnpm db:studio
- Drizzle Studio (PostgreSQL): pnpm db:pg:studio
- Push schema (MySQL): pnpm db:push
- Push schema (PostgreSQL): pnpm db:pg:push

Databases and local setup
- Environment file: cp .env.example .env, then populate required values (see Environment section below). The app validates envs at runtime via src/env.js.
- MySQL: ./start-database.sh starts a local MySQL container based on DATABASE_URL (it parses host/port/db/pass from that URL). If the default password is present, the script can generate a random one and patch .env.
- PostgreSQL: Provide a reachable instance via PG_URL. Use pnpm db:pg:push to apply the Postgres schema.

Notes on tests
- There is no configured test runner or test scripts in package.json and no tests directory present. Single-test execution is not applicable at this time.

High-level architecture
- Next.js App Router (src/app)
  - API integration: The TRPC HTTP adapter is exposed at /api/trpc via src/app/api/trpc/[trpc]/route.ts.
  - Root layout sets up ThemeProvider, TRPCReactProvider, and PostHogProvider.
- tRPC server (src/server/api)
  - Context (src/server/api/trpc.ts):
    - Builds a context with db (MySQL Drizzle), headers, better-auth session, and a dbUser record (from MySQL users) derived from the better-auth Discord account.
    - Exposes publicProcedure, protectedProcedure (requires session + dbUser), and adminProcedure (requires dbUser.isAdmin).
    - Adds a timing middleware that logs execution time and simulates small dev latency.
  - Root router (src/server/api/root.ts): mounts routers: admin, user, form, dept, discord, deptMore.
  - Routers:
    - admin (src/server/api/routers/admin.ts): wraps an external FastAPI service (INTERNAL_API_URL) via axios. All calls include X-API-Key from ctx.dbUser.apiKey.
    - user (src/server/api/routers/user.ts): reads profile data from the same external service and requires protectedProcedure.
    - dept (src/server/api/routers/deptRouter.ts): core department domain logic on PostgreSQL (postgrestDb). Implements rank/team limits, callsign generation, Discord sync helpers, and rate limits for sync operations. Some mutations validate an API key (DEPARTMENT_TRAINING_API_KEY).
    - form (src/server/api/routers/formRouter.ts): form builder and review workflow on PostgreSQL (forms, responses). Authorization checks leverage MySQL roles (user_server_roles) joined to the current user’s Discord ID.
    - discord (src/server/api/routers/discordRouter.ts): webhook-like endpoint that updates user rank/team from current Discord roles. Secured by DEPARTMENT_TRAINING_API_KEY.
    - deptMore (src/server/api/routers/department/deptMore.ts): organized sub-routers for analytics, scheduling, equipment, incidents, communications, bulk ops, search, etc., delegating to service modules under src/server/api/services/department.
- Data layer (Drizzle ORM)
  - MySQL (src/server/db):
    - drizzle-orm/mysql2 with pool from DATABASE_URL.
    - schema.ts re-exports tables from ./schema/auth-schema and ./schema/user-schema (users, servers, roles, memberships, mappings, ban history, etc.).
    - Used for better-auth adapter storage and Discord-role-related lookups.
  - PostgreSQL (src/server/postgres):
    - drizzle-orm/postgres-js using PG_URL; exposed as postgrestDb.
    - schema.ts re-exports ./schema/department and ./schema/form.
    - department.ts contains the bulk of domain entities: departments, ranks, teams, members, ID recycling, shifts, meetings, attendance, incidents, equipment, announcements, certifications, performance reviews, and all relations and indexes.
    - form.ts contains forms, categories, responses, and review/approval workflow types.
- Client-side tRPC
  - src/trpc/react.tsx: createTRPCReact with httpBatchStreamLink and SuperJSON. TRPCReactProvider wires a shared TanStack QueryClient and TRPC client.
  - src/trpc/server.ts: server-only hydration helpers for RSC using the same createTRPCContext.
- Auth (better-auth)
  - src/lib/auth.ts: betterAuth + drizzleAdapter(db, provider: "mysql"). Configures Discord as the social provider and nextCookies plugin.
  - src/lib/auth-client.ts: browser client helpers for Discord sign-in/out using NEXT_PUBLIC_URL as base.
- External integrations
  - Discord: The Discord-first approach is described in DISCORD_INTEGRATION.md. Promotions/demotions call a Discord role management API first (secured by M2M_API_KEY/INTERNAL_API_URL); database sync is driven by a webhook that posts the user’s Discord ID to the app, which then recalculates ranks/teams. tRPC endpoints that process Discord-originating updates require DEPARTMENT_TRAINING_API_KEY.
  - PostHog: PostHogProvider initializes with NEXT_PUBLIC_POSTHOG_KEY and captures pageviews manually. A small PostHog server utility exists in src/lib/posthog.ts.

Environment
- Validated via src/env.js using @t3-oss/env-nextjs. Ensure these are set in your environment (or .env) for local dev:
  - Server-side:
    - DATABASE_URL: MySQL connection URL (used by Drizzle MySQL and start-database.sh)
    - PG_URL: PostgreSQL connection URL (used by Drizzle Postgres)
    - BETTER_AUTH_SECRET, BETTER_AUTH_URL
    - DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
    - INTERNAL_API_URL: Base URL for the FastAPI backend used by the admin and user routers
    - M2M_API_KEY: Used for internal API auth to the external service
  - Client-side:
    - NEXT_PUBLIC_URL: Base URL for the app in the browser
  - Additionally used in code (not validated by src/env.js):
    - DEPARTMENT_TRAINING_API_KEY: Required by dept and discord routers for webhook/manual sync endpoints
    - NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST (PostHog)
- You can bypass env validation during build with SKIP_ENV_VALIDATION=1, but production and normal development should set proper values.

Where to add or change functionality
- New backend endpoints: add a procedure in a router under src/server/api/routers, then mount it in src/server/api/root.ts. For department-domain features, prefer PostgreSQL (postgrestDb) and the existing schema in src/server/postgres/schema/department.ts. For auth/user/server/role data, use MySQL (db) and src/server/db/schema/*.
- Client calls: use the generated api.* helpers from src/trpc/react.tsx inside components wrapped by TRPCReactProvider. For RSC, use the helpers in src/trpc/server.ts.

Conventions and important rules (Cursor/PostHog)
- PostHog and feature flags (from .cursor/rules/posthog-integration.mdc):
  - Never invent or inline API keys; always reference env.
  - Keep each feature flag’s usage centralized (avoid scattering the same flag across many locations). If duplication is unavoidable, call it out explicitly for review.
  - Use enums/const objects for flag and property names (UPPERCASE_WITH_UNDERSCORE) and gate code behind explicit checks for valid values.
  - Maintain naming consistency for events and properties; changing names can break analytics.

Operational notes and gotchas
- Discord IDs (Snowflakes) appear as strings at API boundaries but are stored as BIGINT in MySQL. Be mindful of conversions: server code often uses BigInt when querying MySQL; on the client, treat IDs as strings.
- Some department sync endpoints enforce simple rate limits per user to avoid excessive Discord role syncs.
- The admin router relies on ctx.dbUser.apiKey (sourced from MySQL users table). To exercise admin procedures locally, the logged-in user must have a corresponding users row with a non-null apiKey and isAdmin=true.

References
- README.md: Overview, hybrid DB model, setup steps, and domain details.
- DISCORD_INTEGRATION.md: End-to-end flow for Discord-first role synchronization and required env/security.
- DEPARTMENT_ENHANCEMENTS.md: Modules and capabilities under src/server/api/services/department (analytics, scheduling, equipment, incidents, communications, bulk ops, search).

