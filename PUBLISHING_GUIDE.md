# CineTogether — Production Publishing & Deployment Guide

**Target System:** CineTogether Monorepo (`apps/api` + `apps/web`)  
**Target Environments:** Vercel (Frontend), Render / Node (Backend API), MongoDB Atlas (Database), S3 / Cloudinary (Media Storage)  
**Author:** Dwight (`dwight-muydg21w`), Information Gathering & Office Protocol  
**Date:** October 8, 2026  
**Build Verified:** Munder Difflin v0.5.5 / Node.js 22 LTS  

---

## 1. Overview & Architecture Blueprint

CineTogether is decoupled into an asynchronous, event-driven backend and a modern single-page client:

```
                  ┌────────────────────────────────────────┐
                  │          Vercel Edge Network           │
                  │   apps/web (Vite + React 18 SPA)       │
                  │   https://cinetogether.vercel.app      │
                  └──────────┬─────────────────────────────┘
                             │
                  HTTPS API  │  WSS (WebSockets)
                  & Cookies  │  Playback Sync & Chat
                             │
                             ▼
                  ┌────────────────────────────────────────┐
                  │           Render Web Service           │
                  │     apps/api (Node.js 22 + Express 5)  │
                  │     https://cinetogether-api.onrender.com
                  └───┬───────────────────────────────┬────┘
                      │                               │
         Mongoose /   │                  Direct Upload│ or Presigned
         TLS Connect  │                  URL Streaming│
                      ▼                               ▼
       ┌────────────────────────────┐  ┌────────────────────────────┐
       │     MongoDB Atlas (M0+)    │  │  Cloudinary / AWS S3 / R2  │
       │   Users, Rooms, Chat, Media│  │  Persistent Video Storage │
       └────────────────────────────┘  └────────────────────────────┘
```

---

## 2. Pre-Deployment Checklist

Before deploying to remote staging or production environments, verify the following local invariants:

1. **Clean Test Suite:**
   ```bash
   npm test
   ```
   Ensures domain policies in `apps/api/src/roomPolicy.test.ts` pass (all 8 tests).
2. **Typecheck & Production Build:**
   ```bash
   npm run build
   ```
   Ensures both `apps/api` (`tsc`) and `apps/web` (`tsc -b && vite build`) compile without syntax, type, or asset bundling errors.
3. **Cryptographically Secure Secrets:**
   Generate a 64-character random string for `JWT_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   *Never use the development fallback secret in production.*
4. **HTTPS / Secure Cookies:**
   In production (`NODE_ENV=production`), the session cookie uses `secure: true` and `sameSite: 'none'`. Both frontend and backend **must** be served over HTTPS for cross-site cookie transmission to succeed.

---

## 3. Database Deployment: MongoDB Atlas

CineTogether requires MongoDB 7+ with replica sets enabled (standard on MongoDB Atlas).

### Step 3.1: Create Cluster
1. Sign in to [MongoDB Atlas](https://cloud.mongodb.com/).
2. Create a new project named `cinetogether-prod`.
3. Deploy a cluster:
   - For hobby/testing: **M0 Free Tier** (AWS or GCP, select closest region to your API server).
   - For commercial/production: **M10+ Dedicated Cluster** with automatic daily backups.

### Step 3.2: Create Database User
1. Navigate to **Security > Database Access**.
2. Click **Add New Database User**.
3. Authentication Method: **Password**.
4. Set username: `cinetogether_app`.
5. Generate a secure 32-character password and record it securely.
6. Database User Privileges: **Read and write to any database** (or scope to `cinetogether_prod`).

### Step 3.3: Network Access
1. Navigate to **Security > Network Access**.
2. Click **Add IP Address**.
3. For cloud-hosted servers with dynamic IP addresses (such as Render, Fly.io, or Railway):
   - Add `0.0.0.0/0` (Allow Access from Anywhere).
   - Note: MongoDB Atlas enforces authentication even with `0.0.0.0/0`.
4. If using dedicated static outbound IP proxies, whitelist those specific IPs.

### Step 3.4: Connection String URI
1. Navigate to **Deployments > Database > Connect**.
2. Select **Drivers** (Node.js, Version 5.5 or later).
3. Copy the SRV connection URI:
   ```
   mongodb+srv://cinetogether_app:<PASSWORD>@cinetogether-cluster.xxxxxx.mongodb.net/cinetogether_prod?retryWrites=true&w=majority&appName=CineTogether
   ```
4. Replace `<PASSWORD>` with the password created in Step 3.2.

### Step 3.5: Recommended Production Indexes
Execute in MongoDB Compass or Atlas Data Explorer to eliminate collection scans:
```javascript
// Room participant & status query optimization
db.rooms.createIndex({ "participants.userId": 1, "status": 1 });

