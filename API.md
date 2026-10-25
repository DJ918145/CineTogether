# API reference

All REST paths are prefixed with `/api`. JSON errors use `{ "message": "..." }`. Authenticated requests use the `ct_session` HttpOnly cookie; cross-origin clients must send credentials. Logging out revokes every session token for that account.

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/api/health` | No | API and database status |
| POST | `/api/auth/register` | No | `{name,email,password}`; creates account/session |
| POST | `/api/auth/login` | No | `{email,password}`; creates session |
| POST | `/api/auth/logout` | No | Revokes account tokens and clears current cookie |
| GET | `/api/auth/me` | Yes | Current user |
| GET | `/api/auth/google/url` | No | Returns the Google OAuth authorization URL |
| GET | `/api/auth/google` | No | Starts Google OAuth 2.0 sign-in |
| GET | `/api/auth/google/callback` | No | Validates OAuth state, verifies Google email, and creates the app session |
| PATCH | `/api/auth/profile` | Yes | `{name,avatar?}`; update current user’s display name/avatar |
| POST | `/api/auth/forgot-password` | No | `{email}`; generic message; local development returns a 30-minute reset link |
| POST | `/api/auth/reset-password` | No | `{token,password}`; consumes a valid, single-use reset token |
| POST | `/api/rooms` | Yes | `{name,description?,visibility,password?,maxParticipants?}` |
| GET | `/api/rooms` | Yes | Recent rooms for current user |
| GET | `/api/history` | Yes | Joined and created room histories |
| GET | `/api/rooms/:roomCode` | Yes | Room detail; private rooms are member-only |
| GET | `/api/rooms/:roomCode/participants` | Yes/member | Active room participants |
| POST | `/api/rooms/:roomCode/join` | Yes | `{password?}`; joins/returns room state |
| POST | `/api/rooms/:roomCode/leave` | Yes | Leaves room and transfers ownership if needed |
| PATCH | `/api/rooms/:roomCode/settings` | Yes/Admin | Partial `name`, `description`, `visibility`, `maxParticipants`, and `password`; omitted password keeps it unchanged, a non-empty password sets it, and `password: ""` removes it |
| POST | `/api/rooms/:roomCode/transfer-admin` | Yes/Admin | `{userId}`; promote active participant |
| POST | `/api/rooms/:roomCode/remove-participant` | Yes/Admin | `{userId}`; remove non-admin participant |
| DELETE | `/api/rooms/:roomCode` | Yes/Admin | Close room |
| GET | `/api/rooms/:roomCode/messages?limit=50` | Yes/member | Latest chat messages (max 100) |
| GET | `/api/media` | Yes | Current user’s video library |
| POST | `/api/media` | Yes | `{title,sourceUrl,description?,mimeType?}`; add an authorized direct video URL |
| POST | `/api/media/upload` | Yes | Multipart `video` and optional `title`; self-hosted only (not available on Vercel without durable object storage) |
| GET | `/api/media/:id` | Yes/owner | Get a video from the current user’s library |
| DELETE | `/api/media/:id` | Yes/owner | Delete a video from the current user’s library |
| GET | `/uploads/:filename` | Yes/owner or active room member | Range-capable uploaded video delivery; access is checked against current room membership |
| POST | `/api/rooms/:roomCode/media` | Yes/Admin | `{title,url}` or `{mediaId}`; choose a shared direct video or library video |

Unknown routes, rate-limit rejections, malformed JSON, and oversized JSON bodies return JSON `{ "message": "..." }` errors.

## Socket.IO events

Connect with credentials and the `ct_session` cookie, then emit `room:join` with `{roomCode}`. Server emits `room:state`, `chat:history`, `participants:update`, `presence:update`, `playback:sync`, `playback:speed`, `playback:movie-change`, `reaction:received`, `room:closed`, or `room:error`.

Client emits `playback:play`, `playback:pause`, `playback:seek` with `{position}`; admin-only `playback:speed` with `{speed}` (`0.5`, `0.75`, `1`, `1.25`, `1.5`, or `2`); `playback:ended`; `chat:send` with `{message}` (500 characters max); and `reaction:send` with one supported emoji. Playback authority is checked against the database owner on each event. Chat/reaction burst limits reserve quota before database work. High-frequency playback position updates are kept in memory and are not written to MongoDB. Media links may be direct HTTP(S) video files or official YouTube video URLs, played through YouTube's IFrame Player API when embedding is enabled. Netflix and other subscription-streaming pages are not supported; protected streams are never extracted or bypassed.
