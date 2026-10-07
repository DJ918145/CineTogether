# CineTogether — Comprehensive Codebase & Architecture Audit

**Target System:** CineTogether Monorepo (`D:\dhruv\CineTogether`)  
**Auditor:** Dwight (`dwight-muydg21w`), Information Gathering & Systems Audit  
**Date:** October 7, 2026  
**Audited Components:** Root Monorepo, `apps/api` (Express 5 / Socket.IO / MongoDB), `apps/web` (React 18 / Vite / React Router 7)  
**Verification Status:** Build verified (`npm run build` passing), Policy unit tests passing (`vitest run` — 8/8 tests pass).

---

## 1. Executive Summary

CineTogether is a synchronized movie-watching web application facilitating private and public rooms, real-time Socket.IO chat, emoji reactions, and video playback synchronization across both authorized direct HTTP(S) video files and official YouTube embeds.

### Key Metrics
- **Workspaces:** Monorepo using `npm` workspaces (`apps/api`, `apps/web`).
- **Core Stacks:** Express 5.1.0, Socket.IO 4.8.1, Mongoose 8.9.5, React 18.3.1, Vite 8.3.2, React Router 7.18.4, Tailwind CSS 3.4.17.
- **Test Coverage:** Policy unit tests exist (`roomPolicy.test.ts`, 8 tests passing). End-to-end and component tests are absent.
- **Production Readiness Score:** **C+ (Moderate Risk)** — Functional for small-scale local or single-instance hosting, but contains critical scalability bottlenecks, unauthenticated media access risks, in-memory state dependencies, and substantial frontend code consolidation debt.

### Severity Breakdown
| Severity | Count | Summary |
|:---|:---:|:---|
| **CRITICAL** | 2 | In-memory socket/playback state prevents horizontal scaling; Public unauthenticated static file serving for uploaded media. |
| **HIGH** | 3 | JWT lacks revocation/invalidation mechanism; Lack of storage adapter (Node.js disk serving 1 GB files); Monolithic frontend architecture (55 KB single-file `App.tsx`). |
| **MEDIUM** | 5 | In-memory rate limiting; Missing database indexes on nested participant fields; MIME-type client spoofing on upload; Unpinned dependencies (`"latest"` in `package.json`); Missing CI/CD pipelines. |
| **LOW** | 4 | No frontend automated test suite; No graceful process termination (`SIGTERM`/`SIGINT`); Weak default JWT secret in non-production; Unused Tailwind utility potential with oversized custom CSS. |

---

## 2. Architecture & Design Review

### 2.1 Workspace Structure
The project is structured as an `npm` workspace:
- `package.json` at root orchestrates dual-service orchestration via `concurrently`.
- `apps/api`: REST endpoints, Socket.IO server, Mongoose models, and video upload handler.
- `apps/web`: Single-Page Application (SPA) compiled with Vite.

```
D:\dhruv\CineTogether\
├── package.json               # Root workspace scripts & dev tooling
├── .env.example               # Template environment configuration
├── API.md                     # REST and Socket.IO API specification
├── README.md                  # Setup, operational guide & architecture summary
├── apps/
│   ├── api/
│   │   ├── package.json       # Express 5, Mongoose, Socket.IO, Multer, Zod
│   │   ├── tsconfig.json      # NodeNext TypeScript configuration
│   │   ├── uploads/           # Local disk video storage
│   │   └── src/
│   │       ├── models.ts      # Mongoose schemas (User, Room, ChatMessage, Media)
│   │       ├── roomPolicy.ts  # Pure deterministic domain rules (tested)
│   │       ├── roomPolicy.test.ts # Vitest suite for room rules
│   │       └── server.ts      # API server, HTTP routes, Socket.IO handlers
│   └── web/
│       ├── package.json       # React, React Router 7, Vite, Lucide, Tailwind
│       ├── vite.config.ts     # Vite bundler config
│       ├── index.html         # HTML entry point
│       └── src/
│           ├── api.ts         # Fetch API client wrapper
│           ├── App.tsx        # Monolithic root component (all views and logic)
│           ├── main.tsx       # DOM root mount
│           └── styles.css     # Bespoke dark-theme styling rules (50 KB)
```