// Chat lookup index
db.chatmessages.createIndex({ "roomId": 1, "createdAt": -1 });

// Media library lookup index
db.media.createIndex({ "ownerId": 1, "createdAt": -1 });
```

---

## 4. Backend Deployment: Render (Node.js & WebSockets)

Render provides native WebSocket support, SSL termination, and managed environments.

### Step 4.1: Create Render Web Service
1. Log in to the [Render Dashboard](https://dashboard.render.com/).
2. Click **New + > Web Service**.
3. Connect your GitHub repository.
4. Configure service parameters:
   - **Name:** `cinetogether-api`
   - **Region:** Frankfurt (EU) or Oregon/Ohio (US) — match your MongoDB Atlas region.
   - **Branch:** `main`
   - **Root Directory:** Leave empty (root) or set to project root.
   - **Runtime:** `Node`
   - **Build Command:**
     ```bash
     npm install && npm --workspace apps/api run build
     ```
   - **Start Command:**
     ```bash
     npm --workspace apps/api run start
     ```
   - **Plan:** **Starter** ($7/mo) or higher. *(Free instances spin down on inactivity, severing WebSocket connections and losing in-memory room playback states).*

### Step 4.2: Configure Production Environment Variables
In the Render **Environment** tab, add the following key-value pairs:

| Variable | Recommended Production Value | Description |
|:---|:---|:---|
| `NODE_ENV` | `production` | Enables production security, secure cookies, and strict validation. |
| `PORT` | `4000` | Port listened to by Express (Render forwards external 443 to this). |
| `CLIENT_ORIGIN` | `https://cinetogether.vercel.app` | Exact HTTPS URL of your deployed frontend (no trailing slash). |
| `API_PUBLIC_URL` | `https://cinetogether-api.onrender.com` | Public URL of this Render service. |
| `MONGODB_URI` | `mongodb+srv://cinetogether_app:...` | Atlas SRV connection string with database name. |
| `JWT_SECRET` | *`<64-character-random-hex>`* | Cryptographic signing secret for `ct_session` cookies. |
| `UPLOAD_DIR` | `./uploads` (or mounted disk path) | Local storage directory for uploaded files. |
| `GOOGLE_CLIENT_ID` | *`xxxx.apps.googleusercontent.com`* | Google Cloud OAuth 2.0 Web Client ID. |
| `GOOGLE_CLIENT_SECRET` | *`GOCSPX-xxxx`* | Google Cloud OAuth 2.0 Client Secret. |
| `GOOGLE_CALLBACK_URL` | `https://cinetogether-api.onrender.com/api/auth/google/callback` | Exact OAuth redirect URI registered in Google Cloud Console. |

### Step 4.3: Persistent Disks (If Retaining Local Multer Uploads)
*Warning:* Standard Render instances have ephemeral filesystems. If you keep the default local upload mechanism:
1. Navigate to **Disks** in your Render service settings.
2. Click **Add Disk**:
   - **Name:** `cinetogether-media`
   - **Mount Path:** `/var/data/uploads`
   - **Size:** 10 GB to 50 GB.
3. Update the environment variable:
   ```
   UPLOAD_DIR=/var/data/uploads
   ```
*(For production scale, see Section 6 for S3 / Cloudinary migration recommendations).*

---

## 5. Frontend Deployment: Vercel (Vite SPA)

Deploying `apps/web` to Vercel provides worldwide edge distribution and automatic HTTPS.

