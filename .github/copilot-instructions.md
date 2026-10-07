# CineTogether workspace notes

- This is an npm-workspaces monorepo: frontend lives in `apps/web`, API in `apps/api`.
- Run `npm run dev` for both services; MongoDB and a local `.env` are required for API functionality.
- Run `npm run build` and `npm test` to verify changes.
- Keep secrets in `.env`, never commit them. The API uses an HttpOnly JWT cookie and server-side role checks.
- Socket playback/chat authorization must be verified on the server; do not trust client roles.
- Support authorized direct video files/URLs and official YouTube embeds only when embedding is permitted; never extract or bypass protected streams. Subscription-streaming pages remain unsupported.
- Prefer minimal dependencies and maintain the dark, responsive design system in `apps/web/src/styles.css`.