### 2.2 Backend Architecture (`apps/api`)
- **Express 5 Engine:** Uses Express 5.1.0 with native async error handling.
- **Dual Communication Layer:** RESTful API for CRUD operations (auth, rooms, media management) and Socket.IO for duplex communication (playback commands, cursor position, chat stream, presence).
- **Stateless/Stateful Hybrid Problem:**
  - Persisted in MongoDB: Users, Rooms, Participants, Messages, Media records.
  - Retained in Process Memory:
    - `playback: Map<string, { position: number, playing: boolean, updatedAt: number }>`
    - `onlineByRoom: Map<string, Map<string, { sockets: Set<string>, timer?: NodeJS.Timeout }>>`
  - **Architectural Flaw:** Any server restart, crash, or horizontal replica creation desynchronizes or wipes all active playback states and disconnect grace timers.

### 2.3 Frontend Architecture (`apps/web`)
- **Monolithic Component Structure:** `App.tsx` contains 270 lines and 55 KB of code, packing 12 distinct components and multiple modal workflows into a single file (`App`, `Landing`, `Step`, `Protected`, `ProfilePage`, `AuthPage`, `Dashboard`, `RoomPage`, `VideoPlayer`, `ChatPanel`, `PeoplePanel`, `Brand`, `GoogleMark`).
- **Styling Architecture:** Despite configuring Tailwind CSS 3.4.17 with PostCSS, the app almost exclusively relies on custom classes defined in a 50.5 KB `styles.css`. This duplicates effort and bypasses Tailwind's dead-code elimination.
- **Routing:** Modern React Router 7 (`<Routes>`, `<Route>`) with an `<AuthContext>` provider for session persistence.

### 2.4 Real-Time Synchronization Engine
- **Clock Estimation Algorithm:** Evaluates authoritative playback time without writing high-frequency ticks to the database:
  $$\text{Expected Position} = \text{position} + \left(\text{playing} ? \frac{\text{now} - \text{updatedAt}}{1000} : 0\right)$$
- **Client Synchronization:** The client checks drift every 400ms:
  - Native `<video>` drifts $> 1.25$s $\to$ hard seek to expected position.
  - YouTube player drifts $> 1.5$s $\to$ `seekTo(expected, true)`.
- **Authority Validation:** Only the `ownerId` (Admin) can emit `playback:play`, `playback:pause`, and `playback:seek`. Non-admins have UI controls disabled and server rejects unprivileged socket events.
- **Host Transfer & Disconnect Grace Period:** If the admin disconnects, a 12-second grace period (`setTimeout`) allows reconnection before promoting the earliest-joined active participant via `earliestActiveParticipant()`.

---

## 3. Security & Vulnerability Analysis

### 3.1 Authentication & Session Management
- **JWT Storage:** Securely uses `ct_session` HttpOnly cookies (`sameSite: 'lax'` in dev, `'none'` + `secure: true` in prod).
- **Token Invalidation Deficit:** Tokens are signed with a 7-day expiration (`expiresIn: '7d'`). Logout only instructs the client browser to clear the cookie. The token is stateless and not tracked in a revocation blocklist or database session table. Stolen tokens remain valid for the full 7-day duration.
- **Default Secret Fallback:**
  ```typescript
  const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-me';
  ```
  While `NODE_ENV === 'production'` enforces `process.env.JWT_SECRET`, running in staging or misconfigured production without `NODE_ENV=production` silently falls back to the publicly known string.

### 3.2 Authorization & Access Control
- **Room Isolation:** Private rooms enforce membership checks before returning details, messages, or permitting socket joins.
- **Socket Authentication:** `io.use()` middleware parses `ct_session` cookie and verifies JWT before establishing connection.
- **Admin Privilege Enforcement:** REST mutation routes (`/transfer-admin`, `/remove-participant`, `/settings`, `DELETE /rooms/:roomCode`, `/rooms/:roomCode/media`) verify `room.ownerId === req.user.id`.

