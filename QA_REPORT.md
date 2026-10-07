# CineTogether — QA Verification & Defect Identification Report

**Author**: Jim (`jim-muyddny0`) — Bug Investigation & Root-Cause Analysis  
**Date**: October 7, 2026  
**Target Repository**: `D:\dhruv\CineTogether`  
**Build Under Test**: Munder Difflin v0.5.5 / Node.js Workspace (`@cinetogether/api`, `@cinetogether/web`)

---

## 1. Executive Summary

A comprehensive automated QA verification, typecheck, build validation, and code-level root-cause analysis was conducted across both `apps/api` and `apps/web`.

- **Automated Tests (`npm test`)**: **PASS** (1 test file, 8/8 tests passing). However, test coverage is limited exclusively to unit tests for 4 isolated helper functions in `roomPolicy.ts`. Zero automated test coverage exists for API routes, authentication flows, database transactions, or Socket.IO events.
- **Build & Compilation (`npm run build`)**: **PASS**. Both TypeScript projects compile without type errors (`tsc -p tsconfig.json` for API; `tsc -b && vite build` for Web).
- **Defects Identified**: **12 distinct bugs and architectural flaws** (3 Critical, 4 High, 5 Medium/Low), including split-brain admin role state on rejoin, dead code / unused playback estimation functions causing playback desync, seek-bar scrub race conditions, and lack of active drift correction.

---

## 2. Test & Build Execution Results

### 2.1 Automated Test Suite (`npm test`)
```text
> @cinetogether/api@1.0.0 test
> vitest run

 RUN  v2.1.9 D:/dhruv/CineTogether/apps/api

 ✓ src/roomPolicy.test.ts (8 tests) 9ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  3.59s
```
**Observation**: Test suite passes quickly and cleanly, but only exercises pure helper functions in `apps/api/src/roomPolicy.ts`.

### 2.2 Compilation & Build (`npm run build`)
```text
> @cinetogether/api@1.0.0 build
> tsc -p tsconfig.json

> @cinetogether/web@1.0.0 build
> tsc -b && vite build

vite v8.3.2 building client environment for production...
✓ 1603 modules transformed.
dist/index.html                   0.92 kB │ gzip:  0.49 kB
dist/assets/index-gMuiqNBD.css   54.23 kB │ gzip: 12.59 kB
dist/assets/index-DNV2YXCz.js   279.42 kB │ gzip: 88.47 kB
✓ built in 19.86s
```
**Observation**: No syntax, typing, or bundling errors.

---

## 3. Prioritized Defect List

| ID | Severity | Component | Summary |
|---|---|---|---|
| **BUG-01** | **Critical** | `apps/api` (Room Lifecycle) | Former host keeps `ADMIN` role upon rejoining; causes duplicate hosts and blocks kick functionality |
| **BUG-02** | **Critical** | `apps/api` (Playback Engine) | `expectedPlaybackPosition` never imported or used; pause without payload rewinds playback to old start time |
| **BUG-03** | **Critical** | `apps/web` (Playback Controls) | Scrub bar thumb fights live playback ticks; keyboard seeking fails to sync |
| **BUG-04** | **High** | `apps/web` (Sync Engine) | No continuous drift correction loop; client buffering desyncs viewer permanently |
| **BUG-05** | **High** | `apps/web` (Video Player) | "Tap to Join Playback" overlay is a no-op for non-admin viewers on direct video files |
| **BUG-06** | **High** | `apps/api` (Error Handling) | Malformed ObjectIDs trigger unhandled `CastError` yielding HTTP 500 instead of 400/404 |
| **BUG-07** | **High** | `apps/api` (Socket Events) | Admin transfer omits `participants:update` broadcast event |
| **BUG-08** | **Medium** | `apps/api` (Memory Management) | In-memory `playback` Map entries leak if rooms are created/configured via REST but not joined via sockets |
| **BUG-09** | **Medium** | `apps/api` (Data Integrity) | User profile name updates are not propagated to denormalized `Room.participants` |
| **BUG-10** | **Medium** | `apps/web` (Mobile Compatibility) | Fullscreen toggle invokes unsupported `Element.requestFullscreen` on iOS Safari |
| **BUG-11** | **Low** | `apps/api` (Rate Limiting) | Socket chat rate limiter resets upon page refresh / reconnect |
| **BUG-12** | **Low** | `apps/web` (Playback Sync) | Client-side late-join calculations are vulnerable to local clock skew |

---

## 4. Deep-Dive Defect Analysis & Root Causes

