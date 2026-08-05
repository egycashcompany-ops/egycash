# Deploying ECMS on Railway

The monorepo deploys as **two Railway services from the same repo** plus managed data
stores. The web bundle is served **same-origin by the api** (`WEB_STATIC_DIR`) — this is
deliberate: the refresh cookie is `SameSite=Strict`, so a split web/api across two Railway
domains would break silent session refresh. Config-as-code lives at the repo root:

| Service | Config file | Runs |
|---|---|---|
| **app** (public) | `railway.json` (picked up automatically) | api + serves the built web + Socket.IO |
| **worker** (private) | `railway.worker.json` (set as *Config File Path*) | BullMQ consumers + the scheduler |

(A third, **optional** service — the National-ID OCR sidecar — is covered in §6. Skip it and
the platform runs exactly as before, with National-ID scanning reporting `available: false`.)

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

> ⚠️ **This topology has a known defect — see [ADR-020](../03-decisions/ADR-020-shared-file-storage.md).**
> A Railway volume attaches to exactly one service, but the file store is shared between **both**:
> the worker writes contract PDFs and evaluation-batch packages that the app must serve, and reads
> the company logo and applicant attachments the app uploaded. With a volume on **app** only, those
> worker-written files are unreachable from the app and the worker's own reads fail silently.
> Separately, if the volume is missing altogether, `STORAGE_DRIVER=railway` falls back to a
> directory *inside* the container, which every deploy erases. The fix is an object store shared by
> both services — designed in
> [shared-file-storage-design.md](../12-planning/shared-file-storage-design.md), pending a decision.

## 3. Environment variables

**app** and **worker** share most values (use a shared variable group if you like):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGO_URI` | the Atlas connection string (includes the db name) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}?family=0` |
| `JWT_ACCESS_SECRET` | long random secret (required in production) |
| `STORAGE_SIGNING_SECRET` | long random secret (required in production) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SECURE` | your mail provider |
| `NOTIFICATIONS_EMAIL_FROM` | e.g. `EGYCASH <no-reply@yourdomain>` |
| `WHATSAPP_PROVIDER` | `disabled` until Meta/Twilio credentials exist (`meta`/`twilio` + `WHATSAPP_API_TOKEN`, `WHATSAPP_ACCOUNT_ID`, `WHATSAPP_FROM_NUMBER`) |

**app only:**

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `/api/v1` (baked into the web build — same-origin) |
| `WEB_STATIC_DIR` | `/app/apps/web/dist` (absolute — `npm start -w` runs with cwd `apps/api`, so a relative path resolves wrong) |
| `API_PUBLIC_URL` | `https://<app-domain>` (signed download URLs) |
| `WEB_PUBLIC_URL` | `https://<app-domain>` (the setup/activation links in messages) |
| `CORS_ORIGINS` | `https://<app-domain>` |
| `COOKIE_SECURE` | `true` |
| `STORAGE_DRIVER` | `railway` (local disk rooted at the volume; Railway injects `RAILWAY_VOLUME_MOUNT_PATH`) |

`PORT` is injected by Railway and honored automatically. Changing `VITE_API_BASE_URL` or
any `VITE_*` value requires a **redeploy** — it is a build-time value.

> **Why `?family=0` on `REDIS_URL`:** Railway private networking is IPv6-only; without it
> ioredis resolves the private hostname over IPv4 and the queues fail with
> `connect ETIMEDOUT`. `family=0` lets ioredis use whichever family DNS returns.

**worker only — contract PDF rendering (optional but recommended):**

The Contracts module renders its PDFs in the **worker** through headless chromium. Without
these variables generation still completes and the print view serves exports — only the
downloadable PDF is skipped.

| Variable | Value |
|---|---|
| `RAILPACK_DEPLOY_APT_PACKAGES` | `chromium fonts-noto fonts-noto-color-emoji` (installs the browser + Arabic-capable Noto fonts into the deploy image) |
| `CHROMIUM_PATH` | `/usr/bin/chromium` |

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

## 6. Optional — the National-ID OCR sidecar

Scanning a National ID card is an **assisted** feature: it pre-fills the applicant form and a
human confirms every field in the review dialog. The reader is a separate Python container
(`spikes/national-id-ocr/`) with the PaddleOCR weights baked into the image, so it makes no
outbound calls at runtime. **Deploy it only if you want the scan button to work** — with
`NATIONAL_ID_OCR_URL` unset the api keeps its null provider and applicants are entered by hand,
which is the default everywhere.

1. **Add a third service from the same repo** → name it e.g. **nid-ocr** → Settings → Build →
   **Root Directory** = `spikes/national-id-ocr`. **No public domain** — the card images are
   personal data and only the api needs to reach it.

   > **Set the Root Directory, not the Dockerfile Path.** They are not interchangeable here.
   > Pointing *Dockerfile Path* at `spikes/national-id-ocr/Dockerfile` leaves the service rooted
   > at the repo, so Railway still reads the root `railway.json` — and its
   > `startCommand: npm run start -w apps/api` overrides the image's `CMD`. The build succeeds and
   > the deploy dies with **"The executable `npm` could not be found"**, because the sidecar image
   > is `python:3.11-slim` and has no Node in it. With the Root Directory set, config resolution
   > moves with it and `spikes/national-id-ocr/railway.json` applies instead.

   That file deliberately sets **no `startCommand`**: the Dockerfile declares
   `ENTRYPOINT ["python"]` with `CMD ["-m", "nidocr.service"]`, and a Railway start command would
   be layered onto the entrypoint rather than replacing it.
2. Variables on **nid-ocr**:

   | Variable | Value |
   |---|---|
   | `OCR_PORT` | `8099` |
   | `OCR_PRELOAD` | `1` (loads the model at boot instead of on a recruiter's first scan) |
   | `OCR_LAYOUT_PROFILE` | *leave unset.* The image already defaults to `/app/profiles/egypt-nid.json`, the geometry measured from a real card. Set it only to point at your own calibration — and note the file must exist in the container, because a profile that fails to load raises at start rather than falling back silently. |

3. Point the **app** service at it — this is the only variable the platform itself needs:

   | Variable | Value |
   |---|---|
   | `NATIONAL_ID_OCR_URL` | `http://nid-ocr.railway.internal:8099` (use the service's own name) |
   | `NATIONAL_ID_OCR_TIMEOUT_MS` | `20000` (default; raise only if the service runs cold) |

   The **worker** needs neither — OCR runs on the request path, not in a queue.

Sizing: the image carries the recognition weights and PaddlePaddle, so give the service more
memory than the api (it holds the model resident) and expect a slow first boot while it loads.
Model load happens once per container, not per request.

> **IPv6:** the sidecar binds `::` dual-stack for the same reason `REDIS_URL` needs `?family=0`
> — Railway's private network is IPv6-only, and a service bound to `0.0.0.0` is simply
> unreachable at `*.railway.internal`. Nothing to configure; noted because the symptom of
> getting it wrong is an OCR timeout that looks like a model problem.

Verify: the sidecar's deploy log ends with `nidocr listening on [::]:8099`, and in the app a
National-ID scan returns fields into the review dialog rather than "OCR unavailable".

## 7. Notes

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
