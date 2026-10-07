# CineTogether

**Watch Together. Feel Together.** CineTogether is a full-stack movie-night app for private rooms, real-time chat, shared reactions, and synchronized playback of authorized direct video sources and embeddable YouTube videos.

## Stack

- React, TypeScript, Vite, React Router, Tailwind CSS, Lucide, Socket.IO Client
- Node.js, Express, TypeScript, Socket.IO, MongoDB/Mongoose, Zod
- JWT in an HttpOnly cookie, bcrypt password hashing

The room UI uses a small hand-authored component/CSS system rather than a large component runtime. Tailwind is configured for future utility use. Videos are stored on local disk for development, never in MongoDB.

## Requirements

- Node.js 20.19+ (Node 22+ recommended) and npm
- MongoDB 7+ running locally, or a MongoDB Atlas connection string

## Local setup

1. Copy `.env.example` to `.env` and set a long random `JWT_SECRET`. Set `MONGODB_URI` to your local database or Atlas cluster.
2. Install dependencies with `npm install`.
3. Start both services with `npm run dev`.
4. Open http://localhost:5173. The API health endpoint is http://localhost:4000/api/health.

The API listens on port 4000 and Vite on 5173 by default. `CLIENT_ORIGIN` must match the frontend origin. In production set `NODE_ENV=production`, `JWT_SECRET`, `MONGODB_URI`, `CLIENT_ORIGIN`, and `API_PUBLIC_URL`; serve the frontend over HTTPS so the session cookie is Secure. Configure `VITE_API_URL` and `VITE_SOCKET_URL` at frontend build time to point to the deployed API. Production password recovery requires wiring reset tokens to a transactional email provider; development returns the reset link directly.

## Core flows

- Register/login, persistent HttpOnly session, logout, and expiring single-use password reset links
- Google OAuth 2.0 sign-in and account linking, plus an editable profile page
- Create private or public rooms, optional room password, readable `CIN-XXXX` code, invite link
- Join by code or link; room capacity and password enforced
- Admin-only movie selection/play/pause/seek; late join synchronization; drift correction
- Local video upload (MP4, WebM, OGG, MOV up to 1 GB) or authorized direct HTTP(S) video URL
- Persistent room chat, system messages, emoji reactions, participant presence
- Manual admin transfer; automatic earliest-active participant promotion after a 12-second disconnect grace period or explicit leave
- Admin participant removal, settings changes, and room closure

Direct, browser-playable video files and official YouTube embeds (when the video owner permits embedding) are supported. Netflix and other subscription-streaming pages, DRM-protected streams, and arbitrary web pages are not supported; use the provider's own watch-party feature for those services. CineTogether does not extract or bypass protected streams. Local uploads are hosted by the API process and are for development/small deployments; use an object-storage provider and signed URLs for production-scale media. Only upload/share media you are authorized to distribute. Static uploads are served by the API and possession of the generated URL grants access; do not use this local storage setup for sensitive media.

## Scripts

- `npm run dev` — run API and frontend together
- `npm run build` — compile API and build frontend
- `npm test` — run API policy tests
- `npm run dev:api` / `npm run dev:web` — run a service individually

## Environment variables

See `.env.example`. Secrets are never committed. The backend requires `JWT_SECRET` in production and refuses to start without MongoDB connectivity. Use a unique randomly generated secret and restrict MongoDB Atlas network access and credentials. Google sign-in is optional: create an OAuth 2.0 Web application client in Google Cloud Console, add `http://localhost:4000/api/auth/google/callback` as an authorized redirect URI, then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in `.env`. For deployment, register the exact HTTPS callback URL and configure those environment variables on the API host. Without them, email/password auth works and the Google button explains that configuration is needed.

## Tests

`npm test` runs focused tests for automatic admin successor selection and authoritative playback timestamp estimation. End-to-end HTTP/socket integration flows should use an isolated MongoDB test database; do not point test runs at production data. Build checks are `npm run build`.

## Deployment

Deploy `apps/web` as a Vercel Vite project. Set the root directory to `apps/web`, and define `VITE_API_URL`/`VITE_SOCKET_URL` for the public backend origin during build. Deploy `apps/api` to Render or another Node host with a persistent disk for local uploads (otherwise uploaded files are ephemeral), a MongoDB Atlas URI, `JWT_SECRET`, `CLIENT_ORIGIN`, `API_PUBLIC_URL`, `PORT`, and `NODE_ENV=production`. Set the API's CORS origin to the exact Vercel site origin and enable WebSockets on the host. For durable production media, replace local disk with a storage adapter backed by Cloudinary or object storage and issue authorized, expiring media URLs.

## Project map

- `apps/web/src` — landing/auth/dashboard/room UI and client API/socket integration
- `apps/api/src/server.ts` — REST API, authorization, Socket.IO room events, media upload
- `apps/api/src/models.ts` — MongoDB schemas and indexes
- `apps/api/src/roomPolicy.ts` — tested room lifecycle/playback policies