### BUG-01: Former Host Keeps `ADMIN` Role on Rejoining (Split-Brain Host)
- **Files**: `apps/api/src/server.ts` (lines 205–214, 189–199)
- **Root Cause**:
  When an admin leaves a room, `leaveRoom()` assigns `successor.role = 'ADMIN'` and updates `room.ownerId = successor.userId`. However, the leaving admin's own participant object in `room.participants` is set to `isActive = false`, but their `role` remains `'ADMIN'`.
  When that original admin subsequently calls `/api/rooms/:roomCode/join`, the existing record is updated with:
  ```ts
  if (existing) { existing.isActive = true; existing.joinedAt = new Date(); }
  ```
  Their `role` is never reset to `'MEMBER'`.
- **Impact**:
  1. The room now has two participants with `role: 'ADMIN'`.
  2. `PeoplePanel` renders the `HOST` badge next to both users.
  3. In `remove-participant`, `if (!p || p.role === 'ADMIN') return res.status(400)` prevents the new legitimate room host from removing the former host from the room.
- **Recommended Fix (for Pam)**:
  In `leaveRoom()`, demote the departing admin's role to `'MEMBER'` (`participant.role = 'MEMBER'`). Furthermore, in `/join`, ensure that unless `existing.userId.toString() === room.ownerId.toString()`, `existing.role` is set to `'MEMBER'`.

---

### BUG-02: `expectedPlaybackPosition` Never Imported or Used (Playback State Regression)
- **Files**: `apps/api/src/server.ts` (lines 19, 410–418)
- **Root Cause**:
  `expectedPlaybackPosition` was authored and tested in `roomPolicy.ts`, but line 19 of `server.ts` only imports `{ directVideoUrlError, earliestActiveParticipant, youtubeVideoId }`.
  Inside `playEvent`:
  ```ts
  const prev = playback.get(id) || { position: 0, playing: false, updatedAt: Date.now() };
  const position = Math.max(0, Math.min(Number(data?.position ?? prev.position) || 0, 24 * 60 * 60));
  ```
  If an admin emits `playback:pause` with an omitted or empty `data.position`, `server.ts` falls back to `prev.position`. Because `prev.position` in the in-memory map was set when playback started and is never advanced during playback, the playback jumps backwards to the timestamp when play was pressed.
- **Impact**: Pausing without an explicit position payload resets playback back to where it was initially started.
- **Recommended Fix (for Pam)**:
  Import `expectedPlaybackPosition` in `server.ts` and compute `const currentPos = expectedPlaybackPosition(prev, Date.now())` as the fallback when `data?.position` is undefined or NaN.

---

### BUG-03: Scrub Bar Thumb Fights Live Playback Ticks & Missing Keyboard Seek
- **Files**: `apps/web/src/App.tsx` (lines 225–229, 258)
- **Root Cause**:
  1. While dragging the seek slider, the 400ms YouTube interval or the native video `onTimeUpdate` event continues firing and invokes `setTime()`, constantly snatching the slider thumb away from the user's cursor.
  2. `emit('playback:seek', { position: time })` relies on the asynchronous state variable `time` at the moment of `onMouseUp`/`onTouchEnd`, which may be stale or already overwritten by the interval.
  3. Keyboard interactions (left/right arrow keys) change `<input type="range">` value but do not fire `onMouseUp` or `onTouchEnd`, so keyboard scrubbing never synchronizes with other participants.
- **Impact**: Jittery, frustrating seek experience for the host; keyboard accessibility is broken.
- **Recommended Fix (for Pam)**:
  Track an `isScrubbing` boolean state. While `isScrubbing` is true, suppress updates from `onTimeUpdate` and interval timers to the slider. On seek completion (including `onKeyUp` or input change commit), read `Number(e.currentTarget.value)` directly and emit.

---

### BUG-04: Lack of Continuous Drift Correction Loop on Web Client
- **Files**: `apps/web/src/App.tsx` (`VideoPlayer` lines 230–243)
- **Root Cause**:
  The sync effect in `VideoPlayer` only executes when the `playback` state object reference or `media.url` changes. During steady playback (when no socket events are sent), there is no recurring timer checking `Math.abs(video.currentTime - expectedPosition)`.
- **Impact**: If a client's network buffers for 4 seconds during a movie, they will remain 4 seconds behind everyone else for the rest of the movie without ever catching up.
- **Recommended Fix (for Pam)**:
  Add a lightweight periodic check (e.g. every 3–5 seconds) during `playback.playing === true` that compares `currentTime` against `expectedPlaybackPosition(playback, Date.now())` and performs a smooth seek/rate adjustment if drift exceeds 1.5 seconds.

---

### BUG-05: Non-Admin "Tap to Join Playback" Overlay Does Nothing for Direct Video
- **Files**: `apps/web/src/App.tsx` (line 249)
- **Root Cause**:
  `playFromOverlay` is implemented as:
  ```tsx
  const playFromOverlay = () => {
    if (isAdmin) emit('playback:play', { position: time });
    else if (youtubeId) {
      youtubeRef.current?.seekTo(expectedPosition, true);
      youtubeRef.current?.playVideo();
    }
  };
  ```
  When a guest clicks the overlay on a direct MP4/WebM video (`!isAdmin` and `!youtubeId`), the function executes nothing.