### Step 5.1: Import Project in Vercel
1. Log in to [Vercel](https://vercel.com/).
2. Click **Add New... > Project**.
3. Import your CineTogether repository.
4. In the configuration screen:
   - **Framework Preset:** `Vite`
   - **Root Directory:** Click Edit and select `apps/web`.

### Step 5.2: Build & Output Settings
Verify the detected settings:
- **Build Command:** `npm run build` (or `tsc -b && vite build`)
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### Step 5.3: Environment Variables
Add the build-time environment variables in Vercel:

| Variable | Value | Description |
|:---|:---|:---|
| `VITE_API_URL` | `https://cinetogether-api.onrender.com` | Public origin of your deployed backend API. |
| `VITE_SOCKET_URL` | `https://cinetogether-api.onrender.com` | WebSocket server origin for Socket.IO connections. |

### Step 5.4: Client-Side Routing Configuration (`vercel.json`)
Because CineTogether uses React Router 7 with client-side history (`/room/:code`, `/login`, `/app`, `/profile`), navigating directly to or refreshing subroutes requires SPA rewrites.

Ensure a `vercel.json` exists in `apps/web/vercel.json`:
```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

Click **Deploy**. Once complete, Vercel provides your production domain: `https://cinetogether.vercel.app`.

---

## 6. Cloud Object Storage Migration (Cloudinary & S3)

In production, streaming 1 GB video files via local disk and Node.js (`express.static`) introduces disk I/O bottlenecks and consumes CPU bandwidth. Migrating to dedicated cloud media storage is strongly recommended.

### Migration Path A: Cloudinary (Fastest Setup & Video Optimization)
Cloudinary provides managed video streaming, automatic format transcoding (MP4/WebM), and CDN distribution.

1. **Sign Up & Credentials:** Create account at [cloudinary.com](https://cloudinary.com) and retrieve:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
2. **Install SDK in API:**
   ```bash
   npm --workspace apps/api install cloudinary
   ```
3. **Implementation Pattern:** Replace `multer.diskStorage` in `apps/api/src/server.ts` with direct streaming upload:
   ```typescript
   import { v2 as cloudinary } from 'cloudinary';

   cloudinary.config({
     cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
     api_key: process.env.CLOUDINARY_API_KEY,
     api_secret: process.env.CLOUDINARY_API_SECRET,
     secure: true
   });

   // In /api/media/upload:
   // Pipe multer memoryStorage or temp file stream to cloudinary.uploader.upload_stream
   // Save secure_url to Media model.
   ```

### Migration Path B: AWS S3 / Cloudflare R2 + Presigned URLs (Most Scalable)
Offloads all upload bandwidth from the Express API directly to the storage provider:

```
[Browser] ── 1. POST /api/media/presign ──► [Express API]
[Browser] ◄── 2. Returns S3 Presigned URL ─ [Express API]
[Browser] ── 3. PUT Video Direct to S3 ────► [AWS S3 Bucket / Cloudflare R2]
[Browser] ── 4. POST /api/media (confirm) ─► [Express API]
```

1. **Bucket Configuration:** Create private bucket (`cinetogether-media-prod`).
2. **CORS Configuration on Bucket:**
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedOrigins": ["https://cinetogether.vercel.app"],
       "ExposeHeaders": ["ETag"]
     }
   ]
   ```
3. **Signed URLs for Video Playback:** Issue expiring CloudFront signed URLs or S3 GET URLs to authorized room participants only, keeping private media secure.

---

## 7. Google OAuth 2.0 Production Configuration

To enable Google Sign-In on your production domains:

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project and navigate to **APIs & Services > OAuth consent screen**.
   - User Type: **External**
   - App Name: `CineTogether`
   - User Support Email: `your-email@example.com`
   - Authorized Domains: Add `vercel.app` and `onrender.com` (or your custom domains).
   - Scopes: `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`.
   - Publish App: Switch from **Testing** to **In Production** (removes the 100-user cap and authorization warning screen).
3. Navigate to **APIs & Services > Credentials**.
4. Edit your **OAuth 2.0 Client ID**:
   - **Authorized JavaScript origins:**
     - `https://cinetogether.vercel.app`
     - *(Your custom domain if applicable)*
   - **Authorized redirect URIs:**
     - `https://cinetogether-api.onrender.com/api/auth/google/callback`
     - *(Your custom backend domain callback if applicable)*
