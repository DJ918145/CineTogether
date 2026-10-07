# API reference

All API paths are prefixed with `/api`. JSON errors use `{ "message": "..." }`. Authenticated requests use the `ct_session` HttpOnly cookie; cross-origin clients must send credentials.

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/health` | No | API and database status |
| POST | `/auth/register` | No | `{name,email,password}`; creates account/session |
| POST | `/auth/login` | No | `{email,password}`; creates session |
| POST | `/auth/logout` | No | Clears session cookie |
| GET | `/auth/me` | Yes | Current user |
| GET | `/auth/google` | No | Starts Google OAuth 2.0 sign-in; requires Google OAuth credentials |
| GET | `/auth/google/callback` | No | Validates OAuth state, verifies Google email, and creates the app session |
| PATCH | `/auth/profile` | Yes | `{name,avatar?}`; update current user’s display name/avatar |
| POST | `/auth/forgot-password` | No | `{email}`; generic message; local development returns a 30-minute reset link |
| POST | `/auth/reset-password` | No | `{token,password}`; consumes a valid, single-use reset token |
| POST | `/rooms` | Yes | `{name,description?,visibility,password?,maxParticipants?}` |
| GET | `/rooms` | Yes | Recent rooms for current user |
| GET | `/rooms/:roomCode` | Yes | Room detail; private rooms are member-only |
| POST | `/rooms/:roomCode/join` | Yes | `{password?}`; joins/returns room state |
| POST | `/rooms/:roomCode/leave` | Yes | Leaves room and transfers ownership if needed |
| GET | `/rooms/:roomCode/participants` | — | Not currently exposed; participant roster is returned in room state |
| PATCH | `/rooms/:roomCode/settings` | Yes/Admin | Partial `name`, `description`, `visibility`, `maxParticipants` |
| POST | `/rooms/:roomCode/transfer-admin` | Yes/Admin | `{userId}`; promote active participant |
| POST | `/rooms/:roomCode/remove-participant` | Yes/Admin | `{userId}`; remove non-admin participant |
| DELETE | `/rooms/:roomCode` | Yes/Admin | Close room |
| GET | `/rooms/:roomCode/messages?limit=50` | Yes/member | Latest chat messages (max 100) |
| POST | `/media/upload` | Yes | Multipart `video` and optional `title`; returns local authorized media URL |
| POST | `/rooms/:roomCode/media` | Yes/Admin | `{title,url}`; choose shared direct video URL |

## Socket.IO events

Connect with credentials and the `ct_session` cookie, then emit `room:join` with `{roomCode}`. Server emits `room:state`, `chat:history`, `participants:update`, `presence:update`, `playback:sync`, `playback:movie-change`, `reaction:received`, `room:closed`, or `room:error`.

Client emits `playback:play`, `playback:pause`, `playback:seek` with `{position}`; `playback:ended`; `chat:send` with `{message}` (500 characters max); and `reaction:send` with one supported emoji. Playback control authority is checked against the database owner on each event. High-frequency playback position updates are kept in memory and are not written to MongoDB. Media links may be direct HTTP(S) video files or official YouTube video URLs, played through YouTube's IFrame Player API when embedding is enabled. Netflix and other subscription-streaming pages are not supported; protected streams are never extracted or bypassed.