### 3.3 File Upload Security & Media Storage
- **Unrestricted File Access (CRITICAL):**
  Uploaded video files are stored in `./uploads` with random filenames and exposed globally via:
  ```typescript
  app.use('/uploads', express.static(uploadDir, { maxAge: '1d', dotfiles: 'deny' }));
  ```
  Anyone with the URL can access and stream the uploaded file without logging in or verifying room membership.
- **Client MIME Spoofing (MEDIUM):**
  Multer relies entirely on `file.mimetype` provided by the client header:
  ```typescript
  fileFilter: (_req, file, cb) => cb(null, ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'].includes(file.mimetype))
  ```
  An attacker can rename arbitrary binary payloads or malicious files to `.mp4` and pass a forged `video/mp4` MIME type. File magic numbers (first bytes) are not inspected.
- **Resource Exhaustion / DoS via Uploads:**
  The upload limit is 1 GB (`fileSize: 1024 * 1024 * 1024`). Express buffers and writes this directly to local disk without chunked streaming to object storage or rate limiting upload concurrency. Multiple concurrent 1 GB uploads could rapidly exhaust server disk space and bandwidth.

### 3.4 Input Validation & Sanitization
- **Zod Validation:** Effectively applied to request bodies in registration, login, profile updates, and room operations.
- **Room Codes:** Employs a non-ambiguous 32-character base alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), avoiding confusion between `0/O` and `1/I`.
- **Chat Injection:** Socket chat messages are strictly validated as strings, trimmed, and clamped to 500 characters.

### 3.5 OAuth 2.0 Security
- **CSRF State Verification:** Google OAuth implements a cryptographic 32-byte hex token stored in a short-lived `ct_oauth_state` cookie (10-minute expiry) and compares it with `req.query.state` on callback.
- **Email Verification Guard:** Checks `profile.verified_email === true` before linking or creating accounts.

---

## 4. Dependencies & Configuration Audit

### 4.1 Dependency Hygiene
- **`apps/web/package.json` Anti-Pattern:**
  `vite: "latest"` and `@vitejs/plugin-react: "latest"` are declared as `"latest"`. This breaks reproducible builds across environments. Fixed semver ranges (e.g. `^5.4.0` or lockfile pinned) must replace `"latest"`.
- **Modern Package Baseline:**
  - `express`: `^5.1.0` (Express 5 adoption is clean and leverages native Promise handling).
  - `mongoose`: `^8.9.5` (Modern version, no deprecated connection options).
  - `react`: `^18.3.1` / `react-dom`: `^18.3.1`.

### 4.2 Configuration & Environment Variables
- **Missing Schema Validation:** Environment variables (`PORT`, `CLIENT_ORIGIN`, `MONGODB_URI`, `JWT_SECRET`, etc.) are read directly from `process.env` without a unified startup validation schema (e.g., via `zod` or `envalid`).
- **Production Email Gap:** Password reset in non-production returns `resetUrl` in the JSON response. In production, no mailer integration (SendGrid, Postmark, AWS SES) is currently hooked up, rendering production password recovery inoperative.

---

## 5. Scalability & Performance Analysis

### 5.1 Horizontal Scaling Impediment
- **In-Memory Sockets & Maps:**
  Socket.IO is bound directly to the local Node HTTP server without `@socket.io/redis-adapter` or `@socket.io/redis-streams-adapter`.
  If deployed on multiple instances (Render horizontally scaled, Kubernetes, or multi-core PM2 cluster), users connected to different server instances will **not** receive room broadcasts, presence updates, or playback sync.

### 5.2 Video Streaming via Node Process
- **Disk I/O and Event Loop Contention:**
  Serving up to 1 GB video files via `express.static` uses the Node.js event loop and file system I/O to stream media chunks. In production, video delivery should be delegated to AWS S3 / Cloudflare R2 with signed CloudFront/CDN URLs, completely offloading video streaming from the application server.