5. Copy the Client ID and Client Secret into your Render environment variables.

---

## 8. Scaling Architecture: Redis Adapter Integration

Currently, playback position (`playback: Map`) and active socket connections (`onlineByRoom: Map`) are held in the local Node.js process memory.

When scaling the backend to multiple instances on Render or Kubernetes:
1. **Provision Redis:** Deploy a Redis instance via [Upstash](https://upstash.com/) or Render Redis.
2. **Install Redis Adapter:**
   ```bash
   npm --workspace apps/api install @socket.io/redis-adapter redis
   ```
3. **Attach to Socket.IO:**
   ```typescript
   import { createClient } from 'redis';
   import { createAdapter } from '@socket.io/redis-adapter';

   const pubClient = createClient({ url: process.env.REDIS_URL });
   const subClient = pubClient.duplicate();
   await Promise.all([pubClient.connect(), subClient.connect()]);

   io.adapter(createAdapter(pubClient, subClient));
   ```
4. **Persist Playback State in Redis:**
   Store `playback:${roomId}` in Redis hashes rather than in-memory Maps so that any backend replica can serve synchronized video positions.

---

## 9. Post-Deployment Verification & Smoke Tests

After publishing both services, perform this end-to-end verification runbook:

1. **Backend Health Check:**
   ```bash
   curl -i https://cinetogether-api.onrender.com/api/health
   ```
   *Expected Response:* HTTP 200 `{"status":"ok","database":"connected"}`.
2. **CORS & Cookie Inspection:**
   - Open browser developer tools on `https://cinetogether.vercel.app`.
   - Register a new account.
   - Inspect the `/api/auth/register` response headers:
     - `Set-Cookie: ct_session=...; Path=/; HttpOnly; Secure; SameSite=None`
     - `Access-Control-Allow-Origin: https://cinetogether.vercel.app`
     - `Access-Control-Allow-Credentials: true`
3. **Socket.IO Handshake:**
   - Check the **Network > WS** tab in browser devtools.
   - Confirm WSS upgrade request to `wss://cinetogether-api.onrender.com/socket.io/?...` returns HTTP 101 Switching Protocols.
4. **Synchronized Playback Test:**
   - Create a private room in Window A.
   - Copy invite link and join from an Incognito Window B (as a different user).
   - In Window A, set an official embeddable YouTube video (e.g., `https://www.youtube.com/watch?v=dQw4w9WgXcQ`) or direct MP4 link.
   - Press **Play** in Window A. Verify Window B starts playing simultaneously within 1.5 seconds.
   - Scrub in Window A. Verify Window B seeks immediately.
   - Send chat messages and reactions; verify real-time reception on both sides.
5. **Host Failover Test:**
   - Close Window A (the Host).
   - Observe Window B: after 12 seconds, Window B receives `Admin rights transferred to [User B]` and the Host badge updates.

---

## 10. Operational Runbook & Troubleshooting

### Issue 1: Login succeeds, but dashboard redirects back to login immediately
- **Cause:** Browser blocked the `ct_session` cookie due to missing `SameSite=None; Secure`.
- **Solution:** Ensure `NODE_ENV=production` is set on Render, and both frontend and backend use HTTPS. Chrome blocks `SameSite=None` cookies if `Secure` is missing or served over HTTP.

### Issue 2: Direct URL access or page reload returns 404 on Vercel
- **Cause:** Vite SPA routes are not redirected to `/index.html`.
- **Solution:** Verify `apps/web/vercel.json` contains the SPA rewrites rule (`"source": "/(.*)", "destination": "/index.html"`).

### Issue 3: Socket connection fails with `Authentication required`
- **Cause:** Socket.IO handshake headers did not include the `ct_session` cookie.
- **Solution:** Verify frontend client initialization in `apps/web/src/App.tsx` has `withCredentials: true`, and `CLIENT_ORIGIN` matches the exact Vercel origin.

### Issue 4: MongoDB Atlas connection timeout
- **Cause:** Atlas IP Access List does not permit inbound connections from Render.
- **Solution:** In Atlas Network Access, verify `0.0.0.0/0` is added and active.

---

*End of Production Publishing & Deployment Guide.*
