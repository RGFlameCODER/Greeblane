# GREENLANE RP — production portal

A Node.js/Express application with Discord OAuth2 sign-in, verified Discord user IDs, server-side role checks, PostgreSQL persistence, whitelist/EMS/police applications, a staff dashboard, editable rules, audit logging, and Discord channel notifications.

The supplied Greenlane RP artwork is included at `public/assets/greenlane-hero.jpeg`.

## Architecture
- **Frontend:** responsive HTML/CSS/JavaScript served by Express (works on mobile and desktop).
- **Authentication:** Discord OAuth2 `identify`, with state validation and server-side session cookies.
- **Authorization:** staff/rules-admin access checked against current Discord guild member roles using the bot token on the server.
- **Database:** PostgreSQL for users, applications, rules, audit events, and sessions.
- **Notifications:** bot posts a new-application message in the configured Discord channel.
- **Security:** Helmet security headers, rate limits, CSRF token checks, HttpOnly/SameSite cookies, server-side validation, prepared SQL queries, and staff audit events.

## Important setup requirements
This is production-oriented application code, but it is **not live until you deploy it and provide your own credentials**. No credentials are included.

### 1. Create the Discord OAuth app and bot
1. Open the Discord Developer Portal: https://discord.com/developers/applications
2. Create an application named `Greenlane RP Portal`.
3. In **OAuth2**, copy the Client ID and create/copy the Client Secret.
4. Add this exact redirect URL after deployment: `https://YOUR-DOMAIN/auth/discord/callback`
5. In the **Bot** section, create/reset the bot token and keep it private.
6. Invite the bot to your Greenlane RP Discord server with the `bot` scope and the `View Channels` and `Send Messages` permissions for the application notification channel. Do not grant Administrator.
7. Copy the Discord server ID, application-notifications channel ID, staff role IDs, and rules-admin role IDs. Enable Developer Mode in Discord to copy IDs.
8. Set `DISCORD_INVITE_URL` to your actual server invite.

**Never put the Client Secret, Bot Token, database URL, or SESSION_SECRET into frontend JavaScript, GitHub commits, screenshots, or public issues.** Put them only in your hosting provider's secret environment variables.

### 2. Create PostgreSQL
Create a managed PostgreSQL database. Set `DATABASE_URL` to its connection string and `DATABASE_SSL=true` when required by your provider. Run migrations once against the production database:
```bash
npm install
npm run db:migrate
```
For Render, open the deployed service shell and run `npm run db:migrate`, or use a one-off job. Ensure the web service can reach the database.

### 3. Configure environment variables
Copy `.env.example` to `.env` for local development, then set:
- `NODE_ENV=development` locally; hosting should set `production`.
- `BASE_URL` to the public HTTPS URL (no trailing slash).
- `SESSION_SECRET` to a long random secret (32+ characters).
- `DATABASE_URL`, `DATABASE_SSL`.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`.
- `DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATIONS_CHANNEL_ID`.
- `DISCORD_STAFF_ROLE_IDS` as comma-separated role IDs allowed to review applications.
- `DISCORD_RULES_ADMIN_ROLE_IDS` as comma-separated role IDs allowed to edit rules. If blank, staff roles also get rules editing.
- `SUPER_ADMIN_USER_IDS` optionally as comma-separated trusted Discord user IDs.
- `DISCORD_INVITE_URL`.

Role IDs are checked against live membership on the configured server. Keep the bot in the server and ensure it can fetch members. Super-admin user IDs should be used sparingly.

### 4. Deploy with GitHub + Render
GitHub Pages cannot run this backend or safely store Discord secrets, so use GitHub as the source repository and a Node hosting service for the live app.

1. Create a **private** GitHub repository, e.g. `greenlane-rp-portal`.
2. Upload/commit these project files. Do not commit `.env`.
3. In Render, choose **New → Blueprint**, connect the repository, and use `render.yaml`.
4. Fill every environment variable marked `sync: false` in Render's dashboard.
5. Confirm the generated service URL, then update:
   - `BASE_URL=https://YOUR-SERVICE.onrender.com`
   - `DISCORD_REDIRECT_URI=https://YOUR-SERVICE.onrender.com/auth/discord/callback`
   - Add the same callback URL in the Discord Developer Portal.
6. Run `npm run db:migrate` once against the production database.
7. Check `https://YOUR-SERVICE/healthz`, sign in with Discord, submit a test application, and confirm the notification appears in the correct channel.
8. Consider a custom domain and configure the final callback URL consistently in both Render and Discord.

**Cost note:** Render plans and database pricing change; check current pricing before selecting a paid plan. The sample Blueprint uses a small paid database/service setup and may need plan adjustments for your account/region.

### 5. Local development
Requirements: Node.js 20+ and PostgreSQL.
```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```
Visit `http://localhost:3000`. Add `http://localhost:3000/auth/discord/callback` to Discord OAuth redirect URLs. `BASE_URL` must be `http://localhost:3000` locally.

### Features included
- Discord sign-in and verified Discord account ID storage.
- Checks that applicants are members of the configured Greenlane RP Discord server.
- Whitelist, EMS and Police applications with server-side validation and a per-account submission limit.
- PostgreSQL-backed statuses: pending, in review, approved, rejected, changes requested.
- Applicant view of their own application status and staff notes.
- Staff dashboard with filters, full answers, status changes, reviewer notes.
- Editable Discord and city rules, restricted to rules-admin roles.
- Discord bot notifications for new applications.
- Audit log for application submissions, reviews and rule changes.
- Health endpoint at `/healthz`.

### Security / operations checklist before launch
- Use a private repository and protect the main branch.
- Use HTTPS and secure environment variables; rotate any accidentally exposed secret immediately.
- Limit bot permissions to only what it needs.
- Use dedicated staff and rules-admin roles with least privilege.
- Test role removal, non-member access, CSRF failures, rate limits, and Discord outage behaviour.
- Configure database backups and a retention policy for applicant data.
- Publish a privacy notice explaining what application data is collected, who can see it, and how long it is retained.
- Confirm age eligibility, application questions, and official server rules with your moderation team.
- Set up monitoring/log review and a process to handle notification failures.
- Test the full application lifecycle before sharing the public URL.

## Notes
- Application data is saved even if the Discord notification request fails; the server logs the failure. For higher reliability, add a database-backed retry queue.
- The bot sends a minimal notification and does not include application answers in Discord.
- Staff notes are visible to the applicant in their own application history; keep them professional and avoid sensitive personal information.
- The starter city/Discord rules are examples. Replace them with the official Greenlane RP rules before opening the server.


## Animated Greenlane RP logo
The supplied Greenlane RP artwork is used as the header logo and hero artwork. The header logo gently floats, tilts, and glows; the hero artwork slowly drifts/zooms for a GIF-like animated effect. The source image was supplied as JPEG, so the motion is created with CSS rather than claiming the file itself is an animated GIF. Users with reduced-motion accessibility enabled see a static version.
