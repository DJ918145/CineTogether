# CineTogether — Comprehensive System Design & Technical Interview Preparation Guide

**Author**: Meredith (`meredith-muyhuljv`), Documentation & System Design Architect  
**Project**: CineTogether (`D:\dhruv\CineTogether`)  
**Target Audience**: Software Engineers, System Design Interview Candidates, Technical Leads  
**Version**: 1.0 (Production Release / Munder Difflin v0.5.5)  
**Date**: October 8, 2026  

---

## Table of Contents

1. [Executive Summary & System Overview](#1-executive-summary--system-overview)
2. [Technology Stack & Architectural Rationale](#2-technology-stack--architectural-rationale)
3. [Multi-Agent Collaborative Engineering Approach](#3-multi-agent-collaborative-engineering-approach)
4. [System Architecture & Client-Server Topology](#4-system-architecture--client-server-topology)
5. [Authoritative Playback Synchronization Engine (Deep-Dive)](#5-authoritative-playback-synchronization-engine-deep-dive)
6. [Room Lifecycle, Host Election & Disconnect Grace Period](#6-room-lifecycle-host-election--disconnect-grace-period)
7. [Media Streaming Pipeline & Cloud Storage Architecture](#7-media-streaming-pipeline--cloud-storage-architecture)
8. [Horizontal Scaling & Redis Distributed Architecture](#8-horizontal-scaling--redis-distributed-architecture)
9. [Security, Rate Limiting & WCAG Accessibility](#9-security-rate-limiting--wcag-accessibility)
10. [Top 15 Technical Interview Questions & Staff-Level Answers](#10-top-15-technical-interview-questions--staff-level-answers)
11. [System Metrics, Numerical Constants & Quick-Reference Cheat Sheet](#11-system-metrics-numerical-constants--quick-reference-cheat-sheet)

---

## 1. Executive Summary & System Overview

**CineTogether** is a production-grade, full-stack collaborative cinema platform designed for synchronized video playback, real-time interactive chat, participant presence tracking, and synchronized emoji reactions in private and public virtual rooms.

### Core Value Proposition
Traditional watch-party solutions frequently suffer from:
- **Playback Drift**: Viewers slowly fall out of sync due to packet loss, differing hardware decoding speeds, and local buffering pauses.
- **Host Disconnect Fragility**: The room abruptly terminates or loses playback synchronization when the room host briefly reloads the page or loses Wi-Fi connection.
- **Database Write Saturation**: Naive architectures write player position timestamps to databases continuously (e.g., every 500ms per room), causing database I/O collapse at scale.
- **Complex Peer-to-Peer Topologies**: WebRTC mesh topologies scale poorly ($O(N^2)$ bandwidth per room), requiring heavy STUN/TURN infrastructure.

CineTogether addresses these engineering hurdles with a **hybrid client-server authoritative synchronization model**:
1. **Server-Authoritative Clock Estimation**: The backend estimates playback position on demand using a mathematical formula based on the last authoritative command timestamp, eliminating database writes entirely for playback ticks.
2. **Dual-Layer Drift Correction**: Clients execute a 500ms local correction loop with a $\pm 1.25$-second deadband threshold to smoothly pull drifting viewers into sync without micro-stuttering.
3. **Fault-Tolerant Host Succession**: A 12-second disconnected socket grace period prevents split-brain elections during page reloads, coupled with an automatic deterministic successor election algorithm (`earliestActiveParticipant`).
4. **Decoupled Scrubbing & Keyboard Accessibility**: UI scrub bars decouple dragging state from authoritative playback updates, eliminating slider jitter and race conditions.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CINETOGETHER ARCHITECTURE                        │
│                                                                             │
│   [ Client Browser ]          [ API Server: Node 22 / Express 5 ]           │
│   ┌──────────────┐             ┌────────────────────────────────────────┐   │
│   │ React 18 SPA │             │  Socket.IO Gateway & State Engine      │   │
│   │ Video Player │◄───WSS─────►│  • In-Memory Playback State Map        │   │
│   │ Drift Loop   │  (Bidirect) │  • 12s Socket Grace Period Timers      │   │
│   │ Chat Panel   │             │  • Rate Limiters & Auth Verification   │   │
│   └──────────────┘             └──────────────────┬─────────────────────┘   │
│          │                                        │                         │
│     HTTPS (REST)                             Mongoose / TLS                 │
│          │                                        │                         │
│          ▼                                        ▼                         │
│   ┌──────────────┐                     ┌────────────────────┐               │
│   │ Video Stream │                     │ MongoDB Atlas (M0+)│               │
│   │ Byte Ranges  │                     │ Users, Rooms, Chat │               │
│   └──────────────┘                     └────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack & Architectural Rationale

| Layer | Technology | Version | Rationale & Trade-offs |
|:---|:---|:---|:---|
| **Frontend Framework** | React 18 | `^18.3.1` | Declarative UI component tree, fast re-renders with concurrent capabilities, rich ecosystem for media events and refs. |
| **Frontend Build Tool** | Vite | `^8.3.2` | Instant HMR, zero-overhead ES module bundling, minimal bundle output (288 kB JS gzip 90 kB). Faster build times than Webpack/Next.js for single-page applications. |
| **Routing** | React Router | `^7.1.5` | Client-side routing with clean URL parameters (`/room/:roomCode`, `/login`, `/app`, `/profile`), preventing unnecessary server round-trips. |
| **Styling & CSS** | Custom Scoped CSS + Tailwind | `^3.4.17` | Zero runtime styling overhead. Handcrafted CSS token system (`styles.css`) ensures sub-millisecond layout passes, paired with Tailwind for atomic utilities. |
| **Backend Runtime** | Node.js | `22.x LTS` | Non-blocking asynchronous I/O, native event loop, low memory footprint, first-class WebSocket and buffer stream support. |
| **HTTP Framework** | Express | `5.0.1` | Native Promise support in routes (no unhandled async rejection crashes), lightweight middleware pipeline, proven battle-tested reliability. |
| **Real-time Engine** | Socket.IO | `^4.8.1` | Full-duplex WebSocket communication with transparent HTTP long-polling fallback, automatic reconnection, room multiplexing, and binary/JSON event protocol. |
| **Database** | MongoDB + Mongoose | `^8.9.5` | Flexible JSON document model ideal for nested room participants, array operations (`$elemMatch`, `$mergeObjects`), and fast read lookups. |
| **Validation** | Zod | `^3.24.2` | Runtime schema validation with compile-time TypeScript type inference, guaranteeing contract safety across REST endpoints. |
| **Authentication** | JWT (`ct_session`) | `^9.0.2` | Stateless 7-day cryptographic tokens stored exclusively in `HttpOnly`, `SameSite=None`, `Secure` cookies. Eliminates XSS token theft. |
| **Password Security** | bcryptjs | `^2.4.3` | Adaptive salt rounds (12 work factor) for slow hashing, mitigating offline dictionary and brute-force attacks. |
| **Media Ingestion** | Multer | `^1.4.5-lts` | Streaming multipart/form-data upload handling directly to disk or cloud buffers with strict 1 GB file size limits and MIME filtering. |

### Architectural Trade-off Analysis: Why WebSockets over Alternatives?

1. **WebSockets vs. HTTP Short / Long-Polling**:
   - *HTTP Polling*: Introducing 500ms polling for 20 users in a room results in 40 requests/sec per room. 1,000 rooms would inundate the API with 40,000 HTTP req/sec, incurring massive TCP handshake/header overhead.
   - *WebSockets*: Single persistent TCP connection per client. A 30-byte JSON frame carries playback events with negligible framing overhead ($<0.1$ms server dispatch latency).

2. **WebSockets vs. WebRTC DataChannels**:
   - *WebRTC*: Ideal for peer-to-peer audio/video. However, for synchronized playback control, WebRTC requires complex mesh signaling and $N \times (N-1)$ data channels. If the host has poor upstream bandwidth, peer mesh degrades immediately.
   - *Socket.IO Client-Server*: The server acts as the single source of truth (authoritative clock). Clients upload control intents to the server; the server broadcasts the canonical state to all participants.

3. **WebSockets vs. Server-Sent Events (SSE)**:
   - *SSE*: Unidirectional (server-to-client only). Client actions (play, pause, seek, chat, reactions) would still require separate HTTP POST requests, creating connection bifurcations and ordering race conditions.

---

## 3. Multi-Agent Collaborative Engineering Approach

CineTogether was audited, engineered, hardened, and verified through a specialized office of collaborative autonomous agents adhering to the strict **Hive Protocol** (`D:\HarnessAgents\hive\PROTOCOL.md`).

```
                    ┌──────────────────────────────────┐
                    │          Michael (god)           │
                    │   Project Owner & Orchestrator   │
                    │  • Task Ledger (`tasks.json`)    │
                    │  • Strategic Milestones          │
                    └─────────────────┬────────────────┘
                                      │
         ┌──────────────┬─────────────┼──────────────┬──────────────┐
         ▼              ▼             ▼              ▼              ▼
  ┌──────────────┐┌────────────┐┌────────────┐┌────────────┐┌─────────────┐
  │    Dwight    ││   Avatar   ││    Jim     ││    Pam     ││  Meredith   │
  │ Info Analyst ││ UX / Asset ││  QA Lead   ││ Full-Stack ││ System Docs │
  │ Architecture ││ WCAG & A11y││ Bug Hunter ││  Engineer  ││  Architect  │
  │    Audit     ││   Review   ││ Regression ││ Hardening  ││ Interview   │
  └──────────────┘└────────────┘└────────────┘└────────────┘└─────────────┘
```

### Team Roster & Division of Responsibilities

1. **Michael (`god`) — Senior Project Owner & Lead Orchestrator**:
   - Formulated the project roadmap across Phases 1–4.
   - Maintained `board.md` and `tasks.json` as the sole authorized scribe.
   - Monitored agent health via `fleet.json` and handled lifecycle handoffs.
2. **Dwight (`dwight-muydg21w`) — Information Analyst & Research Agent**:
   - Executed **Task HAG-1**: Authored the comprehensive architecture audit ([`AUDIT.md`](file:///D:/dhruv/CineTogether/AUDIT.md)), identifying in-memory bottlenecks, stateless token expiration risks, and cloud storage recommendations.
   - Executed **Task HAG-9**: Authored the complete production publishing guide ([`PUBLISHING_GUIDE.md`](file:///D:/dhruv/CineTogether/PUBLISHING_GUIDE.md)), detailing Vercel, Render, and MongoDB Atlas setups.
3. **Avatar (`avatar-muydc886`) — UI / UX & Design Specialist**:
   - Executed **Task HAG-3**: Delivered [`UI_EVALUATION.md`](file:///D:/dhruv/CineTogether/UI_EVALUATION.md), uncovering the critical destructive room closure coupling bug, illegible micro-typography ($<9$px), and missing upload progress indicators.
4. **Jim (`jim-muyddny0`) — Senior QA Lead & Root-Cause Bug Hunter**:
   - Executed **Task HAG-2**: Identified 12 critical defects ([`QA_REPORT.md`](file:///D:/dhruv/CineTogether/QA_REPORT.md)) spanning host demotion, seek race conditions, drift desync, and unhandled Mongoose `CastError`s.
   - Executed **Task HAG-8**: Verified all fixes in [`FINAL_QA_REPORT.md`](file:///D:/dhruv/CineTogether/FINAL_QA_REPORT.md), certifying 8/8 automated test suites passing and production release readiness.
5. **Pam (`pam-muycfg93`) — Senior Full-Stack Implementation Developer**:
   - Executed **Tasks HAG-4, HAG-5, HAG-6, HAG-7**: Fixed backend room logic in `server.ts`, built the 500ms frontend drift correction loop and decoupled scrubbing in `App.tsx`, implemented the dedicated Room Settings modal (`PATCH /api/rooms/:roomCode/settings`), dark confirmation dialogs, and WCAG AA typography.
6. **Meredith (`meredith-muyhuljv`) — Documentation & System Design Architect**:
   - Executed **Task HAG-10**: Synthesized the architectural blueprints, algorithmic proofs, failure mode resolutions, and technical interview knowledge base into this authoritative reference.

---

## 4. System Architecture & Client-Server Topology

### Client-Server Topology

```
[ User Browser 1 (Host) ]     [ User Browser 2 (Guest) ]     [ User Browser 3 (Guest) ]
         │                               │                               │
         │  HTTPS / WSS                  │  HTTPS / WSS                  │  HTTPS / WSS
         └───────────────────────┬───────┴───────────────────────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │  Vercel Edge Network  │ (Static SPA Hosting)
                     │  `apps/web` (Vite)    │
                     └───────────┬───────────┘
                                 │ Reverse Proxy / API Gateway
                                 ▼
                     ┌───────────────────────┐
                     │ Render Web Service    │
                     │ Node.js 22 + Express 5│
                     │ Socket.IO Server      │
                     └───────────┬───────────┘
                                 │
                ┌────────────────┴────────────────┐
                ▼                                 ▼
     ┌───────────────────────┐         ┌───────────────────────┐
     │ MongoDB Atlas Cluster │         │ Local Disk / S3 Media │
     │ Persistent Storage:   │         │ HTTP 206 Partial Cont │
     │ Users, Rooms, Chat    │         │ Video File Streaming  │
     └───────────────────────┘         └───────────────────────┘
```

### Complete WebSocket Event Taxonomy

| Event Name | Direction | Payload Structure | Architectural Function |
|:---|:---|:---|:---|
| `room:join` | Client $\to$ Server | `{ roomCode: string }` | Client initiates connection to a room. Server verifies user membership in DB, registers socket to room room-channel, and sends initial snapshots. |
| `room:state` | Server $\to$ Client | `{ room: RoomDTO, playback: PlaybackState, adminChanged?: boolean }` | Full synchronization packet containing room metadata, participant roster, and authoritative playback state. |
| `chat:history` | Server $\to$ Client | `ChatMessageDTO[]` | Delivers the last 40 chat messages on room entry. |
| `presence:update` | Server $\to$ Client | `{ userId: string, online: boolean }` | Broadcasts active connection/disconnection changes in real-time. |
| `playback:play` | Client $\to$ Server | `{ position?: number }` | Admin requests playback resumption. Validated against room ownership. |
| `playback:pause` | Client $\to$ Server | `{ position?: number }` | Admin requests playback pause. Position is calculated authoritatively. |
| `playback:seek` | Client $\to$ Server | `{ position: number }` | Admin seeks to target second. Broadcasts target time to all viewers. |
| `playback:sync` | Server $\to$ Client | `{ position: number, playing: boolean, updatedAt: number, changedBy: string }` | Canonical playback clock snapshot dispatched to all room participants. |
| `playback:movie-change`| Server $\to$ Client | `{ media: MediaDTO }` | Admin selects new movie URL or library item; resets room playback clock. |
| `playback:ended` | Server $\to$ Client | *empty* | Video reached completion; playback timer resets to 0. |
| `chat:send` | Client $\to$ Server | `{ message: string }` | Sends chat text. Subject to rate limits (max 8 messages per 10s). |
| `chat:message` | Server $\to$ Client | `ChatMessageDTO` | Broadcasts user message or automated system notification. |
| `reaction:send` | Client $\to$ Server | `{ emoji: string }` | Transmits an emoji reaction (whitelisted: ❤️, 😂, 👏, 😮, 🔥, 😭). |
| `reaction:received` | Server $\to$ Client | `{ emoji: string, userId: string, name: string }` | Triggers floating emoji animation across all room client viewports. |
| `participants:update` | Server $\to$ Client | `ParticipantDTO[]` | Dispatches refreshed participant roster (roles, active states). |
| `room:closed` | Server $\to$ Client | *empty* | Admin closed room; kicks sockets and cleans up memory state. |
| `room:error` | Server $\to$ Client | `{ message: string }` | Communicates unauthorized actions, throttling alerts, or room faults. |

---

## 5. Authoritative Playback Synchronization Engine (Deep-Dive)

The fundamental engineering challenge of synchronized video streaming across wide-area networks is **playback entropy**: network jitter, variable buffer capacities, browser background throttling, and user interactions naturally cause clocks to drift.

CineTogether solves this with a **Server-Authoritative Clock Estimation Model** combined with **Client-Side Drift Correction**.

### 5.1 The Mathematical Estimation Algorithm

The server never increments playback position continuously via a tick loop. Instead, the server stores a lightweight state tuple in an in-memory `Map<string, PlaybackState>`:

$$\text{PlaybackState} = \{ \text{position: float}, \text{playing: boolean}, \text{updatedAt: unix\_timestamp\_ms} \}$$

When an action occurs (e.g. host pauses, guest joins, or host seeks), the current authoritative position is calculated deterministically via `expectedPlaybackPosition`:

$$\text{Position}_{\text{authoritative}}(t_{\text{now}}) = \max\left(0, \text{State.position} + \begin{cases} \frac{t_{\text{now}} - \text{State.updatedAt}}{1000} & \text{if State.playing} = \text{true} \\ 0 & \text{if State.playing} = \text{false} \end{cases}\right)$$

#### Source Implementation (`apps/api/src/roomPolicy.ts`):
```typescript
/** Estimate playback position from a server-authored state snapshot. */
export function expectedPlaybackPosition(
  state: { position: number; playing: boolean; updatedAt: number },
  now = Date.now()
): number {
  return Math.max(
    0,
    state.position + (state.playing ? Math.max(0, now - state.updatedAt) / 1000 : 0)
  );
}
```

### 5.2 Server Event Handler (`playEvent` in `server.ts`)

When an admin client triggers a play, pause, or seek command, the backend executes the following atomic sequence:

```typescript
const playEvent = async (event: 'playback:play' | 'playback:pause' | 'playback:seek', data: { position?: number }) => {
  const id = socket.data.roomId as string | undefined; 
  if (!id) return;
  
  // 1. Authorization check against MongoDB Room Owner
  const room = await Room.findById(id); 
  if (!room || String(room.ownerId) !== user.id) {
    return socket.emit('room:error', { message: 'Only the room admin can control playback.' });
  }

  const now = Date.now();
  const prev = playback.get(id) || { position: 0, playing: false, updatedAt: now };

  // 2. Authoritative Position Calculation (BUG-02 Resolution)
  const currentEstimated = expectedPlaybackPosition(prev, now);
  const targetPos = (typeof data?.position === 'number' && !Number.isNaN(data.position)) 
    ? data.position 
    : currentEstimated;
    
  // 3. Boundary Clamping (0 to 24 hours)
  const position = Math.max(0, Math.min(Number(targetPos) || 0, 24 * 60 * 60));
  const playing = event === 'playback:play' ? true : event === 'playback:pause' ? false : prev.playing;

  // 4. In-Memory Atomic Mutation
  const state = { position, playing, updatedAt: now };
  playback.set(id, state);
  prunePlaybackMap();

  // 5. Zero-Latency Broadcast to All Room Sockets
  io.to(id).emit('playback:sync', { ...state, changedBy: user.id });
};
```

### 5.3 Client-Side Dual-Layer Drift Correction Loop

In `apps/web/src/App.tsx`, the frontend employs two distinct synchronization mechanisms:

1. **Instant Event-Driven Alignment**: Whenever a `playback:sync` socket packet arrives, the client computes `currentExpected` and immediately sets `currentTime` or calls `seekTo()`.
2. **Continuous 500ms Drift-Correction Loop**: To handle local video buffering and packet latency differences during steady playback, an active interval loop evaluates time drift every 500ms.

#### The 1.25-Second Deadband Threshold
If a viewer's local playback diverges from the authoritative server estimate by more than **1.25 seconds**, the player forces a hard seek to catch up. Divergence under 1.25s is ignored.

*Why a 1.25s deadband?*  
Setting the threshold too low (e.g., 200ms) causes continuous micro-buffering and audio stuttering due to normal network jitter. Setting it too high (e.g., 5s) leads to noticeable spoilers between participants. 1.25 seconds balances tight synchronization with smooth playback.

#### Continuous Drift Loop Code (`apps/web/src/App.tsx`):
```typescript
useEffect(() => {
  if (!playback.playing || !media?.url) return;
  const interval = window.setInterval(() => {
    // 1. Suppress correction during active user scrubbing
    if (scrubTime !== null) return;

    // 2. Compute authoritative target
    const currentExpected = Math.max(
      0,
      playback.position + (playback.playing ? Math.max(0, (Date.now() - playback.updatedAt) / 1000) : 0)
    );

    // 3. Evaluate drift against active player implementation
    if (youtubeId) {
      const player = youtubeRef.current;
      if (!youtubeReady || !player) return;
      const current = player.getCurrentTime() || 0;
      if (Math.abs(current - currentExpected) > 1.25) {
        player.seekTo(currentExpected, true);
      }
    } else {
      const video = videoRef.current;
      if (!video) return;
      if (Math.abs(video.currentTime - currentExpected) > 1.25) {
        video.currentTime = currentExpected;
      }
    }
  }, 500);

  return () => window.clearInterval(interval);
}, [playback.playing, playback.position, playback.updatedAt, media?.url, youtubeId, youtubeReady, scrubTime]);
```

### 5.4 Scrub Bar Decoupling (BUG-03 Resolution)

In naive player implementations, binding an `<input type="range">` directly to `video.currentTime` causes severe scrub fighting: while the user drags the slider, background `timeupdate` events trigger re-renders that rip the slider thumb back to the playing position.

CineTogether decouples slider state using three variables:
- `time`: The committed, rendered video playback time.
- `scrubTime`: A nullable float representing the active drag coordinate (`number | null`).
- `commitSeek(target)`: Invoked strictly on `onPointerUp`, `onMouseUp`, `onTouchEnd`, or `onKeyUp`.

```typescript
const commitSeek = (targetValue: number) => {
  const target = Math.max(0, Math.min(targetValue, duration || 24 * 60 * 60));
  setScrubTime(null); // Release drag lock
  setTime(target);
  seek(target);
  emit('playback:seek', { position: target }); // Authoritative broadcast
};
```

---

## 6. Room Lifecycle, Host Election & Disconnect Grace Period

### 6.1 The Disconnect Grace Period (12-Second Network Tolerance)

Web applications running over mobile networks or Wi-Fi experience transient disconnects (airplane mode toggles, tab backgrounding, page reloads). If an admin reloading their browser causes an instantaneous host election, room ownership rapidly bounces between participants.

CineTogether implements a **12-second grace period** using a socket set mapping:

```typescript
// Nested map tracking active socket IDs per user per room
const onlineByRoom = new Map<string, Map<string, { sockets: Set<string>; timer?: NodeJS.Timeout }>>();
```

#### Disconnect Algorithm:
1. When a socket disconnects, the socket ID is removed from `entry.sockets`.
2. If `entry.sockets.size === 0` (no other active tabs for that user in the room), a **12-second countdown timer** is armed.
3. If the user reconnects within 12 seconds, the new socket joins `entry.sockets` and the timer is immediately aborted (`clearTimeout(entry.timer)`).
4. Only if the 12-second timer expires without reconnection does the server invoke `leaveRoom()`.

```
[ Host Closes Tab / Reloads ]
             │
             ▼
[ Socket 'disconnect' Fires ]
             │
             ├─► User has other active tabs? ──► YES: Retain Admin status.
             │
             └─► NO: Arm 12,000ms Timer
                     │
                     ├── User reconnects within 12s? ──► YES: `clearTimeout()`, retain Admin.
                     │
                     └── Timer Expires ───────────────► NO: Invoke `leaveRoom()`, elect Successor.
```

### 6.2 Host Election Algorithm (`earliestActiveParticipant`)

When the room owner explicitly leaves (`POST /api/rooms/:roomCode/leave`) or their 12-second disconnect timer elapses, the server executes deterministic successor promotion:

```typescript
export function earliestActiveParticipant<T extends RoomParticipantLike>(participants: T[]): T | null {
  return participants
    .filter((participant) => participant.isActive)
    .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime())[0] ?? null;
}
```

#### Why Seniority (`joinedAt` ASC) over Random or Last-Active?
- **Predictability**: All participants know who is next in line.
- **Sybil Resistance**: A troll joining immediately before a host departure cannot hijack room administration.
- **Fairness**: The longest-standing guest inherits control.

### 6.3 Rejoining Demotion Protocol (BUG-01 Resolution)

Prior to the fix in task HAG-4, a former host who left the room remained marked as `role: 'ADMIN'` in the database with `isActive: false`. When they rejoined, their record retained `ADMIN`, creating a **split-brain multi-host room** where the original host and the promoted host both held admin privileges.

The hardened protocol in `server.ts` guarantees single-owner invariant:
1. When leaving, `participant.role = 'MEMBER'`.
2. When rejoining (`/join`), the participant is demoted to `MEMBER` unless their `userId` matches the current `room.ownerId`:
   ```typescript
   if (existing) {
     existing.isActive = true;
     existing.joinedAt = new Date();
     if (String(existing.userId) !== String(room.ownerId)) {
       existing.role = 'MEMBER';
     }
   }
   ```

---

## 7. Media Streaming Pipeline & Cloud Storage Architecture

### 7.1 Direct Video Streaming & Byte-Range Requests

CineTogether supports direct playback of uploaded MP4, WebM, OGG, and MOV video files. Direct media delivery requires standard **HTTP 206 Partial Content** byte-range support:

```
[ Client Video Element ]                  [ API Server / CDN ]
           │                                       │
           ├── GET /uploads/movie.mp4 ────────────►│
           │   Range: bytes=0-1048575              │
           │                                       │
           │◄── HTTP 206 Partial Content ──────────┤
           │   Content-Range: bytes 0-1048575/500M │
           │   Content-Length: 1048576             │
           │   Accept-Ranges: bytes                │
```

- **Fast Scrubbing**: When a viewer seeks to hour 1:30:00, the browser requests the specific byte chunk containing that timestamp rather than re-downloading the entire video from byte 0.
- **Resource Protection**: Handled automatically by `express.static` with `maxAge: '1d'` and `dotfiles: 'deny'`.

### 7.2 Media Ingestion Validation (`directVideoUrlError`)

To prevent SSRF, piracy risks, and broken players, URLs are validated via `roomPolicy.ts`:
- **Official YouTube URLs**: Regex-validated for 11-character identifiers (`youtu.be`, `youtube.com/watch?v=`, `youtube.com/embed/`, `youtube.com/shorts/`).
- **Direct Video Streams**: Must use `http:` or `https:`.
- **Prohibited Sources**: Commercial DRM subscription streaming platforms (Netflix, Disney+, Prime Video, Hulu) and non-embeddable watch pages are strictly rejected with user-friendly error messages.

### 7.3 Production Storage Migration Architecture

In development, media files reside on local disk (`multer.diskStorage`). For production deployments handling 1 GB+ files, Dwight's publishing architecture outlines two migration paths:

```
Pipelined Ingestion (Cloudinary / S3 Presigned URL):

Option A: Cloudinary Stream Transcoding
[ Client ] ── Multipart Upload ──► [ Express API ] ── Pipe Stream ──► [ Cloudinary CDN ]

Option B: S3 Direct Presigned Upload (Recommended for Scale)
[ Client ] ── 1. POST /api/media/presign ──► [ Express API ]
[ Client ] ◄── 2. Returns S3 Presigned URL ── [ Express API ]
[ Client ] ── 3. PUT File Direct to S3 ────► [ AWS S3 / Cloudflare R2 ]
[ Client ] ── 4. POST /api/media (Save URL) ─► [ Express API ]
```

---

## 8. Horizontal Scaling & Redis Distributed Architecture

Currently, CineTogether operates with high performance as a single Node.js process using in-memory state:
- `playback: Map<string, PlaybackState>`
- `onlineByRoom: Map<string, Map<string, Sockets>>`

When expanding to multiple server replicas behind an Application Load Balancer (AWS ALB, NGINX, or Render Zero-Downtime clusters), the following distributed design applies:

```
                          ┌──────────────────────────┐
                          │ Application Load Balancer│
                          │  (Sticky Sessions Enabled│
                          └─────────────┬────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 ▼                                             ▼
     ┌────────────────────────┐                   ┌────────────────────────┐
     │ Node.js Server Replica 1│                   │ Node.js Server Replica 2│
     │ Socket.IO Server       │                   │ Socket.IO Server       │
     └───────────┬────────────┘                   └───────────┬────────────┘
                 │                                             │
                 │              Redis Pub/Sub Bus              │
                 └──────────────►┌─────────────┐◄──────────────┘
                                 │ Redis 7.x   │
                                 │ Cluster     │
                                 └─────────────┘
                                  (Upstash/AWS)
```

### Redis Scaling Components

1. **`@socket.io/redis-adapter` (Cross-Node Event Broadcasting)**:
   - When User A on Server 1 sends a `playback:play` command, the Redis Adapter publishes the event across the Redis cluster. Server 2 receives the message and forwards it to its connected room participants seamlessly.
2. **Redis Hashes for Authoritative Playback**:
   - Instead of a local process `Map`, playback states reside in Redis:
     ```redis
     HSET room:playback:CIN-ABCD position 142.5 playing true updatedAt 1791400948000
     EXPIRE room:playback:CIN-ABCD 86400
     ```
3. **Sticky Sessions (Session Affinity)**:
   - Required during initial HTTP handshake upgrade to WebSockets so that polling handshakes route to the same instance before connection promotion.

---

## 9. Security, Rate Limiting & WCAG Accessibility

### 9.1 Authentication & Cookie Hygiene
- **HttpOnly Cookie**: The JWT session token (`ct_session`) is inaccessible via `document.cookie`, neutralizing XSS token theft.
- **SameSite & Secure Flags**: In production, `sameSite: 'none'` and `secure: true` allow cross-origin communication between the Vercel frontend and Render backend over TLS.
- **Timing Attack Defense**: Passwords are verified using constant-time comparisons via `bcrypt.compare`.

### 9.2 Multi-Tier Rate Limiting & Abuse Prevention
1. **REST Authentication Throttling**:
   - `authLimiter`: Max 30 requests per 15 minutes across registration and general auth endpoints.
   - `loginLimiter`: Max 10 attempts per 15 minutes to prevent brute-force password guessing.
2. **WebSocket Chat Spam Throttling**:
   - Implemented via a sliding timestamp window on each socket:
   ```typescript
   const now = Date.now();
   const sentAt = (socket.data.chatSentAt as number[] | undefined) || [];
   const recent = sentAt.filter((timestamp) => now - timestamp < 10_000);
   if (recent.length >= 8) {
     return socket.emit('room:error', { message: 'Slow down a little before sending another message.' });
   }
   ```

### 9.3 WCAG 2.1 AA Accessibility & Typography Overhaul
Implemented during task HAG-7 to replace unreadable micro-typography:
- **Font Size Minimums**: Eliminated all $<12$px micro-CSS rules. Metadata badges are standardized to $\ge 12$px, while interactive inputs and body text enforce $\ge 14$px.
- **Modal Accessibility**: Dialogs include `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and hierarchical **Escape key dismissal listeners**.
- **Upload Cancellation**: `uploadWithProgress` utilizes `XMLHttpRequest` progress events and integrates an `AbortController` signal to allow instant client aborts.

---

## 10. Top 15 Technical Interview Questions & Staff-Level Answers

### Q1: How did you solve playback desynchronization across users with varying network latency?
**Staff-Level Answer:**  
"Rather than having clients continuously report their playback positions—which causes network congestion and race conditions—we adopted a **server-authoritative time-estimation model** paired with **client-side drift correction**.  
On the backend, whenever an admin plays, pauses, or seeks, the server calculates the exact playback position using `expectedPlaybackPosition(prev, now)`. The server stores only a lightweight snapshot tuple `{ position, playing, updatedAt }` in memory and broadcasts it to all room clients.  
On the client side, viewers run a continuous 500ms drift-correction loop that compares local player time against the server-projected elapsed time. We implemented a **1.25-second deadband threshold**: drift within 1.25 seconds is ignored to prevent micro-buffering, while drift exceeding 1.25 seconds triggers a smooth catch-up seek. When an admin scrubs the timeline, drift correction is temporarily suspended using a decoupled `scrubTime` state to avoid slider fighting."

---

### Q2: Why did you choose WebSockets (Socket.IO) over WebRTC DataChannels or HTTP Long-Polling?
**Staff-Level Answer:**  
"We selected Socket.IO over WebRTC and HTTP polling based on topology complexity and bandwidth efficiency:  
- **HTTP Polling** at 500ms intervals across thousands of concurrent watch rooms would generate massive request overhead, header serialization costs, and database pressure.
- **WebRTC DataChannels** excel at peer-to-peer data, but for multi-user watch parties, a full mesh topology scales as $O(N^2)$. If a room host with limited upstream bandwidth has to fan out playback packets to 15 peers, packets drop and the room falls out of sync. Furthermore, WebRTC requires complex STUN/TURN traversal infrastructure.
- **Socket.IO** provides a lightweight client-server star topology. The server acts as the authoritative coordinator. It delivers sub-millisecond event broadcasts over a single persistent TCP connection per client, with built-in room multiplexing and automatic reconnection fallbacks."

---

### Q3: What happens when the room host accidentally closes their tab or loses internet connection?
**Staff-Level Answer:**  
"We engineered a **12-second disconnected socket grace period** to avoid split-brain elections during page reloads or brief Wi-Fi drops.  
When a host socket disconnects, the server checks if any other active sockets exist for that user. If not, rather than instantly closing the room or electing a new admin, the server arms a 12-second timeout. If the host reconnects within that window, the timer is cleared via `clearTimeout()` and their admin session continues uninterrupted.  
If the timer expires, the server invokes `leaveRoom()`. It demotes the departed host to `MEMBER` and runs our deterministic successor algorithm: `earliestActiveParticipant()`, which selects the active participant with the earliest `joinedAt` timestamp. The successor is promoted to `ADMIN`, the database is updated, and both `participants:update` and a system chat message are broadcast to the room."

---

### Q4: How do you prevent 'scrub fighting' where the video slider jitters while a user drags it?
**Staff-Level Answer:**  
"Scrub fighting happens when periodic time-update events (like HTML5 `timeupdate` or our 500ms drift loop) trigger React state re-renders while the user is actively dragging the slider.  
We resolved this by decoupling playback time from scrub coordinates. We introduced an independent `scrubTime` state (`number | null`). On `pointerdown` or `keydown`, `scrubTime` is set, which immediately acts as an execution guard: all background intervals and time updates ignore slider mutations while `scrubTime !== null`.  
Only when the user releases the slider—firing `pointerup`, `mouseup`, `touchend`, or `keyup`—does the `commitSeek(target)` handler clear `scrubTime` back to `null`, update video playback position, and emit the single authoritative `playback:seek` socket event."

---

### Q5: Why did you keep playback state in memory instead of persisting every play/pause/tick in MongoDB?
**Staff-Level Answer:**  
"Persisting high-frequency playback ticks to disk creates severe database write amplification. In a system with 5,000 active rooms updating position every few seconds, MongoDB would need to handle thousands of disk writes per second, overwhelming replication oplogs and exhausting IOPS.  
Instead, we treat playback position as **ephemeral runtime state**. It is held in an in-memory `Map` keyed by `roomId`. The authoritative formula derives exact time on demand from the initial timestamp. MongoDB is reserved strictly for durable domain entities: User accounts, Room metadata, persistent chat history, and media records.  
To prevent memory leaks from abandoned rooms, we implemented `prunePlaybackMap()` with a 1-hour TTL that evicts playback states for rooms with zero connected sockets."

---

### Q6: How would you scale CineTogether horizontally across 10+ backend server nodes?
**Staff-Level Answer:**  
"Scaling CineTogether horizontally requires decoupling in-memory state into a distributed infrastructure layer:  
1. **Socket Event Fan-Out**: Integrate `@socket.io/redis-adapter`. When Server A emits `playback:sync` for a room, Redis Pub/Sub distributes the message across all server nodes so clients on Server B receive the broadcast.
2. **Distributed Playback State**: Replace the local JavaScript `Map` with **Redis Hashes** (`HSET room:playback:<id>`). Any node can evaluate `expectedPlaybackPosition` by querying Redis in sub-milliseconds.
3. **Session Affinity**: Configure Application Load Balancers with sticky cookies so WebSocket upgrade requests land on the instance that initiated the HTTP handshake.
4. **Distributed Lock Manager**: Use Redlock or MongoDB document versioning (`$inc: { version: 1 }`) when executing host promotions to prevent race conditions across server nodes."

---

### Q7: How do you handle 1 GB+ video file uploads without crashing the Node.js process?
**Staff-Level Answer:**  
"In Node.js, buffering an entire 1 GB file in memory causes the V8 heap to hit memory limits and triggers Garbage Collection pauses.  
We address this on three levels:
1. **Streaming Multi-Part Ingestion**: We configure Multer with disk storage (`multer.diskStorage`), which streams the incoming HTTP request stream directly to disk in chunks without holding the payload in memory.
2. **Client-Side Progress & Abortability**: In the frontend, `uploadWithProgress` utilizes `XMLHttpRequest.upload.onprogress` to provide accurate byte counters and percentage bars, bound to an `AbortSignal` that can cancel in-flight uploads immediately.
3. **Production Cloud Storage**: For production scale, the architecture offloads uploads completely using **S3 / Cloudflare R2 Presigned URLs**. The client requests an upload ticket from Express, uploads directly to S3 via HTTP PUT, and notifies the backend once finished. The API server never handles video binary bytes directly."

---

### Q8: Can CineTogether synchronize playback for DRM-protected streaming services like Netflix or Disney+?
**Staff-Level Answer:**  
"No, and by architectural design. Commercial streaming services employ Widevine and FairPlay DRM, encrypting video streams with Encrypted Media Extensions (EME). Furthermore, their terms of service prohibit embedding or programmatic synchronization via third-party iframes (`X-Frame-Options: DENY` and CSP headers).  
Attempting to bypass DRM or reverse-engineer encrypted blobs violates copyright law and platform terms.  
CineTogether focuses on:
1. Direct, browser-playable media files (MP4, WebM, OGG, MOV) uploaded with authorization.
2. Official YouTube videos embedded via the official YouTube IFrame Player API when embedding is explicitly enabled by the creator.  
Our URL validation helper (`directVideoUrlError`) explicitly detects and rejects commercial streaming domains with actionable error messages."

---

### Q9: Tell me about the most difficult edge-case bug you encountered and how you root-caused and resolved it.
**Staff-Level Answer:**  
"The most intricate bug was **BUG-01: Split-Brain Host Role Retention on Rejoining**.  
*Root Cause*: When a host left a room, our `leaveRoom` handler correctly promoted a successor. However, in MongoDB, the departing participant's record was updated with `isActive: false` while their `role` field was left as `ADMIN`. When the former host rejoined via `POST /api/rooms/:roomCode/join`, the server flipped `isActive = true` without modifying their role. This left the room with two active `ADMIN` participants in the database. When the current host tried to remove the former host, the API rejected it because admins cannot be kicked.  
*Resolution*: We implemented strict demotion invariants. In `leaveRoom`, departing admins are demoted to `MEMBER` before successor election. In the `/join` endpoint, we added an authoritative check: whenever an existing participant rejoins, their role is forced to `MEMBER` unless their `userId` matches the room's current `ownerId`."

---

### Q10: How do you authenticate users over WebSockets, and why is cookie-based WebSocket authentication challenging?
**Staff-Level Answer:**  
"We authenticate WebSockets at the handshake layer using our HTTPOnly session cookie (`ct_session`).  
In `server.ts`, we attach an `io.use()` authentication middleware. When a client initiates the WebSocket connection, the browser automatically includes credentials. The middleware extracts the `cookie` header, decodes the JWT, and verifies the signature using `jwt.verify()`. If invalid or expired, the socket connection is rejected with `Authentication required`.  
*The Challenge*: Browsers do not enforce Same-Origin Policy on WebSocket connections. A malicious third-party website can initiate a WebSocket connection to `api.cinetogether.com`, and the browser will attach the ambient cookie (Cross-Site WebSocket Hijacking).  
*Defense*: We configure Socket.IO CORS with explicit origin whitelisting (`origin: clientOrigin, credentials: true`), and validate the `Origin` header during handshake before permitting room subscription."

---

### Q11: How do you protect chat and reactions from socket flooding attacks?
**Staff-Level Answer:**  
"We implement a multi-layered rate-limiting defense:
1. **Sliding Timestamp Window Throttling**: On each socket, we store an array of recent message timestamps (`socket.data.chatSentAt`). On every `chat:send` event, we filter timestamps from the last 10 seconds. If the user has sent 8 or more messages within 10 seconds, the event is dropped and a `room:error` alert is returned.
2. **Payload Sanitization & Truncation**: Chat messages are limited to 500 characters using `message.trim().slice(0, 500)`.
3. **Reaction Whitelisting**: Emoji reactions are strictly checked against a Set of six supported emojis (`['❤️', '😂', '👏', '😮', '🔥', '😭']`). Unrecognized strings or oversized payloads are rejected immediately."

---

### Q12: How did you ensure accessibility (WCAG AA compliance) in a custom dark-mode video application?
**Staff-Level Answer:**  
"During our UI evaluation pass (HAG-3 and HAG-7), we identified that the dark-mode theme suffered from micro-typography (6px–9px font sizes on badges and room codes) and unannounced modal dialogs.  
We executed a complete overhaul:
1. **Typography Standardization**: Replaced 149 sub-12px CSS declarations. All metadata and badges enforce a minimum font size of 12px, and body/form elements enforce $\ge 14$px.
2. **Accessible Dialog Semantics**: Modals use `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` referencing heading IDs.
3. **Keyboard Navigation & Escape Listeners**: Added a global hierarchical Escape key listener that closes modals safely without triggering destructive room actions.
4. **Slider ARIA Attributes**: Video seek bars and volume sliders include `aria-label`, `min`, `max`, and support arrow key increments."

---

### Q13: If a viewer has severe network buffering, how does the player catch up without stuttering?
**Staff-Level Answer:**  
"If a viewer experiences network buffering, their video naturally pauses while the host continues watching.  
When the viewer's network recovers, our 500ms continuous drift-correction loop calculates `currentExpected = playback.position + elapsed`. Because the elapsed difference exceeds our 1.25-second deadband threshold, the player issues an immediate seek:
- For HTML5 `<video>`: `video.currentTime = currentExpected`.
- For YouTube embeds: `player.seekTo(currentExpected, true)`.  
The `seekTo` parameter `allowSeekAhead: true` instructs YouTube's player to drop stale buffered frames and immediately stream keyframes from the new timestamp. The viewer catches up seamlessly without accumulating playback lag."

---

### Q14: How does CineTogether handle concurrent admin transfers and race conditions?
**Staff-Level Answer:**  
"When transferring admin rights (`POST /api/rooms/:roomCode/transfer-admin`), race conditions can occur if two requests execute concurrently or if the target participant leaves midway through the transaction.  
To prevent split-brain ownership, we use an atomic MongoDB query with `$set` and pipeline updates:
```typescript
const updatedRoom = await Room.findOneAndUpdate(
  { 
    _id: room._id, 
    ownerId: req.user!.id, 
    participants: { $elemMatch: { userId: targetId, isActive: true } } 
  },
  ownershipUpdate,
  { new: true }
);
```
The query criteria strictly assert that:
1. The requester is still the current `ownerId`.
2. The target participant exists, has matching `userId`, and is currently active (`isActive: true`).  
If another admin transfer succeeded milliseconds earlier, the query returns `null`, and the endpoint responds with HTTP 409 Conflict ('Room ownership changed. Refresh and try again')."

---

### Q15: How did autonomous multi-agent development accelerate CineTogether's engineering velocity?
**Staff-Level Answer:**  
"The multi-agent workflow functioned like a specialized engineering squad operating with strict separation of concerns and file-based IPC:  
- **Orchestration (Michael)**: Maintained task prioritization in `tasks.json` and milestone verification in `board.md`.
- **Specialized Auditing (Dwight & Avatar)**: Dedicated agents conducted deep-dive architecture audits and WCAG accessibility reviews without context pollution.
- **Root-Cause Analysis (Jim)**: QA identified the exact reproduction vectors for 12 edge cases before coding began.
- **Implementation (Pam)**: The developer received clear, verified bug reports and implemented targeted fixes cleanly.
- **Documentation & Verification (Meredith & Jim)**: Formal regression testing and system design documentation ensured the release was fully verified and production-ready."

---

## 11. System Metrics, Numerical Constants & Quick-Reference Cheat Sheet

### Critical System Constants

| Parameter | Value | Location in Codebase | Purpose |
|:---|:---|:---|:---|
| **Drift Correction Threshold** | `1.25 seconds` | `apps/web/src/App.tsx:456` | Maximum allowed drift before forcing a catch-up seek. |
| **Drift Check Frequency** | `500 ms` | `apps/web/src/App.tsx:445` | Interval frequency for client-side playback verification loop. |
| **Disconnect Grace Period** | `12,000 ms` | `apps/api/src/server.ts:491` | Delay before declaring disconnected user absent and electing successor. |
| **Playback State Map TTL** | `3,600,000 ms (1 hr)`| `apps/api/src/server.ts:416` | Time before idle, empty room playback states are pruned from memory. |
| **Max File Upload Size** | `1,073,741,824 bytes (1 GB)` | `apps/api/src/server.ts:350` | Maximum video file upload limit for Multer disk storage. |
| **Chat Rate Limit** | `8 msgs / 10 sec` | `apps/api/src/server.ts:472` | Sliding window socket spam prevention threshold. |
| **Chat History Buffer** | `40 messages` | `apps/api/src/server.ts:446` | Number of recent chat records dispatched upon room join. |
| **Max Room Capacity** | `20 participants` | `apps/api/src/server.ts:54` | Maximum participant limit configurable for a room. |
| **Auth Rate Limit** | `30 req / 15 min` | `apps/api/src/server.ts:35` | REST rate limiting for user registration and general auth. |
| **Login Rate Limit** | `10 req / 15 min` | `apps/api/src/server.ts:36` | REST rate limiting against credential brute-forcing. |
| **Session Lifetime** | `7 days` | `apps/api/src/server.ts:41, 50` | Cryptographic JWT expiration and HttpOnly cookie max-age. |
| **Google OAuth State TTL** | `10 minutes` | `apps/api/src/server.ts:51` | Expiration time for CSRF OAuth state cookie. |

---

### Architectural Formulas & Quick-Look Algorithms

#### 1. Authoritative Playback Position
$$\text{ExpectedPos}(t) = \text{State.position} + (\text{State.playing} \ ? \ (t - \text{State.updatedAt})/1000 : 0)$$

#### 2. Successor Promotion Condition
$$\text{Successor} = \arg\min_{p \in \text{Participants}, \ p.\text{isActive}} (p.\text{joinedAt})$$

#### 3. Client Catch-up Trigger
$$\text{Trigger Seek} \iff |\text{Player.currentTime} - \text{ExpectedPos}(t_{\text{now}})| > 1.25\text{s} \quad \land \quad \text{scrubTime} = \text{null}$$

---

*End of CineTogether Comprehensive System Design & Interview Preparation Guide.*