- **Impact**: Unresponsive overlay button for guests trying to start watching direct videos.
- **Recommended Fix (for Pam)**:
  For non-admins on direct video, call `videoRef.current?.play()` and synchronize position to `expectedPosition`.

---

### BUG-06: Malformed ObjectIDs Cause Unhandled Mongoose `CastError` (HTTP 500)
- **Files**: `apps/api/src/server.ts` (lines 347, 352, 363)
- **Root Cause**:
  Routes `GET /api/media/:id`, `DELETE /api/media/:id`, and `POST /api/rooms/:roomCode/media` (with `mediaId`) pass strings directly to Mongoose queries without validating against `/^[a-f\d]{24}$/i`. Invalid ID formats throw a `CastError`, which trips the generic error handler and returns `500 Something went wrong` instead of a 400 or 404. (Note: `transfer-admin` and `remove-participant` already correctly validate `/^[a-f\d]{24}$/i`, highlighting the inconsistency).
- **Impact**: Error monitoring noise and incorrect HTTP status codes exposed to clients.
- **Recommended Fix (for Pam)**:
  Validate ObjectID params with Zod or regex check before issuing Mongoose queries, or add a `CastError` handler in Express error middleware returning 400/404.

---

### BUG-07: Admin Transfer Omits `participants:update` Broadcast
- **Files**: `apps/api/src/server.ts` (lines 275–277)
- **Root Cause**:
  In `POST /api/rooms/:roomCode/transfer-admin`:
  ```ts
  io.to(String(room._id)).emit('room:state', { room: publicRoom(updatedRoom) });
  io.to(String(room._id)).emit('chat:message', systemMessage);
  ```
  In contrast, `leaveRoom` and `/join` emit `participants:update`. Omitting `participants:update` means any client UI listening to that specific socket event will fail to refresh participant role statuses.
- **Impact**: Inconsistent event delivery across room lifecycle mutations.
- **Recommended Fix (for Pam)**:
  Add `io.to(String(room._id)).emit('participants:update', updatedRoom.participants);` to the `transfer-admin` route.

---

### BUG-08: In-Memory `playback` Map Memory Leak for Dormant Rooms
- **Files**: `apps/api/src/server.ts` (line 376)
- **Root Cause**:
  `POST /api/rooms/:roomCode/media` sets `playback.set(String(room._id), { position: 0, playing: false, updatedAt: Date.now() })`. If users never connect to the WebSocket room or abandon the room without deleting it, this Map entry remains in Node process memory forever.
- **Impact**: Slow memory leak in long-running API server instances.
- **Recommended Fix (for Pam)**:
  Implement a TTL or eviction mechanism for `playback` entries, or initialize playback on first socket room join.

---

### BUG-09: User Profile Name Updates Do Not Propagate to Active/Existing Rooms
- **Files**: `apps/api/src/server.ts` (lines 156–162)
- **Root Cause**:
  When a user edits their name in `/api/auth/profile`, `User` is updated, but room participants store a denormalized `name` copy (`Room.participants.name`). The UI states: *"Profile saved. Your room display name is updated."*, yet rooms continue displaying the old name.
- **Impact**: Misleading user feedback and stale profile display across rooms.
- **Recommended Fix (for Pam)**:
  Update `Room.updateMany({ 'participants.userId': req.user.id }, { $set: { 'participants.$.name': data.name } })` when updating profile name.

---

### BUG-10: Fullscreen Toggle Crashes / Fails on iOS Safari
- **Files**: `apps/web/src/App.tsx` (line 250)
- **Root Cause**:
  `frameRef.current?.requestFullscreen()` is unsupported on iOS Safari for arbitrary `<div>` elements.
- **Impact**: Fullscreen button throws error or does nothing on iPhone/iPad.
- **Recommended Fix (for Pam)**:
  Check for `videoRef.current?.webkitEnterFullscreen` if `requestFullscreen` is unavailable.

---

## 5. Summary of Recommended Test Additions

To prevent regressions, the following test suites should be added to Vitest:
1. **Room Lifecycle Test (`apps/api/src/roomLifecycle.test.ts`)**:
   - Host leave -> promotion of successor -> rejoin of former host -> verify former host has role `MEMBER` and cannot block removal.
2. **Playback State Estimation Test (`apps/api/src/playback.test.ts`)**:
   - Verify pausing after elapsed time without position preserves elapsed position rather than resetting to 0.
3. **API Validation Test (`apps/api/src/apiValidation.test.ts`)**:
   - Pass invalid ObjectID strings to `/api/media/:id` and ensure HTTP 400/404 is returned instead of 500.

---

*Report generated by Jim (`jim-muyddny0`) — ready for handover to Pam.*
