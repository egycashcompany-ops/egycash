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

## 4b. Fleet go-live imports

> **THE DEPLOY DOES THIS. There is normally nothing to run here.**
>
> Four go-live steps run by themselves, and each is versioned so that repeating one is a code
> change somebody reviews, never a side effect of a redeploy:
>
> 1. **The reset** (`go-live/reset.ts`, `go-live:reset:v2`) — once per database, first thing in
>    the Fleet seed: clears the test data off `/fleet/odometer`, `/maintenance`,
>    `/maintenance-alarms`, `/roster`, `/fixed-roster`, `/accidents`, `/violations`, `/catalogs`
>    and — since v2 — the vehicle registry itself. Spared, untouched: violation **types**, the
>    drivers registry, the three driver catalogs (job / specialization / licence) and the vehicle
>    **types**.
> 2. **The vocabulary** (167 names, Arabic + English) — every boot, create-if-missing, in the
>    Fleet seed after the reset. Like the driver catalogs beside it.
> 3. **The vehicle registry** (209 cars and their licence scans) — from data committed at
>    `apps/api/assets/fleet-go-live/` and copied into `dist/` by the build, started after boot by
>    whichever of `server.ts` / `worker.ts` claims it. The claim is a **lease**
>    (`fleet_go_live_runs`, key `go-live:vehicles:v3`): a run that finishes is `done` for good; a
>    run that is killed part-way leaves a lease that expires after 30 minutes, and the next boot
>    after that takes it over and finishes it. Every car already in is an update, so a take-over
>    is safe.
> 4. **The drivers' licence scans** (`go-live/driver-photos.ts`, key `go-live:driver-photos:v2`)
>    — one file per driver in `assets/fleet-go-live/driver-license-photos/`, named for the
>    driver's **employee code** (`0100026.jpg` is employee `0100026`). Each is matched to a
>    driving-seat employee by that code and attached to their profile, which is opened if the
>    driver was not yet on file. A scan whose code is nobody's is listed on the run and skipped.
>    Same lease as the cars; a take-over skips every scan that already landed.
>
> Deploy, wait, refresh.
>
> **EVERY STEP WRITES WHAT HAPPENED WHERE YOU CAN SEE IT.** The vehicles screen and the drivers
> screen print a notice — for whoever may create vehicles or manage drivers — whenever the step
> for that screen refused to start, failed part-way, is still running, or finished with something
> to note. It prints the step's own reasons verbatim (a branch name, a car code, a file name, the
> validation detail), and disappears when the step finished cleanly. The same rows are readable at
> `GET /api/v1/fleet/go-live`. Read that notice before this table; every case in it is named there.
>
> | the notice (or the log) says | what to do |
> |---|---|
> | «مرفوض، لم يبدأ» with **branches the system does not have** | Add them in /system under the company's own codes, then redeploy. Spelling is matched with the hamza, tashkeel and taa-marbuta folded («أسيوط» in the data finds «اسيوط» in /system), so only a genuinely absent branch is named here. Nothing is claimed, so the next boot imports everything. |
> | «مرفوض، لم يبدأ» with **deactivated branches** | Re-activate them in /system (the branch list's «تفعيل»). This is the check every car fails inside the service (`assertBranch`); the planner now refuses on it before claiming. The next boot imports everything. |
> | «مرفوض، لم يبدأ» with **numbers another vehicle already holds** | Resolve the plate / chassis / motor number on the vehicle named, then redeploy. |
> | «فشل جزئيًا» with a list of failures | Each line is `code: reason`, with the validation field named. The run is left **unfinished**: its lease expires in 30 minutes and the next boot after that retries it — an existing car is an update, so the retry completes the job. Fix whatever the reasons name; to retry sooner, redeploy after the lease is up. |
> | «تم، مع ملاحظات» on the drivers screen | Scans this step could not place, told apart: **no employee at all** with that code (add them in HR), **an employee whose job title does not require a driving test** (flag the title in /system — that is what puts them on the drivers registry), or one who has **left**. Fix the HR side; the scan is attached at the next key bump. |
> | nothing at all, and the registry is empty | The build shipped without its assets, or the seeded admin is missing. Both are named in the log; fix and redeploy. |
> | the dropdowns filled but the registry did not | The v1 shape: a run cut off between the types and the cars, under a mark that could not be retried. Since v2 the claim is a lease; since v3 the reasons are on the row and on the screen. |
>
> Correcting the source data after a finished import is a deliberate act: bump
> `VEHICLE_GO_LIVE_MARK` in `modules/fleet/go-live/vehicles.ts`. Repeating the reset likewise:
> `GO_LIVE_RESET_MARK` in `go-live/reset.ts`. Nothing does either by accident.

The commands below remain the manual path — for applying the data early, for dry-running it against
the live database before a deploy, and for finishing a run that stopped part-way.

Both are **dry-run by default** — they read, resolve every name against the live database, print
exactly what they would do, and write nothing. `--write` is the only thing that applies them, and
both are **re-runnable**: a name already in a catalog is left alone, a car already in the registry
is updated rather than duplicated. A run that fails halfway is finished by running it again.

They are built into `dist/` for this reason — the image installs with `--omit=dev`, so `tsx` is
absent and the `npm run …` forms work only on a developer machine.

> **Set `HR_PROVISION_MISSING_LOGINS=false` first.** Both commands boot the platform, and the boot
> runs HR's login backfill — a login for every employed employee that has none, and a WhatsApp
> message and an email to each carrying a setup link. It defaults to `true`, it happens before
> either command reads a row, so a **dry run would send them too**, and nothing recalls a delivered
> message. Both commands refuse to start while it is on. Turn it back on afterwards.

```bash
# 1. The house vocabulary: workshops, work types, spare parts, mission types, insurers.
#    Flags «صيانة» and «صيانة + إصلاح» as resetting the maintenance counter.
node apps/api/dist/fleet-vocabulary.cli.js
node apps/api/dist/fleet-vocabulary.cli.js --write

# 2. The vehicles. Upload cars.json and the photo folder to the service first.
#    REFUSES and names them if any branch in the data is missing from /system — add those first,
#    under the company's own branch codes; the importer will not invent one.
node apps/api/dist/fleet-vehicles-import.cli.js --file ./cars.json --photos ./cars_license_photos
node apps/api/dist/fleet-vehicles-import.cli.js --file ./cars.json --photos ./cars_license_photos --write
```

The import refuses, before writing anything, when a row cannot be read; when a branch it names is
not in `/system`; when a plate, chassis or motor number is already held by another vehicle; or when
a name it would create is one character from one already in a catalog (`--allow-near-duplicates`
says that was deliberate). It exits non-zero if any car was lost, so a script or a scheduler sees
it rather than reading the last line.

Afterwards, set each vehicle type's maintenance interval on `/fleet/settings`. The importer creates
them with `0`, which is how the alarm engine says «no service distance» — so the maintenance alarm
stays silent for every imported car until the number is filled in.

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