### 5.3 Database Indexing & Query Profiling
- **Existing Indexes:**
  - `User`: `email: 1` (unique), `googleId: 1` (unique, sparse).
  - `Room`: `roomCode: 1` (unique).
  - `ChatMessage`: `{ roomId: 1, createdAt: -1 }`.
  - `Media`: `{ ownerId: 1, createdAt: -1 }`.
- **Missing Index Deficit:**
  - Route `GET /api/rooms` executes:
    ```typescript
    Room.find({ 'participants.userId': req.user.id, status: { $ne: 'closed' } }).sort({ updatedAt: -1 })
    ```
    Neither `'participants.userId'` nor `status` has an index on `RoomSchema`. As room history grows, this causes a full collection scan across all rooms.

---

## 6. Code Quality, Maintainability & Test Coverage

### 6.1 Code Organization Debt
- **Monolithic `App.tsx`:**
  - 55 KB single file containing all client logic.
  - Breaches Single Responsibility Principle.
  - High merge-conflict surface area for collaborative development.
  - **Recommendation:** Refactor into modular architecture:
    ```
    apps/web/src/
    ├── components/
    │   ├── common/        (Brand, GoogleMark, Step, Modal)
    │   ├── player/        (VideoPlayer, Controls, Overlay)
    │   ├── room/          (ChatPanel, PeoplePanel, SettingsModal)
    │   └── ui/            (Buttons, Inputs, Avatar)
    ├── pages/             (Landing, AuthPage, Dashboard, RoomPage, ProfilePage)
    ├── hooks/             (useRoomSocket, usePlaybackSync, useAuth)
    └── types/             (models, events)
    ```

### 6.2 Test Coverage Analysis
- **Existing Coverage:**
  - `roomPolicy.test.ts` (8 tests):
    - Earliest participant selection on disconnect.
    - Authoritative elapsed playback calculation.
    - YouTube URL parsing and ID extraction.
    - Unsupported streaming service rejection.
- **Coverage Deficits:**
  - **Zero Frontend Tests:** No Vitest or React Testing Library tests for UI components, form validation, or playback state controls.
  - **Zero Integration / API Tests:** Despite having `supertest` installed in `apps/api/package.json`, there are no API integration tests verifying registration, authentication cookies, room lifecycle, or socket authentication.

---

## 7. Production Readiness Checklist & Roadmap

### Priority 1: Critical Security & Integrity (Immediate)
1. **Protected Media Storage:** Replace unauthenticated `app.use('/uploads', express.static)` with an authorized endpoint that checks room participation or user ownership before streaming file streams.
2. **File Content Magic-Byte Inspection:** Integrate `file-type` to inspect the initial bytes of uploaded files, ensuring binary content matches genuine MP4/WebM/OGG containers before saving.
3. **Environment Startup Validation:** Implement a startup check using Zod validating all required configuration variables, refusing to start with invalid configurations regardless of `NODE_ENV`.

### Priority 2: Scalability & Infrastructure (Near-Term)
4. **Socket.IO Redis Adapter:** Introduce Redis and `@socket.io/redis-adapter` alongside a Redis-backed playback and presence cache to allow horizontal scaling.
5. **Cloud Object Storage Adapter:** Migrate from local disk Multer storage to S3/Cloudflare R2 pre-signed upload URLs and CDN streaming.
6. **MongoDB Index Optimization:** Add multikey index `{ 'participants.userId': 1, status: 1 }` to `RoomSchema`.

### Priority 3: Architecture & Maintainability (Mid-Term)
7. **Deconstruct `App.tsx`:** Modularize into dedicated component, page, and hook directories.
8. **Automated Testing & CI/CD:**
   - Add integration tests using `supertest` for core REST flows.
   - Introduce GitHub Actions workflow in `.github/workflows/ci.yml` running linting, build checks, and tests on push.
9. **Pin Dependencies:** Fix `"latest"` references in `apps/web/package.json` to fixed semver tags.
10. **Transactional Email Integration:** Implement an email provider adapter for password reset links in production.

---

*Report prepared and filed by Dwight (`dwight-muydg21w`) pursuant to hive dispatch instructions.*
