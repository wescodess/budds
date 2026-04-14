# Budds - Data Models

**Date:** 2026-04-08

## Database Overview

Budds uses two data storage systems:

1. **SQLite** (`data/auth.db`) - Managed by Better Auth for authentication data
2. **Convex** (cloud-hosted) - Backend-as-a-service for application data (schema defined but empty)

## SQLite - Authentication Database

**Location:** `data/auth.db` (gitignored, auto-created on first run)
**Driver:** better-sqlite3 v12.8.0
**Managed by:** Better Auth v1.6.0

Better Auth automatically creates and manages the following tables:

### `user`

| Column | Type | Description |
|---|---|---|
| id | TEXT (PK) | Unique user identifier |
| name | TEXT | Display name from OAuth provider |
| email | TEXT (UNIQUE) | Email address |
| emailVerified | BOOLEAN | Whether email is verified |
| image | TEXT | Profile image URL |
| createdAt | DATETIME | Account creation timestamp |
| updatedAt | DATETIME | Last update timestamp |

### `session`

| Column | Type | Description |
|---|---|---|
| id | TEXT (PK) | Session identifier |
| userId | TEXT (FK → user.id) | Associated user |
| token | TEXT (UNIQUE) | Session token (stored in cookie) |
| expiresAt | DATETIME | Session expiration |
| ipAddress | TEXT | Client IP address |
| userAgent | TEXT | Client user agent |
| createdAt | DATETIME | Session creation timestamp |
| updatedAt | DATETIME | Last update timestamp |

### `account`

| Column | Type | Description |
|---|---|---|
| id | TEXT (PK) | Account link identifier |
| userId | TEXT (FK → user.id) | Associated user |
| accountId | TEXT | Provider-specific user ID |
| providerId | TEXT | OAuth provider name (e.g., "google") |
| accessToken | TEXT | OAuth access token |
| refreshToken | TEXT | OAuth refresh token |
| accessTokenExpiresAt | DATETIME | Token expiration |
| scope | TEXT | OAuth scopes granted |
| idToken | TEXT | OpenID Connect ID token |
| createdAt | DATETIME | Link creation timestamp |
| updatedAt | DATETIME | Last update timestamp |

### `verification`

| Column | Type | Description |
|---|---|---|
| id | TEXT (PK) | Verification identifier |
| identifier | TEXT | What's being verified (email, etc.) |
| value | TEXT | Verification token/code |
| expiresAt | DATETIME | Verification expiration |
| createdAt | DATETIME | Creation timestamp |
| updatedAt | DATETIME | Last update timestamp |

### Relationships

```
user (1) ──── (*) session     # One user has many sessions
user (1) ──── (*) account     # One user has many OAuth accounts
user (1) ──── (*) verification # One user has many verification tokens
```

## Convex - Application Database

**Configuration:** `convex/convex.config.ts`
**Schema:** `convex/schema.ts`

The Convex schema is currently empty:

```typescript
import { defineSchema } from "convex/server";

export default defineSchema({});
```

No application tables have been defined yet. Convex is configured and ready for use with the `nuxt-convex` module integration. When tables are added, Convex provides:

- Real-time subscriptions
- Automatic type generation
- ACID transactions
- Server functions (queries, mutations, actions)

### Convex Environment

| Variable | Purpose |
|---|---|
| `CONVEX_URL` | Production Convex deployment endpoint |
| `CONVEX_DEPLOYMENT` | Local development deployment ID (in `.env.local`) |

## Data Flow

### Authentication Data Flow

1. User initiates Google OAuth → Better Auth creates `account` record
2. On successful auth → Better Auth creates `user` record (if new) and `session` record
3. Session token stored in HTTP cookie
4. On each request → Better Auth validates session token against `session` table
5. On sign-out → Session record marked expired/deleted

### RAG Data Flow (No Persistent Storage)

The RAG chat system currently has no persistent data storage:
- Chat messages are held in client-side Vue reactive state (`useRag()` composable)
- Document index lives in Cloudflare AI Search (external)
- LLM responses are not saved

This means:
- Chat history is lost on page refresh
- No user-specific chat history
- No conversation persistence across sessions

### Future Data Opportunities (Convex)

The empty Convex schema suggests planned features that may include:
- Chat conversation history persistence
- User preferences and settings
- Document upload/management metadata
- Usage analytics and quotas

---

_Generated using BMAD Method `document-project` workflow_
