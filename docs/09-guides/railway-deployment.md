# Deploying ECMS on Railway

The monorepo deploys as **two Railway services from the same repo** plus managed data
stores. The web bundle is served **same-origin by the api** (`WEB_STATIC_DIR`) — this is
deliberate: the refresh cookie is `SameSite=Strict`, so a split web/api across two Railway
domains would break silent session refresh. Config-as-code lives at the repo root:

| Service | Config file | Runs |
|---|---|---|
| **app** (public) | `railway.json` (picked up automatically) | api + serves the built web + Socket.IO |
| **worker** (private) | `railway.worker.json` (set as *Config File Path*) | BullMQ consumers + the scheduler |

Railpack's "No start command detected" error on a raw deploy is expected — the workspace
has four packages; the config files above tell it what to build and run.

## 1. Data stores

- **MongoDB — must be a replica set.** The platform uses real multi-document transactions
  (ADR-005), which standalone MongoDB rejects. Use **MongoDB Atlas** (the free M0 tier is
  a replica set) — or any replica-set-enabled cluster. Railway's basic MongoDB template is
  a standalone instance and **will fail on the first hire/registration**.
- **Redis** — add Railway's Redis template to the project (cache, rate limiting, queues).

## 2. Create the services

1. **New Project → Deploy from GitHub repo** → pick this repo. That first service becomes
   **app**: it reads `railway.json` automatically. Generate a public domain for it
   (Settings → Networking).
2. **Add a second service from the same repo** → name it **worker** → Settings → Build →
   **Config File Path** = `railway.worker.json`. No public domain.
3. Attach a **Volume** to **app** (e.g. mount path `/data`) for uploaded files.

## 3. Environment variables

**app** and **worker** share most values (use a shared variable group if you like):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGO_URI` | the Atlas connection string (includes the db name) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `JWT_ACCESS_SECRET` | long random secret (required in production) |
| `STORAGE_SIGNING_SECRET` | long random secret (required in production) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SECURE` | your mail provider |
| `NOTIFICATIONS_EMAIL_FROM` | e.g. `EGYCASH <no-reply@yourdomain>` |
| `WHATSAPP_PROVIDER` | `disabled` until Meta/Twilio credentials exist (`meta`/`twilio` + `WHATSAPP_API_TOKEN`, `WHATSAPP_ACCOUNT_ID`, `WHATSAPP_FROM_NUMBER`) |

**app only:**

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `/api/v1` (baked into the web build — same-origin) |
| `WEB_STATIC_DIR` | `apps/web/dist` |
| `API_PUBLIC_URL` | `https://<app-domain>` (signed download URLs) |
| `WEB_PUBLIC_URL` | `https://<app-domain>` (the setup/activation links in messages) |
| `CORS_ORIGINS` | `https://<app-domain>` |
| `COOKIE_SECURE` | `true` |
| `STORAGE_DRIVER` | `railway` (local disk rooted at the volume; Railway injects `RAILWAY_VOLUME_MOUNT_PATH`) |

`PORT` is injected by Railway and honored automatically. Changing `VITE_API_BASE_URL` or
any `VITE_*` value requires a **redeploy** — it is a build-time value.

## 4. First boot

1. Deploy both services; **app** reports healthy on `/health/ready`.
2. Seed the initial accounts once — service shell (or `railway run` locally):

   ```bash
   node apps/api/dist/seed.js
   ```

   This creates the super-admin/HR logins from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
   (+ `SEED_HR_*`) — override them as service variables **before** seeding, then sign in
   and change them. Boot-time seeds (permissions, navigation, notification templates,
   settings) run automatically and idempotently on every deploy.

3. Open `https://<app-domain>` → log in with the seeded admin.

## 5. Serving under a subpath — `https://egycash.com.eg/ecms`

The whole app can live under a path prefix on the company domain while still running on
Railway. Two pieces:

### 5.1 App configuration (prefix-aware build + runtime)

Set on the **app** service (replacing the corresponding §3 values), then redeploy:

| Variable | Value |
|---|---|
| `BASE_PATH` | `/ecms` — mounts the api (`/ecms/api/v1`), the web, and the refresh-cookie path under the prefix; `/health/*` also stays at the root for Railway's probe |
| `VITE_BASE_PATH` | `/ecms/` (asset base + router basename — build-time) |
| `VITE_API_BASE_URL` | `/ecms/api/v1` |
| `API_PUBLIC_URL` | `https://egycash.com.eg/ecms` |
| `WEB_PUBLIC_URL` | `https://egycash.com.eg/ecms` (activation links become `https://egycash.com.eg/ecms/activate?token=…`) |
| `CORS_ORIGINS` | `https://egycash.com.eg` |
| `COOKIE_SECURE` | `true` |

The worker needs no path-related variables.

### 5.2 Reverse proxy on the egycash.com.eg web server

Railway custom domains are host-based, so a *path* on an existing domain is delegated by
the server that already hosts `egycash.com.eg`. Nginx example — **the prefix is passed
through verbatim** (no rewriting; the app expects it), and the `Host` header must be the
Railway domain because Railway's edge routes by host:

```nginx
location /ecms {
    proxy_pass https://<app-service>.up.railway.app;   # no trailing URI part — path passed as-is
    proxy_set_header Host <app-service>.up.railway.app;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;            # future websocket use
    proxy_set_header Connection "upgrade";
    client_max_body_size 30m;                          # ≥ MAX_UPLOAD_MB
}
```

(Apache equivalent: `ProxyPass /ecms https://<app>.up.railway.app/ecms` +
`ProxyPreserveHost Off` + `RequestHeader set Host "<app>.up.railway.app"`.)

Verify after deploy: `https://egycash.com.eg/ecms/health/ready` answers `{"status":"ok"}`,
the login page loads at `https://egycash.com.eg/ecms`, and after signing in the browser
holds the `ecms_refresh` cookie scoped to `/ecms/api/v1/auth`.

## 6. Notes

- **Worker is required**: notifications, the outbox relay, scheduled personnel actions,
  offer expiration and the invitation expiry sweep all run there. Without it the app works
  but nothing asynchronous happens.
- **Scaling**: `app` scales horizontally (state lives in Mongo/Redis); keep **one** worker
  replica unless queues demand more (the scheduler tolerates replicas via locking, but one
  is the reviewed configuration).
- **Uploads** live on the app volume — attach the volume before enabling file features in
  production; losing the volume loses the files (S3/Azure drivers exist when object
  storage is preferred: `STORAGE_DRIVER=s3|minio|azure`).
- CI (`.github/workflows/ci.yml`) is unaffected — these files only configure Railway.
