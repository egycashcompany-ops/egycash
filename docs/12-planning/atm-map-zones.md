# ATM machine map and owner-drawn zones — implementation spec

**Status:** implementation spec. The owner's decisions D-M1…D-M8 are final (approved 2026-10-18: «موافق على
المقترح كله، ابدأ»). **Approved mockups:** https://claude.ai/artifact/EoEQQMfQqGNggExu4UNcDL (three boards:
«خريطة الماكينات», «رسم وتعديل القطاعات», «ماكينات بدون موقع»). **Target:** ECMS module `atm`; this
manifest grows and no second one is added (`apps/api/src/modules/atm/atm.module.ts:1-9`).

Two implementers follow this document literally: **WP-M1** (contracts + API) first, then **WP-M2** (web).
Every claim about existing code cites `file:line` on branch `claude/atm-operations-ecms-442l5r` (HEAD
`27920426`), read for this spec. **No value from the owner's workbook appears here.** The figures in §4 are
the research's counts only.

> **Governing rules (every work package).** The server never treats a `branchId` from the browser as a
> security fact. A browser branch may only NARROW a read inside the caller's reach, and every write checks
> that the key reaches the record's branch. Behaviour that nobody asked for is not added, no legacy
> feature is removed, and no data is invented: a location the text does not give is not placed. Where
> the code has no clear answer, the gap is recorded (§10) instead of guessed. `/home/user/ATM` and
> `/home/user/Automation` are read-only. UI strings are ar + en, formal Arabic
> (`scripts/check-formal-arabic.mjs:53-108`), and `PageHeader` has no subtitle
> (`apps/web/src/platform/layout/PageContainer.tsx:8-13`).

---

## Contents

1. Purpose and scope
2. Decisions (owner D-M1…D-M8, designer DM-n)
3. Data model
4. Location derivation
5. Short-link resolver
6. API
7. Permissions, manifest, navigation
8. Web
9. Tests
10. GAP register and rollout
- Appendix A. Work packages and file ownership

---

## 1. Purpose and scope

Today no ATM record carries coordinates. The machine master holds `branchId, bankName, machineCode,
name, zone, area, isActive` (`apps/api/src/modules/atm/machines/machine.model.ts:13-25`). Location exists
only as two free-text register columns, `locationPlusCode` (Excel AP) and `locationUrl` (Excel AV)
(`apps/api/src/modules/atm/register/register.model.ts:68-69, 180-181`;
`packages/contracts/src/modules/atm-register.ts:505, 511`), and nothing parses them. The legacy ATM and
Automation repositories have no map, location or zone feature, so there is nothing to port (research
`legacy-atm.md` §1, `automation.md`).

This feature adds:

1. **S1 — «خريطة الماكينات» (`/atm/map`).** Every machine in the caller's reach shown on an
   OpenStreetMap base, coloured by zone or by bank, with filters, figures, a zone panel, zone details
   and a machine popup.
2. **S2/S3 — zone editing (edit mode of `/atm/map`).** Draw a zone dot by dot. Drag the orange vertex
   handles and the blue edge-midpoint handles, snap to points or zones, link shared vertices, rename,
   recolour, reorder, delete, undo and redo. All changes are saved together in one request.
3. **S5 — «ماكينات بدون موقع» (`/atm/map/unlocated`).** Machines without a usable location, grouped by
   reason. Here a user can paste a link, coordinates or a Plus Code, place or correct a pin, approve the
   pins that need review, sync locations from the register and resolve Google short links.

The real screens follow the approved mockups' layout and behaviour, and they are built from existing
ECMS components. Local mockup sources and screenshots are in the scratchpad (`map-canvas/project/*.dc.html`
and `map-check/{1-map,2-edit-drag,3-draw-new-zone,4-unlocated}.png`). Their Arabic strings are reproduced
in §8.12.

**Out of scope for v1** (D-M8 and the owner's deferral list): Split, freehand Cut and «Clear Zones». The
legacy `zone` string stays `''` everywhere (`machine.model.ts:20-21, 37`; `machine.service.ts:195, 232`;
`register-coupling.ts:195`), and tasks keep copying it unchanged (`replenishment.service.ts:138`;
`maintenance.service.ts:162`).

---

## 2. Decisions

### 2.1 Owner decisions (final — implement exactly)

| # | Decision (verbatim from the brief) | Where |
|---|---|---|
| D-M1 | Name: «قطاع / القطاعات» in Arabic, "Zone / Zones" in English. «المنطقة» stays the existing Area; «النطاق» is taken (permission scope). | §8.12 |
| D-M2 | A zone is a NEW map layer. A machine belongs to a zone by its position on the map (point-in-polygon). The machine's Area is untouched; no data is rewritten. | §3.1, §8.5 |
| D-M3 | Base map: OpenStreetMap raster tiles, the host already allowed by the CSP (`apps/api/src/app.ts` img-src `https://*.tile.openstreetmap.org`) and already used by `apps/web/src/modules/operations/components/BranchMapPicker.tsx`. No satellite. Attribution «© OpenStreetMap» is a licence condition. | §8.4 |
| D-M4 | Google short links (maps.app.goo.gl / goo.gl/maps): the SERVER opens each link once and reads the coordinates (admin-triggered, audited, https only, strict host allowlist, redirect limit, timeout, throttle). Whatever cannot be resolved goes to the manual list. | §5 |
| D-M5 | Three new permission keys: `atmMap.view` (see the map; per-branch scope), `atmZone.manage` (draw/edit/delete/reorder zones), `atmMachine.locate` (place/move/approve a machine's pin, run the location sync and the link resolution). Seeded to super-admin only; administrators grant them. | §7 |
| D-M6 | Zones belong to a branch (like the sample's "fleet" selector). A branch supervisor draws for his branch; organization-wide users see all branches in reach. Editing happens for ONE branch at a time — the branch comes from the top-bar branch (or the caller's only branch), never from the form (pattern `apps/api/src/modules/atm/shared/atm-context.ts`). | §6.3, §8.6 |
| D-M7 | Zones MAY overlap, with a warning. A machine inside two zones counts for the zone HIGHER in the list order (Move Up / Move Down / Sort A-Z decide the order). | §8.5 |
| D-M8 | v1: zones are for display, division and counts on the map only. The legacy `zone` string on machines/operations stays exactly as it is (always ''). | §1 |
| — | Deferred / dropped from the sample: Split and freehand Cut → v1.1; "Clear Zones" dropped (zones are deleted one by one, each confirm showing its machine count). Kept: drag vertex handles (orange squares), drag edge-midpoint handles to add a vertex (blue diamonds), Snap to point/zone with a px threshold, "Show zone names on map", editable name, Move Up / Move Down / Sort A-Z, Save / Reload (= discard changes), the zone count. | §8.6 |

### 2.2 Designer decisions (the owner did not specify these; each is the narrowest choice that keeps D-M1…D-M8 true)

| # | Decision | Why |
|---|---|---|
| DM-1 | A manual pin does NOT rewrite the register's AP/AV text; it is stored on its own (brief default). | The register holds the imported record; export parity is not asked for. |
| DM-2 | Re-deriving from the register never overwrites a manual or approved pin unless that machine's AP/AV source text changed since the pin was set (brief default). **Refinement:** a changed text that yields NO location (empty, unreadable, unresolved) never erases a pin. The pin stays, and only the stored source text is updated. | Erasing a human's correct pin because a cell was cleared would lose data that exists. |
| DM-3 | The map shows active machines (`isActive`, not deleted) by default (brief default). | — |
| DM-4 | A pin derived from a SHORT Plus Code is placed but flagged «يحتاج إلى مراجعة» until someone with `atmMachine.locate` approves or corrects it (brief default). | — |
| DM-5 | **Location lives in its own collection `atm_machine_locations`, one document per machine** — not on `atm_machines` (§3.3). | Master writes are versioned by `__v` (`machine.service.ts:70-81`; `shared/base/base.repository.ts:432-459`). A location write on the machine would make every Operations edit in flight fail with 409, and the first sync would bump 2,607 versions. The machine audit snapshot is shared with register coupling (`register-coupling.ts:60-67`; `machine.service.ts:63`). Location fields would leak into those diffs and into `AtmMachineDto` (`packages/contracts/src/modules/atm.ts:70-91`), which `atmMachine.view` holders read, while D-M5 gates locations by `atmMap.view`. A separate collection also gets its own indexes, audit entity and realtime topic. Archive and delete need no change: a location keyed by `machineId` survives archive and reactivation (D2 of the register spec), and the map reads only machines that are not deleted. |
| DM-6 | A zone is one document in `atm_map_zones`. Its polygon is an open ring of `{lat,lng}` objects with 3–500 points, rounded to 6 decimals, and the first point is not repeated at the end. | `{lat,lng}` is the repository's own point shape (`OperationsLocationSchema`, `packages/contracts/src/modules/operations.ts:171-180`), and 6 decimals is the precedent (`BranchMapPicker.tsx:26-33`). No geo query is needed, so there is no GeoJSON and no `2dsphere` index (a `2dsphere` index would also reject the self-intersecting drafts an editor passes through). |
| DM-7 | Optimistic concurrency of a branch's zone set uses one counter document per branch, `atm_map_zone_sets.revision`. Every save carries the revision the editor loaded. A mismatch returns **409 `ATM_MAP_ZONES_STALE`** and writes nothing. | Two editors have no presence or live notice (realtime does not reach branch-scoped users, §6.7), so this is the only guard (critic §S3). |
| DM-8 | Zone names are unique per branch, compared after trimming, collapsing spaces and case-folding. Uniqueness is enforced **in the service, under the revision check**, not by a unique index. | One save may swap two names (A→B, B→A). A unique index would refuse the intermediate state inside the transaction, and the revision CAS already serialises all writers of a set. |
| DM-9 | Zone membership is computed **in the browser** with the shared pure geometry (§8.5), over the points the caller can read. Only zones of the machine's own branch count, and the first zone in `order` wins (D-M7). | The server needs no membership in v1 (D-M8). Counts can never include another branch's machines, because the browser holds only points in reach. |
| DM-10 | Map read scope = the register's rule: finer scopes narrow to the branch (`registerScopeMatch`, `apps/api/src/modules/atm/register/register.repository.ts:21-25`). It does **not** use the machine repository's default, which widens department- and section-scoped grants to the whole company (`machines/machine.repository.ts:6-10` → `shared/base/base.repository.ts:143-157` → `shared/base/org-scope-match.ts:79-82, 111`). **`own` reads nothing** (`NEVER_MATCH`, `org-scope-match.ts:42-44`). | Map rows are machines, created by whoever ran the coupling. Under "own = createdBy", the map would show an arbitrary subset. Reading nothing is the fail-closed answer, and §10.2 tells administrators not to grant `own`. |
| DM-11 | A `branchId` query parameter outside the caller's reach answers **400** (`ValidationError`, detail `{ field: 'query.branchId', code: 'OUT_OF_REACH' }`). It is never silently widened, and it never returns an empty set either. | The parameter may only narrow. A 400 makes a stale or forged parameter visible to the developer, where an empty map would read as "no machines". (The register's `branch-options` answers 403 for the same situation, `register.service.ts:1171-1177`. Here 403 stays reserved for "you lack the key".) |
| DM-12 | A zone save is filed under `resolveAtmBranchId(ctx)` (`atm-context.ts:19-30`). The body also carries `branchId`, but only as a **consistency check**: if it differs from the resolved branch, the answer is 400 `BRANCH_MISMATCH`. | D-M6 says the branch comes from the top bar. The check stops a tab whose top-bar choice changed in another tab (`BranchSwitcher.tsx:76-85` reloads only that tab) from saving one branch's draft over another branch. |
| DM-13 | Location derivation runs only on the server, as pure functions (§4). It is stored, and it is re-run by an explicit, audited **sync** action (§6.5). It is **not** hooked into the register's write paths. | The register and coupling transactions (`register.service.ts:562, 786, 925`) stay untouched (D-M8, "no data is rewritten"). The summary reports how many machines are waiting for a sync (`pendingSync`). |
| DM-14 | The paste box sends the text to a server parse endpoint (§6.5), which is the single parser. The browser holds no copy of the parser. | "The server re-parses every pasted link" (critic §Security). This also avoids a second copy of the Plus Code decoder in the web bundle. |
| DM-15 | Batch actions (sync, link resolution) write **one audit row per call**, under two new verbs `atmMapLocationSync` and `atmMapLinkResolve`. Interactive pin writes audit **per machine**, with `entityId = machineId`. | This follows the register import's precedent (DEC-15, `packages/contracts/src/platform/audit.ts:153-165`; `register/import/apply-import.ts:471-480`). A first sync touches about 2,600 machines. |
| DM-16 | The status filter is the **machine's** state: «قيد التشغيل» (`isActive`, the default) or «مؤرشفة» (`!isActive`). The mockup's register statuses «بدون تاريخ بدء / تم التسليم» are replaced. | A pending register entry creates no machine (register spec DEC-12), so there is nothing to place. A machine is archived by a handover OR by an administrator (`machine.service.ts:253`), so «تم التسليم» would be wrong for some machines. «مؤرشفة» is an existing label (`i18n.ts:16480`). |
| DM-17 | The bank on the map is the **register's** `bankCode`, taken from the machine's open entry. That gives the 6 codes plus «بنك غير محدد» when there is none. | Colour-by-bank needs the code (`atm-register.ts:44-51`). The machine's `bankName` is free text (`atm.ts:78-79`). Archived machines have no open entry, so they show «بنك غير محدد». |
| DM-18 | Moving a located pin by more than **1 km** needs a reason, which the server enforces. The confirm dialog shows the distance and the zone change. | Critic §S4. A slip of the mouse at a low zoom level is the likely error. |
| DM-19 | Source labels: «من رابط الموقع» (URL, resolved short link), «من الإحداثيات في السجل» (plain coordinates, *new*), «من رمز Plus Code» (full code), «من رمز Plus Code مختصر» (short code, *new*) and «يدويًا» (any pin or paste set by a person). | The mockup's three labels plus the two kinds of source it did not draw. |
| DM-20 | The popup adds one row, «آخر تحديث للموقع: name · date», shown only for pins a person set (manual or approved). | The data is stored (`setByName/setAt`, §3.3), and reading the audit log once per popup would cost a query (critic §Audit). |
| DM-21 | Machine counts use the mockup's five grammatical forms: «لا ماكينات / ماكينة واحدة / ماكينتان / n ماكينات / n ماكينة». This replaces the `{{count}} ماكينة` precedent (`i18n.ts:16379`). | The approved mockup uses these forms (`Edit.dc.html` script). They are five plain keys, so no plural engine is needed (`translate`, `i18n.ts:16799-16810`). |
| DM-22 | A new zone's default name is «قطاع {{n}}», where n is one more than the number of zones in the draft. New zones are appended at the **bottom** of the list, which is the lowest priority under D-M7. | The mockup's letter names (أ…ل) were placeholder data (critic §Placeholder data) and stop at 12. Putting a new zone at the bottom never takes machines away from an existing zone silently. |
| DM-23 | «تغييرات غير محفوظة: n» counts the zones that were created, changed (geometry, name, colour or order) or deleted. Each zone is counted once. | That is the number of rows the save summary lists. |
| DM-24 | Edit mode shows only the edit branch's zones. Machine markers become small dots that cannot be clicked, so they never take a grab away from a handle. | Snapping onto a zone the user cannot edit must never change that zone (critic §Writes), and every zone that is displayed in edit mode is editable. |
| DM-25 | **Deferred with Split and Cut (v1.1):** «قص التداخل» (trim overlap), moving a whole zone, the colour-proximity warning, zone CSV export, dragging a row onto the map, and the touch toggle «إيقاف الالتصاق مؤقتًا». | None of them is in the approved mockups. Trim needs polygon clipping (no library is installed, research `ux.md` §7). D-M7 allows overlaps, and the overlap warning stays. |
| DM-26 | Clustering is a small in-house grid: 56 px cells below zoom 15, and machines at the same point (≤ 1 m apart) fan out ("spiderfy") on click. No `leaflet.markercluster`. | No cluster library is installed (`apps/web/package.json:14-51`), and the brief prefers small tested code to new dependencies. |
| DM-27 | Machine dots are drawn on a Leaflet **canvas** renderer. Review pins, cluster bubbles, zone labels and edit handles are DOM `divIcon`s whose elements are built with `document.createElement` + `textContent`, **never** an HTML string that contains user data. The popup is a React overlay, not `L.popup` HTML. | About 2,600 DOM markers would be slow. Machine and zone names are data that users typed, and BranchMapPicker's string `html` (`BranchMapPicker.tsx:35-39`) is safe only because it holds no data. |
| DM-28 | The tile layer uses BranchMapPicker's URL and attribution, plus `referrerPolicy: 'strict-origin-when-cross-origin'`. An Arabic scale bar is our own component. «شوارع باهتة» is a CSS filter on the tile pane. | Helmet sends `Referrer-Policy: no-referrer` by default (`node_modules/helmet/index.mjs:183`, not overridden at `app.ts:157-165`). Leaflet's tile `referrerPolicy` defaults to false (`leaflet-src.js:12101-12107, 12178-12179`), and OSM's policy expects a Referer (GM-2). Leaflet's own scale control is English only. |
| DM-29 | Leaving with unsaved changes is guarded three ways. A `beforeunload` prompt covers closing the tab. A confirm covers the page's own links. A draft is kept in `localStorage` and restored only when its base revision equals the server's revision. | `useBlocker` does not work under `<BrowserRouter>` (`apps/web/src/platform/app/App.tsx:103`, react-router 6.30.6). The sidebar cannot be intercepted, so the draft is what protects the work. |
| DM-30 | Layer toggles, colour-by and snap settings are remembered per viewer in `localStorage` (`ecms.atmMap.layers`, `ecms.atmMap.snap`), wrapped in try/catch. They are not URL filters. | These are view preferences, not filters (`useRememberedFilters.ts:8-14`), and the same try/catch precedent applies (`useRememberedFilters.ts:48-64`). |
| DM-31 | Toasts have no action button (`shared/ui/toast/toast-store.ts:50-55`), so «أُلغي الشكل.» is informational and cannot be undone. | That is the mockup's exact string, and the toast store is not extended. |
| DM-32 | The zone colour schema is local to the new contracts file and stores colours lowercase. `HEX_COLOR` in `hr-contract.ts:521` is left module-private. | This feature does not touch HR contracts. |
| DM-33 | The resolver's Google host policy is passed **per call** to `outboundFetch`. The hosts are not added to `NAMED_SAAS_HOSTS` (`infrastructure/http/outbound.ts:57-62`). | This is narrower: no other api caller can reach Google. |
| DM-34 | The reference point for a short Plus Code is the **median** of located pins in the same branch and same area, falling back to the same branch. It uses only pins that are not under review and that were not derived from a short code. A result more than 30 km from its reference gets the warning `farFromReference`. | Never another branch, never invented (brief). The median ignores outliers, and excluding short-code pins avoids chaining one recovery on another. |
| DM-35 | The Egypt bounding box used for the warning is lat 21.7–31.9 and lng 24.6–37.0. It warns and never blocks. | It covers the mainland, Sinai and Halaib with a margin. A pair of coordinates written in swapped order can still fall inside the box (GM-9). |
| DM-36 | The register text parser also reads Google's degrees-minutes-seconds copy format (`30°02'39.8"N 31°14'08.5"E`) and `plus.codes/<code>` links. It reads coordinates from Google Maps hosts and plus.codes only, and it never picks stray digits out of other URLs. | These are Google's own copy formats for a point. Not picking digits out of other URLs is the precedent (`operations/lib/maps-link.spec.ts` "does not mine a non-Maps URL"). |
| DM-37 | Up to **200 zones** per branch. | With 500 points per zone, the 1 MB JSON limit (`app.ts:167`) remains the real outer bound. 200 zones make the limit explicit and testable. |
| DM-38 | The unlocated screen carries a **sync card** («مزامنة المواقع من سجل الماكينات») above the link card. | The mockup assumes the pins already exist. Something has to create them, and D-M5 names the sync as an `atmMachine.locate` action. |
| DM-39 | «تم تحديد موقع n من m» counts the whole reach: m is the active machines in reach and n is the located pins that are not under review. | The figure stays the same whatever filter the user has set. |
| DM-40 | Below 1024 px the panel moves into a `SideLayer`, on the right in Arabic and the left in English. Editing is offered from 768 px, and below that the page is view only. | `SideLayer.tsx:9-10, 23, 35`. This follows critic §Frame. |
| DM-41 | Keyboard: arrow keys nudge a selected vertex by 1 px, or 10 px with Shift. | Without it, keyboard users cannot edit a zone at all (§8.11). |
| DM-42 | `atmMachine.locate` is declared in its **own** `declarePermissions('atm', 'atmMachine', …, [], [locate], 'atm.map')` call. It therefore sits on the map page, while `atmMachine.view/manage/moveArea` stay on `atm.machines`. | Per-key page placement is how a resource split across two pages is declared (`packages/contracts/src/permissions/def.ts:94-99`). |
| DM-43 | The mockup's snap help text keeps «… فلا تظهر فجوة بينهما …» verbatim, and `'بينهما'` is added to `FORMAL` in `scripts/check-formal-arabic.mjs` (`:60-68`), next to `'بينهم'`. | «بينهما» ("between the two") is formal Arabic that the `بي…` verb-prefix pattern (`:53-57`) catches by accident. The guard's own rule is to list such words one at a time rather than weaken the pattern (`:34-36`). Running the guard's `offendersIn` over every Arabic string in this spec flags only this word. |

---

## 3. Data model (WP-M1)

All three models use `baseFields` + `baseSchemaOptions` (`apps/api/src/shared/base/base.model.ts:17-29`):
`schemaVersion`, `isDeleted`, `deletedAt`, `deletedBy`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`
and `__v`. Collections carry the `atm_` prefix and route prefixes sit under `/atm`, both required by the
manifest validator (`platform/kernel/module-registry.ts:140-149`).

### 3.1 `atm_map_zones` — `apps/api/src/modules/atm/map/zone.model.ts` (NEW)

```ts
export interface AtmMapLatLng { lat: number; lng: number }
export interface AtmMapZoneDoc extends BaseDocFields {
  branchId: Types.ObjectId;   // immutable; the branch the zone belongs to (D-M6)
  name: string;               // 1..60 after trim
  color: string;              // '#rrggbb' lowercase
  order: number;              // 0..n-1 within the branch; lower = higher priority (D-M7)
  points: AtmMapLatLng[];     // open ring, 3..500, 6 decimals (DM-6)
}
const pointSchema = new Schema<AtmMapLatLng>(
  { lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 } },
  { _id: false },
);
const zoneSchema = new Schema<AtmMapZoneDoc>({
  branchId: { type: Schema.Types.ObjectId, required: true },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
  color: { type: String, required: true, match: /^#[0-9a-f]{6}$/ },
  order: { type: Number, required: true, min: 0 },
  points: { type: [pointSchema], required: true,
            validate: { validator: (v: unknown[]) => v.length >= 3 && v.length <= 500 } },
  ...baseFields,
}, baseSchemaOptions);
zoneSchema.index({ branchId: 1, order: 1 },
  { name: 'ix_branch_order', partialFilterExpression: { isDeleted: false } });
export const AtmMapZoneModel = model<AtmMapZoneDoc>('AtmMapZone', zoneSchema, 'atm_map_zones');
```

Deleting a zone is a **soft delete** (`isDeleted/deletedAt/deletedBy`), the base repository's write
shape (`base.repository.ts:461-482`). Name uniqueness has no index (DM-8).

### 3.2 `atm_map_zone_sets` — `apps/api/src/modules/atm/map/zone-set.model.ts` (NEW)

```ts
export interface AtmMapZoneSetDoc extends BaseDocFields {
  branchId: Types.ObjectId;   // one document per branch
  revision: number;           // ≥ 1 once the branch's first save happened; absent doc ≡ revision 0
}
schema: branchId { ObjectId, required }, revision { Number, required, min: 0, default: 0 }, ...baseFields
index({ branchId: 1 }, { unique: true, name: 'ux_branch' })
model 'AtmMapZoneSet' → collection 'atm_map_zone_sets'
```

### 3.3 `atm_machine_locations` — `apps/api/src/modules/atm/map/machine-location.model.ts` (NEW)

```ts
export const ATM_MAP_LOCATION_SOURCES = ['registerUrl', 'registerCoordinates', 'registerPlusCode',
  'registerShortCode', 'registerShortLink', 'manual'] as const;            // contracts §6.1
export const ATM_MAP_UNLOCATED_REASONS = ['shortLink', 'shortLinkFailed', 'noCoordinates',
  'shortPlusCodeNoReference', 'invalidCoordinates', 'unreadable', 'none', 'noEntry',
  'conflictingEntries'] as const;   // 'notSynced' exists only in DTOs (no document yet)
export const ATM_MAP_LOCATION_WARNINGS = ['outsideEgypt', 'farFromReference'] as const;
export const ATM_MAP_LINK_FAILURES = ['timeout', 'httpStatus', 'tooManyRedirects', 'hostNotAllowed',
  'network', 'invalidUrl', 'noCoordinates'] as const;

export interface AtmMachineLocationDoc extends BaseDocFields {
  machineId: Types.ObjectId;                 // one live document per machine
  branchId: Types.ObjectId;                  // copied from the machine; a machine's branch never changes
                                             // (UpdateAtmMachineSchema has no branchId, atm.ts:155-163)
  status: 'located' | 'unlocated';
  lat: number | null;                        // 6 decimals; null when unlocated
  lng: number | null;
  source: AtmMapLocationSource | null;       // null when unlocated
  needsReview: boolean;                      // true only for an unapproved registerShortCode pin (DM-4)
  reason: AtmMapUnlocatedReason | null;      // null when located
  warnings: AtmMapLocationWarning[];
  pinned: boolean;                           // manual or approved → protected by DM-2
  sourceEntryId: Types.ObjectId | null;      // the open register entry the text came from
  sourceText: { plusCode: string | null; url: string | null };  // AP/AV as read (or at pin time)
  sourceField: 'locationUrl' | 'locationPlusCode' | null;       // which column produced the point
  reference: { lat: number; lng: number; basis: 'area' | 'branch'; machines: number } | null;
  shortLink: {
    url: string;
    status: 'pending' | 'resolved' | 'failed';
    lat: number | null; lng: number | null;
    failure: AtmMapLinkFailure | null;
    attempts: number;
    lastAttemptAt: Date | null;
    claimedAt: Date | null;                  // §5.4 — a run's atomic claim
  } | null;
  manualText: string | null;                 // the pasted text of a `mode: 'text'` placement (≤ 2048)
  moveReason: string | null;                 // the last move reason (≤ 300)
  setBy: Types.ObjectId | null;              // who last changed the point (a person, or the sync's actor)
  setByName: string | null;                  // `actorName(ctx)` snapshot (atm-context.ts:32-34)
  setAt: Date | null;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  derivedAt: Date | null;                    // last time a sync evaluated this machine
}
```

Indexes:

```ts
locationSchema.index({ machineId: 1 }, { unique: true, name: 'ux_machine',
  partialFilterExpression: { isDeleted: false } });
locationSchema.index({ branchId: 1, status: 1, needsReview: 1 }, { name: 'ix_branch_status' });
locationSchema.index({ branchId: 1, 'shortLink.status': 1 }, { name: 'ix_branch_link' });
model 'AtmMachineLocation' → collection 'atm_machine_locations'
```

`sourceText` and `shortLink.url` are copies of P-class register text (`atm-register.ts:383, 505, 511`).
They contain no K or S value. A DTO returns them only where the caller can read the source register
entry (§6.5).

Machine lifecycle:
- **Archive** (`isActive:false`): the location document is kept, and the map hides the machine unless
  `status=archived|all` is asked.
- **Reactivation** (the register re-receipt reactivates the same master row): the old document comes
  back, and the next sync applies DM-2.
- **Delete** (soft, code renamed `-D`, `machine.service.ts:305-341`): the location document is left
  in place. The points, the summary and the sync all read only machines that are not deleted, so it
  is never shown.

### 3.4 Index registration (both mechanisms)

- **Deploy step.** `db:sync-indexes` (`apps/api/package.json:16`) runs as Railway's pre-deploy command
  (`railway.json:8`) in `report` or `apply` mode (`INDEX_SYNC_MODE`, `infrastructure/config/env.ts:199`).
  It loads every model reachable from `./app` and `./modules` (`apps/api/src/sync-indexes.models.ts:10-11`).
  The new models are reached through `atm.module.ts` → `map.routes.ts` → the services, so they need no
  explicit import. `sync-indexes.models.spec.ts` fails if any model file is missed.
- **Boot step.** `seedAtm` calls `migrateAtmIndexes()` (`atm.seed.ts:27`) over an **explicit list**
  (`atm-indexes.ts:44-58`). Add `AtmMapZoneModel`, `AtmMapZoneSetModel` and `AtmMachineLocationModel` to
  the first group (`rowsInLog: true`: their keys are ids, never K/S values). This also creates each
  collection BEFORE its first insert, which otherwise happens inside a transaction (`atm-indexes.ts:8-9`).
  The assertion in `shared/open-operation.spec.ts:113-128` stays green, because the new entries are
  `rowsInLog: true`.

---

## 4. Location derivation (WP-M1) — pure functions under `apps/api/src/modules/atm/map/location/`

Nothing parses AP/AV today (research `ecms-data.md` §2). The web's `parseMapsLink` is web-side only and
refuses short links (`apps/web/src/modules/operations/lib/maps-link.ts:24-37, 92-118`). The API gets its
own parsers, modelled on that file's order of preference. Research counts for the workbook's 2,607 open
rows (counts only): 877 coordinates inside the link or cell; 18 full Plus Codes; 163 short Plus Codes
(82 followed by a place name); 713 `maps.app.goo.gl` short links only; 26 other links without
coordinates; 5 unreadable texts; 805 with nothing. The import reads cell TEXT and ignores hyperlink
targets (`register/import/read-register-workbook.ts:410`, GM-5).

### 4.1 `plus-code.ts` — our own Open Location Code (OLC) implementation

- Alphabet `23456789CFGHJMPQRVWX` (20), separator `+` at index 8, padding `0`.
- **Integer arithmetic** throughout, to avoid floating-point drift: `latInt = floor((lat + 90) × 25_000_000)`,
  `lngInt = floor((lng + 180) × 8_192_000)` (pair precision 8000 × grid 5⁵ / 4⁵). Clip the latitude to
  [-90, 90) and normalise the longitude to [-180, 180).
- `isValidCode(code)`: one `+`, at an even index ≤ 8. Only alphabet characters, `0` and `+`. Padding
  `0`s are allowed only before `+`, must start at an even index and be contiguous, and nothing may
  follow `+` when the code is padded. Exactly one character after `+` is invalid. Case-insensitive.
- `isFull(code)`: valid, `+` at index 8, first character's value ≤ 8 (latitude < 180°) and second
  character's value ≤ 17 (longitude < 360°). `isShort(code)`: valid, `+` index < 8.
- `encode(lat, lng, length = 10)`: five digit pairs at resolutions 20°, 1°, 0.05°, 0.0025° and
  0.000125°. Each further grid digit splits the cell into 5 rows × 4 columns (`digit = row × 4 + col`).
- `decode(code) → { south, west, north, east, lat, lng }`, where (lat, lng) is the cell centre.
- `recoverNearest(shortCode, refLat, refLng)`: `pad = 8 − indexOf('+')`, `resolution = 20^(2 − pad/2)`,
  `half = resolution / 2`. Decode `encode(ref)[0:pad] + shortCode`. If `ref.lat + half < centre.lat`
  and `centre.lat − resolution ≥ −90`, subtract `resolution`; else if `ref.lat − half > centre.lat` and
  `centre.lat + resolution ≤ 90`, add it. Apply the same rule to the longitude, without the bounds
  check. Return the re-encoded code and its centre. A 4-character short code (`pad = 4`) therefore
  recovers correctly only when the reference lies within ±0.5° of the true point (GM-9).

**Test vectors** (derived by hand from the algorithm above, then cross-checked by a separate
exact-fraction script):

| Input | Expected |
|---|---|
| `decode('7FG49QCJ+2V')` | south-west (20.37, 2.782125), north-east (20.370125, 2.78225), centre (20.3700625, 2.7821875) |
| `decode('7FG49Q00+')` | south-west (20.35, 2.75), north-east (20.4, 2.8), centre (20.375, 2.775) |
| `decode('8FVC9G8F+6X')` | centre (47.3655625, 8.5249375) |
| `decode('8FVC9G8F+6XQ')` (11 digits, grid) | south-west (47.365575, 8.52496875), north-east (47.3656, 8.525) |
| `encode(30.0444, 31.2357)` | `8G2H26VP+Q7` → centre (30.0444375, 31.2356875) |
| `encode(31.2001, 29.9187)` / `(27.1809, 31.1837)` / `(31.2653, 32.3019)` | `8G3F6W29+2F` / `7GVH55JM+9F` / `8G3J7882+4Q` |
| `recoverNearest('26VP+Q7', 30.05, 31.20)` | `8G2H26VP+Q7` |
| `recoverNearest('26VP+Q7', 30.6, 31.2357)` | `8G3H26VP+Q7` (centre 31.0444…: the reference lies more than 0.5° from the true point) |
| `recoverNearest('26VP+Q7', 29.5444, 31.2357)` | `7GXH26VP+Q7` (on the 0.5° boundary) |
| invalid | `8G2H26VP+Q` (one char after `+`), `8G2H26V+PQ7` (odd `+` index), `8G2H26VP+Q7A!`, `8G0H26VP+Q7`, `8G2H2600+Q7`, `WG2H26VP+Q7` (first char value 18 > 8) |

Hand derivation of `8G2H26VP+Q7`: lat + 90 = 120.0444 and lng + 180 = 211.2357. Pair 1 (÷20) gives
6 → `8` and 10 → `G`, leaving 0.0444 / 11.2357. Pair 2 (÷1) gives 0 → `2` and 11 → `H`, leaving
0.0444 / 0.2357. Pair 3 (÷0.05) gives 0 → `2` and 4 → `6`, leaving 0.0444 / 0.0357. Pair 4 (÷0.0025)
gives 17 → `V` and 14 → `P`, leaving 0.0019 / 0.0007. Pair 5 (÷0.000125) gives 15 → `Q` and 5 → `7`.

### 4.2 `maps-text.ts` — reading one register cell

`readLocationText(raw: string): LocationCandidate[]` returns every candidate found in one cell, in the
order they occur. The cell is trimmed, and an empty cell returns `[]`.

1. **URLs.** Match `https?:\/\/[^\s]+`. A text that starts with `maps.app.goo.gl/`, `goo.gl/`,
   `maps.google.com/`, `www.google.com/` or `google.com/` gets `https://` prefixed. Each URL is parsed
   with `new URL()`; a parse failure gives `{ kind: 'unreadable' }`.
   - Host `maps.app.goo.gl`, or `goo.gl` with a path starting `/maps` → `{ kind: 'shortLink', url }`
     (the URL as written, trimmed).
   - Host matching `^(www\.|maps\.)?google\.(com|com\.eg)$` and path starting `/maps`, or host
     `maps.google.com` with any path → `coordinatesFromGoogleUrl(url)`, in this order (the place before
     the map centre, `maps-link.ts:46-56`):
     1. `!3d<lat>!4d<lng>` anywhere in `href`;
     2. query parameters `q`, `query`, `ll`, `destination`, `center`, `sll`, `daddr` (strip a `loc:`
        prefix, `maps-link.ts:58-86`);
     3. `/maps/search/<lat>,<lng>` and `/maps/place/<lat>,<lng>` path segments, URL-decoded (`+` and
        `%20` become spaces);
     4. a DMS pair in a decoded `/place/` segment (DM-36);
     5. `/@<lat>,<lng>` (map centre, the fallback).
     Found → `{ kind: 'coordinates', lat, lng, via: 'url' }`. Otherwise, if the decoded path or `q`
     holds a Plus Code (§4.1 pattern), → `{ kind: 'plusCode', code }`; otherwise → `{ kind: 'noCoordinates' }`.
   - Host `plus.codes` → the first path segment as a Plus Code, or `unreadable`.
   - Any other host → `{ kind: 'noCoordinates' }`. Digits are never picked out of other URLs.
2. **Non-URL text** (the remainder once URLs are removed, trimmed):
   - A whole-field decimal pair `^-?\d{1,2}(\.\d+)?\s*[,،]\s*-?\d{1,3}(\.\d+)?$` →
     `{ kind: 'coordinates', via: 'text' }`. The Arabic comma is accepted. This applies only when the
     field is nothing but the pair (`maps-link.ts:106-113`).
   - A DMS pair such as `30°02'39.8"N 31°14'08.5"E` (`′″` accepted, N/S/E/W required) → coordinates
     (DM-36).
   - A Plus Code token `(?<![0-9A-Z])([2-9CFGHJMPQRVWX]{2,8}0*\+[2-9CFGHJMPQRVWX]{0,7})(?![0-9A-Z])`
     (case-insensitive). If `isFull`, → `{ kind: 'plusCode', code }`; if `isShort`, → `{ kind:
     'shortPlusCode', code }`. Any trailing place name («… القاهرة») is ignored (GM-7).
   - Anything else → `{ kind: 'unreadable' }`.
3. **Range check.** Coordinates with lat ∉ [−90, 90] or lng ∉ [−180, 180] become
   `{ kind: 'invalidCoordinates' }`. All values are rounded to 6 decimals.

`insideEgypt({lat,lng})` checks the box in DM-35. `haversineMeters(a, b)` uses R = 6,371,008.8 m.

### 4.3 `derive.ts` — choosing a machine's location

```ts
deriveLocation(input: {
  texts: { url: string | null; plusCode: string | null } | null;   // null = no usable open entry
  entryProblem: 'noEntry' | 'conflictingEntries' | null;
  resolvedLink: { url: string; status: 'resolved' | 'failed'; lat?: number; lng?: number;
                  failure?: AtmMapLinkFailure } | null;              // from the doc's shortLink
  reference: (/* for this machine */) => ReferencePoint | null;
}): Derived   // { status, lat, lng, source, needsReview, reason, warnings, sourceField,
              //   shortLinkUrl, reference }
```

**Which register entry is the source.** The machine's open entries are those with
`AtmRegisterEntryModel.find({ machineId, isDeleted: false, status: 'open' })`, using index
`ix_machine_status` (`register.model.ts:227`):
- **none** → `entryProblem: 'noEntry'`. This covers an active master with no open entry (the import's
  "active-master-without-open-entry" category, or a machine created by Operations).
- **one** → that entry's `locationUrl` / `locationPlusCode`.
- **several.** Only an exempt duplicate pair can produce this (`openPeriodExempt`, `register.model.ts:81,
  206-218`; EG-8). If the non-empty texts are all equal, use them, with `sourceEntryId` set to the entry
  with the latest `startDate`, then the largest `_id`. If they differ → `entryProblem:
  'conflictingEntries'`.

**Candidate ranking.** Candidates from AV (`locationUrl`) come before those from AP
(`locationPlusCode`); within a field they keep their order. The best rank wins, and on equal rank AV
wins:

| Rank | Candidate | Result |
|---|---|---|
| 1 | `coordinates` (url or text) | located, `registerUrl` or `registerCoordinates` |
| 2 | `plusCode` (full) | located, `registerPlusCode` (cell centre) |
| 3 | `shortLink` with a stored `resolved` result for the same URL | located, `registerShortLink` |
| 4 | `shortPlusCode` and a reference exists | located, `registerShortCode`, `needsReview: true`, `reference` stored |
| 5 | `shortLink` not yet resolved | unlocated, `shortLink` (queued, `shortLink.status: 'pending'`) |
| 6 | `shortLink` with a stored `failed` result | unlocated, `shortLinkFailed` |
| 7 | `noCoordinates` | unlocated, `noCoordinates` |
| 8 | `shortPlusCode` without a reference | unlocated, `shortPlusCodeNoReference` |
| 9 | `invalidCoordinates` | unlocated, `invalidCoordinates` |
| 10 | `unreadable` | unlocated, `unreadable` |
| — | no candidate (both cells empty) | unlocated, `none` |
| — | `entryProblem` | unlocated, `noEntry` / `conflictingEntries` |

When the winning candidate is not a short link but a short link also exists (for example rank 4 with
rank 5), `shortLinkUrl` is still returned. The resolver then queues it, because a resolved link (rank 3)
outranks a short code.

**Warnings.** `outsideEgypt` is added when a located point is outside DM-35's box. `farFromReference`
is added when a rank-4 point lies more than 30 km from its reference.

**Reference point (DM-34).** `referenceFor(branchId, area)` reads the located documents of the same
branch where `status: 'located'`, `needsReview: false` and `source ≠ 'registerShortCode'`, joined to
their machine's `area`. If at least one pin has the same area (trimmed, case-folded) → `basis: 'area'`
and the median lat and median lng of those pins. Else, if at least one exists in the branch → `basis:
'branch'`. Else `null`. Another branch is never used, and no coordinate is invented (brief).

**Re-derive precedence** (`applyDerivation(existing, derived, currentTexts)`, pure):

| Existing document | Current text vs `existing.sourceText` | New derivation | Outcome |
|---|---|---|---|
| none | — | any | write the derivation (`pinned: false`) |
| `pinned: false` | any | any | replace with the derivation when any stored field differs, otherwise keep |
| `pinned: true` | equal | any | **keep** (DM-2) |
| `pinned: true` | changed | located (any rank 1–4) | replace (`pinned: false`; a rank-4 result is `needsReview` again) |
| `pinned: true` | changed | unlocated | **keep the pin**, update `sourceText`/`sourceEntryId` only (DM-2 refinement) |

The text comparison is exact equality of the `{ url, plusCode }` pair, with `null` and `''` treated as
equal. Placing or approving a pin stores the open entry's current texts as `sourceText` (§6.5). The
pin is therefore protected "since the pin was set".

---

## 5. Short-link resolver (D-M4) — `apps/api/src/modules/atm/map/location/short-link-resolver.ts`

### 5.1 Rules

- **Server only, admin-triggered** through `POST /atm/map/locations/resolve-links` (`atmMachine.locate`,
  §6.5). Never on a read, never on a schedule.
- **Batch:** up to `ATM_MAP_LINK_BATCH_MAX = 20` links per call, **sequentially**, with a 300 ms pause
  between links. The run stops starting new links after a **40 s** budget, so that the HTTP request
  finishes. The browser calls again while `remaining > 0` (§8.10).
- **First URL.** It must parse, be `https:` (`http:` is upgraded to `https:` for the same host and path),
  have no userinfo and no explicit port, and its host must be exactly `maps.app.goo.gl` or `goo.gl` (with
  a path starting `/maps`). Anything else is never requested: `failure: 'invalidUrl'` or
  `'hostNotAllowed'`.
- **Host allowlist for every hop:** exactly `maps.app.goo.gl`, `goo.gl`, `www.google.com`, `google.com`
  and `maps.google.com`, compared case-insensitively after removing a trailing dot. No wildcard, no
  other Google domain.
- **Manual redirects, hop limit 5.** Each hop calls `outboundFetch(url, init, { policy:
  GOOGLE_MAPS_LINK_POLICY, maxRedirects: 0 })` (`infrastructure/http/outbound.ts:292-297, 323-347`).
  `outboundFetch` returns the 3xx response unchanged when `maxRedirects` is 0 (`:336`), and its policy
  check refuses private addresses and credentials in the URL (`outboundRefusal`, `:239-270`).
  `GOOGLE_MAPS_LINK_POLICY = { allowHosts: [the five hosts], pinnedHosts: [], allowPrivate: false }`
  (DM-33; `OUTBOUND_HTTP_ALLOW_PRIVATE` does not apply).
- **Request:** `GET`, headers `{ accept: 'text/html' }` only, `cache: 'no-store'`, `redirect: 'manual'`
  (set by `outboundFetch`), `signal: AbortSignal.timeout(5000)` **per hop** (Node 22, `package.json:8`).
  No cookies (Node's fetch has no cookie jar), no `Authorization`, no `Referer`.
- **The response body is never read or stored.** Every response body is cancelled with
  `response.body?.cancel()` before the next step.
- **Only URLs are parsed.** At each 3xx, resolve `Location` against the current URL, then:
  1. if `coordinatesFromGoogleUrl(location)` finds a point → **resolved** (no further request);
  2. else if the Location host is allowlisted and `https:` → that URL is the next hop;
  3. else if the host is `consent.google.com` and its `continue` parameter is an allowlisted `https:`
     URL → parse **that string only** (it is never fetched). A point → resolved; otherwise `failed /
     hostNotAllowed`;
  4. else → `failed / hostNotAllowed`.

  A 200 response parses the final URL: a point → resolved, otherwise `failed / noCoordinates` (a named
  place). Any other status → `failed / httpStatus`. More than 5 hops → `failed / tooManyRedirects`. An
  `AbortError` → `failed / timeout`. `OutboundBlockedError` → `failed / hostNotAllowed`. Any other error →
  `failed / network`.
- **Stored:** the location document's `shortLink` gets `{ status, lat, lng, failure, attempts + 1,
  lastAttemptAt }`. The final URL is not stored. Then the machine is re-derived (§4.3 precedence), so
  a resolved link becomes `registerShortLink` unless a pin is protected.
- **Logging:** host, status code and outcome only, never a full URL or query string. `outboundFetch`
  already logs refusals as origin + path (`outbound.ts:306-317`).

### 5.2 SSRF considerations

- The input is user-typed register text. The URL parser decides the host, so a URL such as
  `https://maps.app.goo.gl@evil.example/` has hostname `evil.example` and is refused before any request.
- IP-literal hosts are refused, because they are not on the allowlist. Every hop is judged again. A
  listed host that redirects to `169.254.169.254` or to an internal name is refused by the allowlist,
  and an allowlisted name that resolves to a private address is refused by `outboundRefusal`.
- The bound on work is: no body is read, header size is the Node default, at most 5 hops per link,
  5 s per hop, 20 links per call, a 40 s budget, and the endpoint is gated by `atmMachine.locate`
  and audited.
- **Residual risk (accepted, the same as the platform door):** DNS can rebind between the policy check
  and the connection.

### 5.3 Testability

`resolveShortLink(url, deps)` takes `deps: { hop(url: URL, signal: AbortSignal): Promise<{ status:
number; location: string | null; cancel(): Promise<void> }>; sleep(ms): Promise<void>; now(): number }`.
The default `hop` wraps `outboundFetch` as above. The service exposes `setShortLinkHopForTests(fn | null)`,
following `setOutboundPolicyForTests` (`outbound.ts:97-99`), so that integration tests never touch the
network. `outbound-only-fetch.spec.ts` stays green, because no file other than `outbound.ts` calls
`fetch` (`infrastructure/http/outbound-only-fetch.spec.ts:1-4`).

### 5.4 Concurrency

Each link is **claimed** atomically before it is fetched:
`findOneAndUpdate({ _id, 'shortLink.status': 'pending', $or: [{ 'shortLink.claimedAt': null },
{ 'shortLink.claimedAt': { $lt: now − 60 s } }] }, { $set: { 'shortLink.claimedAt': now } })`. Two
administrators who press «بدء التحويل» at the same time therefore never fetch the same link twice.
`retryFailed: true` makes `failed` links whose `attempts < 3` eligible again; their status is set back
to `pending` at claim time.

**Production egress to Google is unverified: GAP GM-1.**

---

## 6. API (WP-M1)

### 6.1 Contracts — `packages/contracts/src/modules/atm-map.ts` (NEW) and `atm-map-geometry.ts` (NEW)

Both are exported from `packages/contracts/src/index.ts` after `atm-register.js` (`index.ts:67-68`).

`atm-map-geometry.ts` holds pure functions, shared by the API (validation) and the web (editor):
- `pointInPolygon(p, ring)`: ray casting in the lat/lng plane; a point on the boundary counts as inside.
- `segmentsIntersect(a, b, c, d)`: true for a proper crossing, and for a collinear overlap of positive
  length.
- `selfIntersects(ring)`: tests every pair of edges that are not adjacent; the first and last edges
  count as adjacent.
- `polygonsOverlap(a, b)`: true for a proper edge crossing, or for a vertex of one ring inside the other
  by more than ε = 1e-7° from its boundary. Shared edges and shared vertices are not an overlap.
- `polygonAreaM2(ring)`: equirectangular projection about the mean latitude, R = 6,371,008.8 m, shoelace
  formula.
- `zoneGeometryIssues(points) → ('TOO_FEW_POINTS' | 'TOO_MANY_POINTS' | 'DUPLICATE_POINT' |
  'SELF_INTERSECTION' | 'TOO_SMALL')[]`. Duplicates are consecutive points that are equal after
  6-decimal rounding, including last→first. The minimum area is `ATM_MAP_ZONE_MIN_AREA_M2 = 100`.

`atm-map.ts` holds the constants, schemas and DTOs:

```ts
export const ATM_MAP_ZONE_MIN_POINTS = 3, ATM_MAP_ZONE_MAX_POINTS = 500, ATM_MAP_ZONES_PER_BRANCH_MAX = 200,
  ATM_MAP_ZONE_NAME_MAX = 60, ATM_MAP_MOVE_REASON_METERS = 1000, ATM_MAP_LINK_BATCH_MAX = 20,
  ATM_MAP_SYNC_MAX_MACHINES = 5000;
export const EGYPT_BOUNDS = { south: 21.7, north: 31.9, west: 24.6, east: 37.0 } as const;
export const ATM_MAP_ZONE_PALETTE = [            // the mockup's 12, in its order (research ux.md §4)
  { key: 'indigo', hex: '#483bba', cased: false }, { key: 'mustard', hex: '#d3a813', cased: true },
  { key: 'raspberry', hex: '#a4546f', cased: false }, { key: 'mint', hex: '#5bc4a3', cased: true },
  { key: 'plum', hex: '#8a1586', cased: false }, { key: 'sky', hex: '#4ba3f7', cased: true },
  { key: 'olive', hex: '#406113', cased: false }, { key: 'coral', hex: '#ed7665', cased: true },
  { key: 'petrol', hex: '#007ca5', cased: false }, { key: 'orchid', hex: '#d179ca', cased: true },
  { key: 'ochre', hex: '#a27825', cased: false }, { key: 'violet', hex: '#8264e7', cased: false },
] as const;                                       // `cased`: under 3:1 on the map → dark casing
export const ATM_MAP_STATUS_FILTERS = ['active', 'archived', 'all'] as const;
// + ATM_MAP_LOCATION_SOURCES, ATM_MAP_UNLOCATED_REASONS (+ 'notSynced' for DTOs),
//   ATM_MAP_LOCATION_WARNINGS, ATM_MAP_LINK_FAILURES (§3.3)

const LatLngSchema = z.object({ lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180) }).strict()
  .transform((p) => ({ lat: round6(p.lat), lng: round6(p.lng) }));
const ZoneNameSchema = z.string().trim().min(1).max(ATM_MAP_ZONE_NAME_MAX);
const ZoneColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((c) => c.toLowerCase());
const ZonePointsSchema = z.array(LatLngSchema).min(3).max(500);

export const AtmMapPointsQuerySchema = z.object({ branchId: objectId().optional(),
  status: z.enum(ATM_MAP_STATUS_FILTERS).default('active') }).strict();
export const AtmMapZonesQuerySchema = z.object({ branchId: objectId().optional() }).strict();
export const AtmMapLocationSummaryQuerySchema = AtmMapZonesQuerySchema;
export const SaveAtmMapZoneSetSchema = z.object({
  branchId: objectId(),                          // consistency check only (DM-12)
  revision: z.number().int().min(0),
  creates: z.array(z.object({ tempId: z.string().regex(/^new-[a-z0-9]{1,24}$/),
    name: ZoneNameSchema, color: ZoneColorSchema, points: ZonePointsSchema }).strict()).max(200),
  updates: z.array(z.object({ id: objectId(), name: ZoneNameSchema.optional(),
    color: ZoneColorSchema.optional(), points: ZonePointsSchema.optional() }).strict()).max(200),
  deletes: z.array(objectId()).max(200),
  order: z.array(z.string().min(1)).max(200),     // ids + tempIds, final order, top = first
}).strict().superRefine(/* unique tempIds; no id both updated and deleted; no duplicate in order,
                          deletes or updates; each update names ≥ 1 field */);
export const ParseAtmMapLocationSchema = z.object({ machineId: objectId(),
  text: z.string().trim().min(1).max(2048) }).strict();
const MoveReason = z.string().trim().min(1).max(300).optional();
export const PlaceAtmMachineLocationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('pin'), lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180), version: z.number().int().min(0).nullable(),
    reason: MoveReason }).strict(),
  z.object({ mode: z.literal('text'), text: z.string().trim().min(1).max(2048),
    version: z.number().int().min(0).nullable(), reason: MoveReason }).strict(),
]);
export const ApproveAtmMachineLocationSchema = z.object({ version: z.number().int().min(0) }).strict();
export const SyncAtmMapLocationsSchema = z.object({ branchId: objectId().optional() }).strict();
export const ResolveAtmMapLinksSchema = z.object({ branchId: objectId().optional(),
  retryFailed: z.boolean().default(false) }).strict();
```

DTOs (all fields JSON-safe):

```ts
AtmMapContextDto { branches: { id; name: LocalizedString; canManageZones; canLocate }[];
  organizationWide: boolean;            // atmMap.view is organization → «كل الفروع» offered
  editBranchId: string | null }         // where a save would be filed and atmZone.manage reaches it
AtmMapPointDto { machineId; code; name; branchId; area; bankName; bankCode: AtmBankCode | null;
  active: boolean; lat: number | null; lng: number | null;
  state: 'located' | 'review' | 'unlocated'; source: AtmMapLocationSource | null;
  reason: AtmMapUnlocatedReasonDto | null; warnings: AtmMapLocationWarning[];
  setByName: string | null; setAt: string | null }    // the last two only when source === 'manual'
                                                      // or the pin was approved (DM-20)
AtmMapPointsDto { points: AtmMapPointDto[]; generatedAt: string }
AtmMapZoneDto { id; branchId; name; color; order; points: { lat; lng }[]; updatedAt: string }
AtmMapZoneSetDto { branchId; revision: number; zones: AtmMapZoneDto[] }
AtmMapZonesDto { sets: AtmMapZoneSetDto[] }
AtmMachineLocationDetailDto { machineId; version: number | null; state; lat; lng; source; reason;
  warnings; needsReview; pinned; reference; shortLink: { status; failure; attempts } | null;
  sourceVisible: boolean; sourceText: { plusCode; url } | null; manualText: string | null;
  moveReason; setByName; setAt; reviewedByName: string | null; reviewedAt; derivedAt }
AtmMapParseResultDto = { ok: true; lat; lng; kind: 'url' | 'coordinates' | 'plusCode' |
  'shortPlusCode'; needsReview: boolean; warnings: AtmMapLocationWarning[] }
  | { ok: false; reason: 'shortLink' | 'noCoordinates' | 'invalidCoordinates' | 'unreadable' |
      'shortPlusCodeNoReference' }
AtmMapLocationSummaryDto { totalActive; located; review; unlocated;
  byReason: Record<AtmMapUnlocatedReasonDto, number>; pendingSync; shortLinksPending;
  shortLinksFailed; lastSyncAt: string | null }
AtmMapSyncResultDto { processed; changed; located; review; unlocated; kept; skippedArchived }
AtmMapLinkResolveResultDto { attempted; resolved; failed; remaining; stoppedByBudget: boolean }
```

(`AtmMapUnlocatedReasonDto` = `ATM_MAP_UNLOCATED_REASONS` + `'notSynced'`.)

**Error codes** (`packages/contracts/src/errors/index.ts`, after the register block `:123-148`):
`ATM_MAP_ZONES_STALE` (409, DM-7) and `ATM_MAP_NOT_UNDER_REVIEW` (422, used with `BusinessRuleError`,
`shared/errors/index.ts:63-67`). Everything else uses the generic classes: `ValidationError` 400
(`:27-31`), `ForbiddenError` 403 (`:39-43`), `StaleDocumentError` 409 `STALE_DOCUMENT` (`:57-61`), and
`NotFoundError` 404.

**Audit verbs** (`packages/contracts/src/platform/audit.ts`, after `atmRegisterImport` `:164`):
`atmMapLocationSync` and `atmMapLinkResolve`, each with a comment in the style of `:153-162`. They are
not added to `REALTIME_BROADCAST_ACTIONS` (`packages/contracts/src/platform/realtime.ts:19-27`).

### 6.2 Scope helpers — `apps/api/src/modules/atm/map/map-scope.ts` (NEW)

```ts
/** DM-10: the register's rule for every map READ; `own` reads nothing. */
export const mapScopeMatch = (s: ScopeSelector): Record<string, unknown> =>
  s.scope === 'own' ? { ...NEVER_MATCH }
  : orgScopeMatch(s, { branch: 'branchId' }, { finerNarrowsToBranch: true }) ?? { ...NEVER_MATCH };
/** The branches that match covers: 'all' | ids (registerScopeBranches, register.repository.ts:33-47; own → []). */
export const mapScopeBranches = (s: ScopeSelector): 'all' | string[];
/** DM-11: a browser branch may only narrow. Throws ValidationError OUT_OF_REACH. */
export const narrowToBranch = (s: ScopeSelector, branchId: string | undefined): Record<string, unknown>;
/** Writes: the branches among `candidates` this key reaches (keyReachesBranch, shared/types/index.ts:210-211). */
export const writableBranches = (ctx: AuthContext, key: string, candidates: 'all' | string[]): 'all' | string[];
```

Every read uses `scopeSelector(ctx, key)` (`shared/types/index.ts:221-254`). It applies the top-bar
narrowing for an organization-wide grant (`:230-232`) and keeps a reach as the ceiling (`:233-252`).
Every write checks `keyReachesBranch(ctx, key, branchId)` (`:210-211`). That check is false for `own`,
`section` and a home-only `department` grant (`keyCoversUnit`, `:162-186`), so those scopes read but
never write. This is the register's rule (DEC-29, `register.repository.ts:1-14`).

### 6.3 Routes — `apps/api/src/modules/atm/map/map.routes.ts` (NEW), mounted at `/atm/map`

All routes go through `authenticate`, `authorize(key)` and `validate({...})`, the pattern of
`machines/machine.routes.ts:42-106`. Literal paths are declared before `/:machineId`. Final paths are
`/api/v1/atm/map/...` (`app.ts:237`). Responses use `ok(res, data)` (`infrastructure/http/respond.ts:6`).

| # | Method + path | Key | Request schema | Response | Errors |
|---|---|---|---|---|---|
| 1 | `GET /context` | `atmMap.view` | — | `AtmMapContextDto` | 403 |
| 2 | `GET /points` | `atmMap.view` | query `AtmMapPointsQuerySchema` | `AtmMapPointsDto` | 400 `OUT_OF_REACH`, 403 |
| 3 | `GET /zones` | `atmMap.view` | query `AtmMapZonesQuerySchema` | `AtmMapZonesDto` | 400, 403 |
| 4 | `PUT /zones` | `atmZone.manage` | body `SaveAtmMapZoneSetSchema` | `AtmMapZoneSetDto` | 400 (geometry, names, ids, order, `BRANCH_MISMATCH`), 403, 409 `ATM_MAP_ZONES_STALE`, 422 (no branch, `atm-context.ts:25-29`), 413 (> 1 MB, `app.ts:167`) |
| 5 | `GET /locations/summary` | `atmMachine.locate` | query `AtmMapLocationSummaryQuerySchema` | `AtmMapLocationSummaryDto` | 400, 403 |
| 6 | `POST /locations/parse` | `atmMachine.locate` | body `ParseAtmMapLocationSchema` | `AtmMapParseResultDto` (always 200; `ok:false` is a result, not an error) | 403 (key does not reach the machine's branch), 404 |
| 7 | `POST /locations/sync` | `atmMachine.locate` | body `SyncAtmMapLocationsSchema` | `AtmMapSyncResultDto` | 400 (`OUT_OF_REACH`, `TOO_MANY_MACHINES` > 5000), 403 |
| 8 | `POST /locations/resolve-links` | `atmMachine.locate` | body `ResolveAtmMapLinksSchema` | `AtmMapLinkResolveResultDto` | 400, 403 |
| 9 | `GET /machines/:machineId/location` | `atmMachine.locate` | params `{ machineId: objectId() }` | `AtmMachineLocationDetailDto` | 403, 404 |
| 10 | `PUT /machines/:machineId/location` | `atmMachine.locate` | body `PlaceAtmMachineLocationSchema` | `AtmMachineLocationDetailDto` | 400 (parse failure → detail `{ field: 'body.text', code: <reason> }`; `{ field: 'body.reason', code: 'REQUIRED' }`), 403, 404, 409 `STALE_DOCUMENT` |
| 11 | `POST /machines/:machineId/location/approve` | `atmMachine.locate` | body `ApproveAtmMachineLocationSchema` | `AtmMachineLocationDetailDto` | 403, 404, 409, 422 `ATM_MAP_NOT_UNDER_REVIEW` |

### 6.4 Reads — `map.service.ts`

- **`context`.** The branches = `mapScopeBranches(scopeSelector(ctx, 'atmMap.view'))`. `'all'` means
  every active branch, read the way `active-branch.ts:26-29` reads them. Ids are named through
  `branchRepository.findByIdsSystem`. `canManageZones` = `keyReachesBranch(ctx, 'atmZone.manage', id)`;
  `canLocate` = the same with `atmMachine.locate`. `editBranchId` = `await
  resolveAtmBranchId(ctx).catch(() => null)`, kept only when `canManageZones` is true for it.
  `organizationWide` = `ctx.permissions['atmMap.view'] === 'organization'`.
- **`points` (not paginated, lean; this is the endpoint `MAX_PAGE_SIZE` = 100 cannot serve,
  `common/index.ts:81`).** `match = { isDeleted: false, ...mapScopeMatch(s), ...narrowToBranch(s,
  q.branchId), ...statusFilter }`, where `statusFilter` is `active` → `isActive: true`, `archived` →
  `false`, `all` → none. It runs three lean queries:
  1. `AtmMachineModel.find(match, { branchId, machineCode, name, area, bankName, isActive })`;
  2. `AtmMachineLocationModel.find({ isDeleted: false, machineId: { $in } })` (only the fields the DTO
     needs);
  3. `AtmRegisterEntryModel.find({ machineId: { $in }, isDeleted: false, status: 'open' },
     { machineId, bankCode })`.

  `state` is `located` when status is located and `!needsReview`, `review` when `needsReview`, and
  `unlocated` otherwise. A missing location document gives `unlocated` with reason `notSynced`. Rows are
  sorted by `machineCode`. The response is compressed by `responseCompression` (`app.ts:134`). Nothing
  K or S is sent (`atm-register.ts:383`).
- **`zones`.** Read every non-deleted zone matching `mapScopeMatch` + `narrowToBranch`, sorted by
  `{ branchId, order }`, and the set documents of the branches involved. When `branchId` is given, its
  set is always returned, with `revision: 0` and `zones: []` if the branch has none.
- **`summary` (`atmMachine.locate`, read scope).** Active machines in reach, their location documents,
  and their open entries' `{ machineId, locationUrl, locationPlusCode, _id }` — three queries. The
  counts come from the same mapping as `points`. `pendingSync` = machines with no document, plus
  documents whose `sourceEntryId` or `sourceText` differs from the current open entry or entries (the
  same comparison as §4.3). `lastSyncAt` = the maximum `derivedAt`.

### 6.5 Writes — `zone.service.ts`, `location.service.ts`

**Zone-set save (`PUT /zones`):**
1. `branchId = await resolveAtmBranchId(ctx)` (`atm-context.ts:19-30`; this throws 422 with its own
   Arabic message). If `body.branchId !== branchId` → 400 `BRANCH_MISMATCH` (DM-12). If
   `!keyReachesBranch(ctx, 'atmZone.manage', branchId)` → 403.
2. Load the branch's live zones. Then validate (400, each detail naming its field, such as
   `creates[2].points`):
   - every update and delete id belongs to the branch (`UNKNOWN_ZONE`);
   - `order` is a permutation of (live ids − deletes) ∪ creates' tempIds (`ORDER_MISMATCH`);
   - the final count is ≤ 200 (`TOO_MANY_ZONES`);
   - final names are unique under DM-8 (`DUPLICATE_NAME`);
   - `zoneGeometryIssues` is empty for every create and for every update that carries points.
3. `unitOfWork` (`platform/kernel/unit-of-work.ts:5-17`):
   - **Revision CAS.** If `revision === 0`, `AtmMapZoneSetModel.create([{ branchId, revision: 1,
     createdBy, updatedBy }], { session })`; an E11000 means a set already exists → 409
     `ATM_MAP_ZONES_STALE`. Otherwise `findOneAndUpdate({ branchId, revision, isDeleted: false },
     { $inc: { revision: 1, __v: 1 }, $set: { updatedBy } }, { new: true, session })`, and `null` →
     409. Either way, nothing is written.
   - Soft-delete the deletes.
   - `$set` the changed fields of each update, plus `updatedBy` and `$inc __v`.
   - `insertMany` the creates (`createdBy`/`updatedBy` = caller).
   - Write `order = index` for every zone whose position changed.
4. After the commit, record the audits (the `recordAll` pattern, `register.service.ts:185-187`):
   - `create` → `diffChanges({}, zoneSnapshot(z))`;
   - `update` → the diff of the changed fields;
   - `delete` → `diffChanges(zoneSnapshot(before), {})`.

   `zoneSnapshot = { branchId, name, color, order, points: [[lat, lng], …] }`, and the entity ref is
   `{ moduleId: 'atm', entityType: 'mapZone', entityId }` (a literal pair, so the realtime registry
   scan sees it, `realtime-registry.spec.ts` `LITERAL_PAIR`).
5. Return the branch's full set, the same shape as `GET /zones?branchId`.

**Machine access for pin writes:** `AtmMachineModel.findOne({ _id, isDeleted: false })`. Not found →
404. `!keyReachesBranch(ctx, 'atmMachine.locate', String(machine.branchId))` → 403. The resulting
location write always copies `branchId` from the machine, never from the request.

**Parse (`POST /locations/parse`):** read with `readLocationText(text)`, rank with §4.3 (no stored
link), and recover a short code with `referenceFor(machine.branchId, machine.area)`. Return `ok:true`
with `needsReview: kind === 'shortPlusCode'`, or `ok:false` with the reason. A short link returns
`shortLink`; it is never fetched here.

**Place / move (`PUT /machines/:id/location`):**
1. The point comes from `mode: 'pin'` (round to 6 decimals), or from `mode: 'text'` parsed exactly as
   in Parse; a failure → 400 with the reason as the detail code.
2. Version check:
   - **document exists:** `body.version` must equal `doc.__v`, otherwise 409 `STALE_DOCUMENT`; the
     write is `updateById` with `version` (`base.repository.ts:432-459`);
   - **no document:** `body.version` must be `null`; a create that hits E11000 on `ux_machine` → 409
     `STALE_DOCUMENT` (another writer won).
3. If the existing point is located and `haversineMeters(old, new) > 1000` and `reason` is missing →
   400 `{ field: 'body.reason', code: 'REQUIRED' }` (DM-18).
4. Write `status: 'located'`, `source: 'manual'`, `needsReview: false`, `pinned: true`,
   `warnings: insideEgypt ? [] : ['outsideEgypt']`, `reason: null`, `manualText` (text mode),
   `moveReason`, `setBy/setByName/setAt` = the caller, now. Also store the machine's **current** open
   entry text as `sourceText`/`sourceEntryId`, which is what makes DM-2's "since the pin was set" true.
5. Audit `create` or `update` on `{ moduleId: 'atm', entityType: 'machineLocation', entityId:
   machineId }` with the diff of `locationSnapshot = { lat, lng, status, source, needsReview, reason,
   pinned, moveReason }` plus `{ field: 'distanceMeters', old: null, new: rounded }` for a move.

**Approve (`POST …/approve`):** the document must be `needsReview: true`, otherwise 422
`ATM_MAP_NOT_UNDER_REVIEW`. Check the version, set `needsReview: false`, `pinned: true`,
`reviewedBy/reviewedAt`, `sourceText` = the current text, and audit `update`.

**Detail (`GET /machines/:id/location`):** `sourceVisible` = `atmRegisterEntryRepository.findById(
sourceEntryId, scopeSelector(ctx, 'atmRegister.view')) !== null`. That is the register's own read rule
(DEC-29, `register.repository.ts:65-71`). `sourceText` is `null` when `sourceVisible` is false.

**Sync (`POST /locations/sync`):**
1. The scope is `writableBranches(ctx, 'atmMachine.locate', mapScopeBranches(scopeSelector(ctx,
   'atmMachine.locate')))`, narrowed by `body.branchId` (400 `OUT_OF_REACH` outside it).
2. Load the **active** machines there; more than 5000 → 400 `TOO_MANY_MACHINES`. Also load their
   location documents and their open entries (3 queries).
3. **Pass 1:** derive every machine whose best candidate is not a short code. **Pass 2:** compute
   references from the stored located pins plus pass 1's results, then derive the short codes.
4. Apply §4.3 precedence, and write only documents that changed, with one unordered `bulkWrite` and no
   transaction (each upsert is idempotent). A new or changed `shortLinkUrl` resets `shortLink` to
   `{ url, status: 'pending', attempts: 0 }`. An unchanged URL keeps its stored result. Every written
   document gets `derivedAt: now`, and its `setBy/setAt` change only when the point changed.
5. **One audit row:** `{ moduleId: 'atm', entityType: 'mapLocationSync', entityId: new ObjectId() }`,
   action `atmMapLocationSync`, changes `[{ field: 'branchIds', new }, { field: 'counts', new: result },
   { field: 'changedMachineIds', new: first 3000 }]`.

**Resolve links (`POST /locations/resolve-links`):**
1. Use the same writable scope. Select up to 20 documents with `shortLink.status: 'pending'` (plus
   `failed` with `attempts < 3` when `retryFailed`), oldest `lastAttemptAt` first, and claim each one
   (§5.4).
2. Resolve them sequentially, then update and re-derive each one (§4.3).
3. `remaining` = the count still eligible after the run.
4. **One audit row:** `{ moduleId: 'atm', entityType: 'mapLinkResolution', entityId: new ObjectId() }`,
   action `atmMapLinkResolve`, changes `[{ field: 'counts', new }, { field: 'outcomes', new:
   [{ machineId, status, failure }] }]`. No URLs.

### 6.6 Request size limits

- The JSON body limit is 1 MB (`app.ts:167`); a body over it is refused with 413 before Zod runs.
- Zod caps: 200 creates, 200 updates, 200 deletes and 200 order entries; 3–500 points per zone; names
  of at most 60 characters; texts of at most 2048 characters; reasons of at most 300 characters.
- `mongoSanitize` (`app.ts:169`) does not affect these bodies, which have no `$` keys and no dotted keys.

### 6.7 Realtime and web invalidation

- `apps/api/src/platform/realtime/realtime-registry.ts`:
  - `REALTIME_TOPICS` (after `atm.registerEntry`, `:27`): `'atm.mapZone': { permission: 'atmMap.view' }`
    and `'atm.machineLocation': { permission: 'atmMap.view' }`.
  - `REALTIME_EXCLUDED_ENTITIES` (after `atm.registerImport`, `:234-237`): `'atm.mapLocationSync'` and
    `'atm.mapLinkResolution'`, with the reason "one audit row per batch call (the register-import
    shape); the calling screen refetches itself".
- `apps/web/src/platform/realtime/invalidation-registry.ts` (`:47-69`):
  - add `'atm.mapZone': [['atm', 'mapZones']]`;
  - add `'atm.machineLocation': [['atm', 'mapPoints'], ['atm', 'mapLocationSummary'],
    ['atm', 'mapLocation']]`;
  - extend `'atm.machine'` with `['atm', 'mapPoints']` and `['atm', 'mapLocationSummary']` (an archived
    or renamed machine changes the map);
  - extend `'atm.registerEntry'` with `['atm', 'mapLocationSummary']` (`pendingSync` depends on AP/AV).

  The web spec requires a row for every server topic and none for unknown topics
  (`apps/web/src/platform/realtime/realtime.spec.ts:185-198`).
- **Limitation (GM-6).** Audit signals are published without `branchId` (`platform/audit/audit.service.ts:179`).
  Only organization-wide viewers join the topic room (`realtime/realtime-rooms.ts:32-33`;
  `realtime-publisher.ts:67-70`), so branch-scoped editors rely on the 409 and on their normal refetch.

---

## 7. Permissions, manifest, navigation (WP-M1 unless marked)

### 7.1 `apps/api/src/modules/atm/atm.module.ts`

Add these after `registerReportPermissions` (`:151-158`):

```ts
// The machine map (docs/12-planning/atm-map-zones.md): reading is per branch, finer scopes narrow
// to it and `own` reads nothing (DM-10).
const mapPermissions = declarePermissions('atm', 'atmMap',
  { en: 'ATM machine map', ar: 'خريطة الماكينات' }, ['view'], [], 'atm.map');
// Zones are drawn for ONE branch, the top bar's (D-M6); every write asks that the key reach it.
const zonePermissions = declarePermissions('atm', 'atmZone',
  { en: 'ATM map zones', ar: 'قطاعات خريطة الماكينات' }, [],
  [{ action: 'manage', name: { en: 'Draw, edit, delete and reorder map zones',
                               ar: 'رسم القطاعات وتعديلها وحذفها وترتيبها' } }], 'atm.map');
// Placing a machine on the map sits on the map page, beside the zones (DM-42).
const locatePermissions = declarePermissions('atm', 'atmMachine',
  { en: 'ATM machines', ar: 'ماكينات الصراف الآلي' }, [],
  [{ action: 'locate', name: { en: 'Place, move or approve a machine location on the map',
                               ar: 'تحديد موقع الماكينة على الخريطة وتعديله واعتماده' } }], 'atm.map');
```

- Append these to `atmPermissions` (`:165-173`). Names carry no parentheses
  (`atm.module.spec.ts:91-95`).
- Add the page `{ id: 'atm.map', moduleId: 'atm', name: { en: 'Machines map', ar: 'خريطة الماكينات' },
  route: '/atm/map', sortOrder: 45 }` to `atmPages` (`:175-218`), between machines (40) and register (50).
- Add the route `{ prefix: '/atm/map', router: buildAtmMapRouter() }` (`:227-238`).
- Add the collections `'atm_machine_locations'`, `'atm_map_zone_sets'` and `'atm_map_zones'` (`:239-247`).
- Extend the header comment (`:1-16`) by one line naming this slice.

**Intended scopes** (`declarePermissions` stores no scope, `packages/contracts/src/permissions/def.ts:100-107`;
the grant decides):

| Key | Meaningful scopes | Effect |
|---|---|---|
| `atmMap.view` | `branch`, `organization`; `department`/`section` narrow to the home branch | `own` reads nothing (DM-10) |
| `atmZone.manage` | `branch` (supervisor), `organization` | writes need `keyReachesBranch`; finer scopes never write |
| `atmMachine.locate` | `branch`, `organization` | same |

### 7.2 Seed, pinned spec, page registry, permission matrix

- **Super-admin.** `seedAtm` grants every `atmPermissions` key (`atm.seed.ts:17-19`), so there is no
  code change. The three new keys reach super-admin on the next boot, and nobody else.
- **`atm.module.spec.ts`:**
  - the comment `:3` becomes "30 permissions, 7 pages, 9 routes, 10 collections, 2 scheduled tasks";
  - add `atmMachine.locate`, `atmMap.view` and `atmZone.manage` to the sorted list `:23-51`;
  - add `'atm.map'` between `'atm.machines'` and `'atm.register'` in `:52-59`;
  - add `'/atm/map'` to `:60-69`;
  - add the three collections to `:70-78`.
- **Page registry.** `scripts/check-page-registry.mjs` reads the `declarePermissions(` calls and the
  last page-id argument from the manifest source, so the three calls above register `atm.map`. Run
  `npm run check:page-registry`.
- **Permission matrix.** `docs/06-security/permission-matrix.generated.md` is generated from
  `platformPermissions` only (`:1-3`; `scripts/gen-permission-matrix.mjs:10-19`), and ATM keys are
  module-declared. Running `npm run check:permission-matrix` must therefore show **no diff**. Run
  `gen:permission-matrix` only if it reports one.

### 7.3 Navigation — `apps/api/src/seed-navigation.ts`

Insert this row right after «كل الماكينات» (`:1050-1056`):

```ts
{ en: 'Machines Map', ar: 'خريطة الماكينات', route: '/atm/map', icon: 'pin', permission: 'atmMap.view' },
```

The icon `pin` is registered (`apps/web/src/platform/navigation/app-icon.tsx:73` → `PinIcon`,
`shared/ui/icons.tsx:192`); there is no `map` icon (GM-17). `syncNavigationCatalog` adds missing rows
by route and gives a new row the midpoint `sortOrder` between its neighbours (`seed-navigation.ts:1337-1385`).
`/atm/map/unlocated` gets no nav row; the web's exact-match rule handles the nested route
(`platform/navigation/nav-model.ts:95-96`).

### 7.4 ATM overview card (WP-M2)

In `apps/web/src/modules/atm/pages/AtmOverviewPage.tsx`, add this to `ATM_SHORTCUTS` after the
machines entry (`:82-89`):
`{ to: '/atm/map', titleKey: 'atm.nav.map', descKey: 'atm.cards.map', icon: PinIcon, permission:
'atmMap.view' }`. `atm-i18n.spec.ts:192-198` checks both keys in both locales.

### 7.5 Remembered-filters census (WP-M2)

`apps/web/src/shared/lib/remembered-filters-coverage.spec.ts` partitions every `*Page.tsx`
(`:8-22`). Add to `COVERED` (`:46-53`):
- `['modules/atm/pages/MachineMapPage.tsx', ['q', 'machine']]`. `q` is the fly-to search, and `machine`
  is a deep link that opens one popup; neither is a filter.
- `['modules/atm/pages/UnlocatedMachinesPage.tsx', ['q', 'machine']]`.

---

## 8. Web (WP-M2) — `apps/web/src/modules/atm/`

### 8.1 Routes — `routes.tsx`

- Header list `:4-26`: add `/atm/map atmMap.view` and `/atm/map/unlocated atmMap.view +
  atmMachine.locate`.
- `<Route path="map" element={<RequirePermission permission="atmMap.view"><MachineMapPage /></RequirePermission>} />`
- `<Route path="map/unlocated" element={<RequirePermission permission="atmMap.view"><RequirePermission
  permission="atmMachine.locate"><UnlocatedMachinesPage /></RequirePermission></RequirePermission>} />`.
  `RequirePermission` takes `permission` or `anyOf` (`platform/router/RequirePermission.tsx:13-18`), so
  the two keys are nested.

The ATM chunk is already lazy (`platform/app/App.tsx:38`). **Leaflet gets a chunk of its own inside it:**
`components/map/MapCanvas.tsx` is the only file that imports `leaflet` and `leaflet/dist/leaflet.css`,
and both pages mount it with `lazy(async () => import('../components/map/MapCanvas'))` inside
`<Suspense fallback={<div className="h-full w-full animate-pulse rounded-2xl bg-slate-100" />}>`. This
is the `CatalogDialogs.tsx:27-29, 380-387` precedent. Pages and `lib/` files never import `leaflet`.
The web suite runs in `node` without jsdom (`apps/web/vitest.config.ts:3-10`), and a lazy component
renders its fallback under `renderToStaticMarkup`.

### 8.2 API client and queries — `api/map-api.ts`, `api/map-queries.ts` (NEW)

Keys follow `[module, feature, kind, params]` (`shared/lib/query-keys.ts:1-15`):
- `listKey('atm', 'mapContext')`
- `listKey('atm', 'mapPoints', { branchId, status })`
- `listKey('atm', 'mapZones', { branchId })`
- `listKey('atm', 'mapLocationSummary', { branchId })`
- `detailKey('atm', 'mapLocation', machineId)`

Mutations, and what they invalidate (the same families as §6.7, which the registry rows must match):
- `useSaveZoneSet` → `mapZones`;
- `usePlaceLocation`, `useApproveLocation`, `useSyncLocations` and `useResolveLinks` → `mapPoints`,
  `mapLocationSummary`, `mapLocation`.

The parse call is a mutation with `gcTime: 0`, so a pasted text is not cached.

### 8.3 Pages and layout

**`pages/MachineMapPage.tsx` (S1, with S2/S3 as its edit mode)**
- `PageContainer fullHeight` (`PageContainer.tsx:18-45`).
- `PageHeader title={t('atm.map.title')}` with `figures` = `MapFigures` and `actions`
  (`PageContainer.tsx:48-98`, no subtitle).
- The filter bar (`DARK_FILTER_BAR`, `shared/ui/dark-filter-bar.ts:9-23`, the `MachinesPage.tsx:207-215`
  pattern) is shown in view mode. In edit mode it is replaced by `EditStrip`.
- The working row is `flex min-h-0 flex-1 gap-4`: panel `w-[360px] shrink-0 overflow-y-auto` on the
  reading-start side, and map `min-w-0 flex-1`. Below `lg` the panel moves into `SideLayer` (DM-40),
  opened by the map button «اللوحة الجانبية».
- Data: `context`, `points(branch, status)` and `zones(branch)`. The default view branch is
  `context.editBranchId` when it is in `branches`; else the only branch; else «كل الفروع» when
  `organizationWide`; else the first branch. An empty `branches` list shows the empty state «لا يشمل
  نطاق صلاحيتك أي فرع.».

**`pages/UnlocatedMachinesPage.tsx` (S5)**
- `PageHeader` «ماكينات بدون موقع», with the figure «تم تحديد موقع n من m» (DM-39) and the action
  «رجوع إلى الخريطة» (a guarded `Link` to `/atm/map`).
- Working row: panel `w-[440px]`, gap 16, map flex (critic §S5).

### 8.4 Map container rules — `components/map/MapCanvas.tsx`

- **Wrapper:** `relative isolate h-full overflow-hidden rounded-2xl border border-slate-200 bg-[#f2efe9]`.
  `isolate` creates a stacking context, so Leaflet's panes (z 200–700) and controls (z 800–1000,
  `node_modules/leaflet/dist/leaflet.css:100-141`) can never paint over a `Dialog` (`z-[90]`,
  `shared/ui/Dialog.tsx:82`) or the toasts (`z-[100]`, `shared/ui/toast/Toaster.tsx:19`). Our own
  overlays inside the wrapper use `z-[1100]`.
- **`dir="ltr"`** on the Leaflet host element, because `leaflet.css` has no RTL rules (research
  `ecms-ui.md` §1). Every React overlay inside it (popup, toolbars, chips, bottom bar, legend) sets
  `dir={locale === 'ar' ? 'rtl' : 'ltr'}`.
- **The map stays light in dark mode.** No `dark:` variant appears inside the wrapper, the overlays use
  fixed light classes, and the tile colours are never changed. The panel outside follows the theme.
- **Tiles:** `L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
  attribution: '&copy; OpenStreetMap', referrerPolicy: 'strict-origin-when-cross-origin' })`. The URL
  and attribution are the same as `BranchMapPicker.tsx:67-70`; they live in an ATM-local constant
  `lib/map-tiles.ts` with a comment citing that line. They are **not** shared, so the operations
  screen keeps its current behaviour. The CSP already allows the host (`app.ts:161`), so there is no
  CSP change. `{s}.` must stay, because `*.tile.openstreetmap.org` does not match the bare host (research
  `ecms-ui.md` §3).
- **Controls:**
  - the zoom control at top-left, with `zoomInTitle` and `zoomOutTitle` from i18n;
  - «عرض الكل» (fit to the visible points and zones) under it;
  - the Arabic scale bar `ScaleBar` at bottom-left, using `lib/map-scale.ts`: the metres per 72 px at
    the map centre, rounded to 1, 2 or 5 × 10ⁿ, as «{{n}} م» or «{{n}} كم»;
  - the attribution at bottom-right, which is never styled away (`BranchMapPicker.tsx:7-9`).
- **Default view:** fit the bounds of the visible zones and points. With nothing to show, use Cairo
  `{ lat: 30.0444, lng: 31.2357 }` at zoom 11 (`BranchMapPicker.tsx:21-22`).
- **Tile failure:** more than 6 `tileerror` events within 10 s shows `TileErrorBanner` «تعذّر تحميل
  الشوارع. تظهر القطاعات والماكينات على خلفية فارغة.».
- **«شوارع باهتة»** adds the class `atm-map-faded` to the wrapper. Its rule `.atm-map-faded
  .leaflet-tile-pane { filter: grayscale(0.6) opacity(0.75) }` sits in the module CSS, with no inline
  `style` attribute.
- **Rendering:**
  - machine dots: `L.circleMarker` on one `L.canvas()` renderer (DM-27);
  - review pins, clusters, labels and handles: `L.marker` + `L.divIcon` whose `html` is an element
    built by `lib/map-dom.ts` with `textContent`;
  - the popup: the React `MachinePopup` positioned with `map.latLngToContainerPoint` and updated on
    `move`/`zoom`.
- **Imperative bridge:** `MapCanvas` builds the `L.map` once and reads changing values through refs
  (the `BranchMapPicker.tsx:52-81` pattern). Props diffs update layers in place, so tiles are never
  rebuilt. The component exposes `onViewportChange(projector)` so that pure `lib/` functions get pixel
  coordinates.

### 8.5 Pure modules — `lib/` (each with a `.spec.ts`)

| File | Responsibility |
|---|---|
| `map-geometry.ts` | Re-exports the contracts geometry (§6.1). `zoneMembership(point, zonesOfBranchInOrder) → { primary: id \| null; all: id[] }` (D-M7, DM-9). `wouldCrossWhileDrawing(openPath, next)` (the new edge against the non-adjacent drawn edges). `closestPointOnSegmentPx`. `snapTarget(cursorPx, candidatesPx, thresholdPx) → { kind: 'vertex' \| 'edge' \| 'first', zoneId, index, latlng } \| null` (a vertex beats an edge, which beats nothing; the first dot while drawing gives `first` = close the shape). `coordKey(p) = lat.toFixed(6)+','+lng.toFixed(6)`. `linkedVertices(draft, key)` (the shared vertices, DM-6). `insertOnEdge(zone, edgeIndex, p)` (skipped when a vertex is within 1e-7°). `midpoints(zone, projector) → { edgeIndex, latlng, hidden: lengthPx < 40 }[]`. `overlapsOf(zone, others) → { zoneId, machinesInBoth }[]`. |
| `map-labels.ts` | `placeLabel(polygonPx, pinsPx, labelSizePx)`. Sample a 9×9 grid over the bounding box and keep the points inside the polygon and ≥ 8 px from its edges. Score each = (distance to the nearest edge) − 40 × (pins under the label rectangle); on a tie, prefer the one closer to the centroid. Return `null` when the polygon's on-screen box is < 80 px or zoom < 9. `resolveCollisions(labelsInListOrder)` drops the later label of two that overlap (lower in the list = dropped). |
| `map-cluster.ts` | `clusterPoints(pointsPx, cellPx = 56, zoom)`. At zoom ≥ 15 there is no grid. Points ≤ 1 m apart always group as a "stack" (spiderfy). Output `{ kind: 'single' \| 'cluster' \| 'stack', members, centerPx }`. `spiderfy(centerPx, n)` puts n points on a circle of radius 18 + 4n px. |
| `map-colors.ts` | `ATM_MAP_ZONE_PALETTE` with its i18n names. `suggestColor(draft, newZoneBbox)`: the first palette colour not used in the branch; else the least-used one that no touching zone uses; ties go to palette order. `needsCasing(hex)`: contrast against `#f2efe9` < 3:1 (WCAG relative luminance). `bankColor(code \| null)`: `ATM_BANK_REPORT_COLORS` (`atm-register.ts:44-51`), or `#6b7280` for null. `paleBank(code)` is true for CIB, HDB and BRK (they get a dark ring). |
| `map-filters.ts` | URL ⇄ filter: `banks` (codes + `none`), `areas`, `zones` (ids + `none` + `multi`), `status` (`active` \| `archived` \| `all`, default `active`), `loc` (`all` \| `located` \| `review`), `branch`, `q`, `machine`. `applyMapFilters(points, zonesMembership, f)` gives the visible points. `mapFigures(visible) → { onMap, inZones, outZones, unlocated }`. `pruneStale(filters, options)` removes values no longer offered, the precedent from task #20. |
| `zone-editor.ts` | The reducer and the history (§8.6), plus `buildZoneSetSave(base, draft) → SaveAtmMapZoneSet` (only changed fields; `order` = the final ids and tempIds) and `dirtyCount(base, draft)` (DM-23). |
| `zone-draft-storage.ts` | `loadDraft(branchId)` and `saveDraft(branchId, { baseRevision, draft, savedAt })` under the key `ecms.atmMap.zoneDraft.<branchId>`, with every access in try/catch (`useRememberedFilters.ts:48-64`). `clearDraft`. |
| `map-shortcuts.ts` | `shortcutFor(event) → action \| null` by `KeyboardEvent.code` (`KeyN`, `Enter`, `Escape`, `Backspace`, `Delete`, `KeyZ` with ctrl/meta, ±shift, `KeyY` with ctrl, arrows ±shift). It returns `null` when the target is `input`, `textarea`, `select` or `[contenteditable]`. |
| `map-count-text.ts` | `machineCountText(n, t, locale)` → the five forms (DM-21), with numbers through `formatNumber` (`shared/lib/format.ts:92-93`). |
| `map-scale.ts` | `scaleFor(metersPerPixel, maxPx = 72) → { meters, px, label }`. |
| `unlocated-view.ts` | `reasonChipCounts(points)` (chips with 0 are hidden). `parseFeedback(result) → i18n key + tone`. `linkFailureKey(failure)`. |
| `map-links.ts` | `googleMapsUrl({ lat, lng })` = `https://www.google.com/maps?q=lat,lng` (the shape of `maps-link.ts:127-128`; ATM imports nothing from other modules). `registerSearchUrl(code)` = `/atm/register?q=<code>` (`RegisterPage.tsx:107`). |

### 8.6 Zone editor state machine — `lib/zone-editor.ts`

**State:**

```ts
{ mode: 'view' | 'edit' | 'draw'; branchId: string | null; base: AtmMapZoneSetDto | null;
  draft: DraftZone[]   /* ordered; DraftZone = { id: string (real id or 'new-…'), name, color, points } */;
  selectedZoneId: string | null; selectedVertex: { zoneId: string; index: number } | null;
  drawing: { points: LatLng[]; color: string } | null;
  past: DraftZone[][]; future: DraftZone[][]   /* ≤ 100 each; cleared on SAVED */ }
```

**Transitions:**
- **view → edit (`ENTER_EDIT(set)`):** the button «تعديل القطاعات» is shown when `can('atmZone.manage')`
  and the viewport is ≥ 768 px. It is enabled when `context.editBranchId !== null`, otherwise its
  title explains «اختر فرعًا محددًا من القائمة العلوية قبل تعديل القطاعات.».
  - Fetch `zones?branchId=editBranchId`. That fresh revision is the base.
  - The panel's «الفرع» switches to the edit branch and is locked («الفرع: name 🔒»).
  - If a stored draft exists with `baseRevision === set.revision`, offer «استعادة المسودة / تجاهلها».
    If its revision differs, show the outdated notice and clear it.
- **edit → draw (`START_DRAW`, the «قطاع جديد» button or N):** set the crosshair cursor and
  `map.doubleClickZoom.disable()`. The suggested colour is preselected.
- **draw:**
  - `ADD_POINT(p)` applies snap (unless Alt is held or the toggle is off) and refuses a crossing edge
    (the toast «لا يجوز أن تتقاطع حدود القطاع مع نفسها.» and the dot flashes red).
  - A double-click drops its duplicate second dot (within 4 px of the previous one), then finishes.
  - `UNDO_POINT` is Backspace, Ctrl+Z or «تراجع عن النقطة».
  - `FINISH_DRAW` (click the first dot, double-click, Enter or «إنهاء») needs ≥ 3 points and no issues
    from `zoneGeometryIssues`. `TOO_SMALL` gives the toast «القطاع صغير جدًا؛ يجب ألا تقل مساحته عن 100
    متر مربع.». On success it appends `{ id: 'new-<rand>', name: 'قطاع {{n}}', color }` (DM-22), pushes
    history, selects the zone, returns to edit and shows the toast «أُضيف القطاع. غيّر اسمه ولونه من
    اللوحة، ثم احفظ التغييرات.».
  - `CANCEL_DRAW` (Esc or «إلغاء») with ≥ 3 points shows the toast «أُلغي الشكل.»; with fewer it is
    silent (DM-31).
- **edit:**
  - `SELECT_ZONE` (click a fill or a list row);
  - `SELECT_VERTEX`;
  - `MOVE_VERTEX(zoneId, index, p, { unlink })` moves the vertices linked to it too, unless Alt is held;
    on drag end it checks `selfIntersects` for every zone touched, and on a failure it reverts and shows
    the crossing toast;
  - `INSERT_VERTEX(zoneId, edgeIndex, p)` comes from a midpoint drag;
  - `DELETE_VERTEX` (Delete, Backspace, the chip «حذف النقطة» or the panel button «حذف النقطة المحددة»)
    is disabled at 3 points with the title «يلزم القطاع ثلاث نقاط على الأقل»;
  - `RENAME` is committed on blur or Enter (one step);
  - `RECOLOR`;
  - `MOVE_UP`, `MOVE_DOWN` and `SORT_AZ` (`localeCompare` in the page locale);
  - `DELETE_ZONE`, after confirmation.

  An edge snap at gesture end also runs `insertOnEdge` on the neighbour in the **same** history step.
- **Undo/redo:** Ctrl+Z and Ctrl+Shift+Z or Ctrl+Y, plus «تراجع» and «إعادة». There is one step per
  finished gesture, at most 100. Ctrl+Z inside the name field undoes text only (the shortcut ignores
  inputs).
- **Leaving:**
  - `DISCARD` («إلغاء التغييرات», confirm «إلغاء كل التغييرات غير المحفوظة؟» when dirty) refetches,
    resets to the base and clears the stored draft;
  - `EXIT_EDIT` («خروج من التعديل», the same confirm when dirty) returns to view;
  - `SAVED(set)` sets base = set, draft = set.zones, clears history and the stored draft, and shows the
    toast «حُفظت التغييرات، وسُجّلت في سجل التدقيق.»; the page stays in edit mode;
  - `CONFLICT` (409 `ATM_MAP_ZONES_STALE`) keeps the draft and opens `ConflictDialog`.
- The draft is autosaved to storage after each history push.

### 8.7 Unsaved-changes guard — `lib/useUnsavedGuard.ts`

`useEffect` adds a `beforeunload` listener while `dirtyCount > 0`. The page's own navigation
(«ماكينات بدون موقع», «فتح في سجل الماكينات», «رجوع إلى الخريطة», «خروج من التعديل») goes through
`confirmLeave()`, which shows the dialog «لديك تغييرات غير محفوظة. هل تريد المغادرة دون حفظ؟». The
sidebar cannot be blocked under `BrowserRouter` (`App.tsx:103`), so the stored draft (§8.6) protects
the work. The idle logout still applies, and map gestures count as activity, because `pointermove`,
`pointerdown` and `wheel` are activity events (`platform/auth/idle-session.ts:176-183`).

### 8.8 Components — `components/map/` (NEW)

| Component | Responsibility (mockup reference) |
|---|---|
| `MapCanvas` (lazy, default export) | §8.4 rules; layers for zones (fill 0.25, 0.35 on hover or selection; outline 3, or 4 with a white halo when selected; casing `#1f2937` at 60 % for `cased` colours), dots, clusters, labels, the drawing preview (dashed cursor line for the mouse only; first dot 14 px, others 10 px; a ring and the tooltip «إغلاق الشكل» near the first dot), handles (orange `#F97316` squares 12 px visible / 32 px hit area; blue `#2563EB` diamonds), the temporary pin (`L.marker({ draggable: true })` + `dragend`, `BranchMapPicker.tsx:95-99`), and the scale bar. |
| `MapFigures` | Four chips in the `MachineFigures` style (`components/MachineFigures.tsx:33-72`): «على الخريطة», «داخل القطاعات», «خارج القطاعات», «بدون موقع» (amber, «?»). The last one is a link to `/atm/map/unlocated` only for `atmMachine.locate`, plain text otherwise. |
| `MapFilters` | `FilterBar` + `FilterWithIcon` + `MultiSelect`, as on `MachinesPage.tsx:207-282`: «البنك» (6 codes + «بنك غير محدد»), «المنطقة», «القطاع» (zones + «بلا قطاع» + «في أكثر من قطاع»; with «كل الفروع» the label is "name — branch"), «الحالة» (`active` default / `archived` / `all`), «الموقع» (الكل / على الخريطة / يحتاج إلى مراجعة), search «رقم الماكينة أو اسمها» (Enter → fly to zoom 17 and open the popup; an unlocated machine gives a toast with the link), and reset. `useRememberedFilters([sp, setSp], ['banks', 'areas', 'zones', 'status', 'loc', 'branch'])`. |
| `MapPanel` | View mode: «الفرع» select (hidden with one branch); «القطاعات (n)» + «بحث في القطاعات» + `ZoneList` (10 per page, `NumberedPager`); the summary line «داخل القطاعات: n · خارج القطاعات: n · بدون موقع: n»; `LayersSection`. With «كل الفروع», the zone list is grouped under branch headings. |
| `ZoneList` | 48 px rows: a 12 px swatch with a ring, the name, the count pill (`machineCountText`) and a chevron. Hover raises the fill on the map; a click zooms to the zone and opens `ZoneDetail`. |
| `ZoneDetail` | «› رجوع إلى القطاعات»; a header with swatch, name, count pill and «تعديل» (`atmZone.manage` and `canManageZones` for that branch → edit mode with this zone selected); «حسب البنك» (an 8 px stacked bar + rows in bank colours); «حسب المنطقة»; «الماكينات» (rows رقم الماكينة \| اسم الماكينة \| البنك \| المنطقة, 10 per page; a click flies to the machine); «يقع جزء منه في قطاعات أخرى: n» when it overlaps. Counts cover visible points only. |
| `LayersSection` | «الطبقات»: «إظهار الماكينات», «إظهار القطاعات», «إظهار أسماء القطاعات على الخريطة», «شوارع باهتة (لتظهر ألوان القطاعات أوضح)», and «تلوين الماكينات حسب:» as a segmented control «القطاع \| البنك» with `aria-pressed`. These are remembered per viewer (DM-30). |
| `BankLegend` | Bottom-left inside the map when colouring by bank: the 6 banks in their colours, plus «بنك غير محدد». |
| `MachinePopup` | 280 px, React overlay. Title: the code (monospace, `dir="ltr"`), the bank dot, the status pill «قيد التشغيل»/«مؤرشفة», the chip «يحتاج إلى مراجعة» when under review, and close «إغلاق». Rows: «اسم الماكينة», «البنك» (name (code) or «بنك غير محدد»), «المنطقة», «الفرع», «القطاع» (● name / «بلا قطاع» / «في أكثر من قطاع: … — يُحتسب على «…»»), «مصدر الموقع» (DM-19), and «آخر تحديث للموقع» (DM-20). Links: «فتح في سجل الماكينات» (`atmRegister.view`), «فتح في خرائط Google» (`noopener noreferrer`), «تحريك الموقع» (`canLocate` for the branch → `MovePinBar`). Esc closes it. |
| `MovePinBar` | A bottom bar over the map: «اسحب العلامة إلى الموقع الصحيح · القطاع: X» (live), «تأكيد الموقع», «إلغاء». The pin gets an orange ring and becomes draggable. Confirming a move of > 1 km opens `MoveConfirmDialog`; otherwise it calls `PUT … { mode: 'pin' }`. On success: the toast «حُدِّد موقع الماكينة {{code}} — القطاع: {{zone}}. سُجّل التغيير في سجل التدقيق.». |
| `MoveConfirmDialog` | «تأكيد تحريك الموقع»: «تحرّك الموقع {{km}} كم», «القطاع: {{from}} ← {{to}}», the required field «سبب التحريك», and the buttons «تأكيد» / «رجوع». |
| `EditStrip` | 48 px, `amber-50`: «وضع تعديل القطاعات — فرع {{branch}}», the badge «تغييرات غير محفوظة: {{count}}», «↶ تراجع», «↷ إعادة», «إلغاء التغييرات» (secondary), «حفظ التغييرات ({{count}})» (primary, disabled at 0), and the link «خروج من التعديل». |
| `EditPanel` | In this order: «الفرع: name 🔒»; «+ قطاع جديد»; when a zone is selected, «القطاع المحدد» (the field «اسم القطاع», «اللون» via `ColorPicker`, «الماكينات داخل القطاع: n (كانت m)», «عدد النقاط: n», «حذف النقطة المحددة» + «اسحبها لتحريكها», the overlap lines «يتداخل مع «X»؛ في منطقة التداخل n», «حذف القطاع»); otherwise the hint «اختر قطاعًا من الخريطة أو من القائمة لتعديله، أو اضغط «قطاع جديد» لرسم قطاع.». Then «الالتصاق» (the checkbox «الالتصاق بنقطة أو قطاع», a slider 4–30 default 12 «مسافة الالتصاق: n بكسل», and the help text); «القطاعات (n)» + «ترتيب أبجدي» + rows (swatch, inline name, count, ↑ «تحريك لأعلى», ↓ «تحريك لأسفل»; ↑ is disabled on the first row and ↓ on the last) + «عند تداخل قطاعين تُحتسب الماكينة للقطاع الأعلى في القائمة.»; and «إظهار أسماء القطاعات على الخريطة». In draw mode it is replaced by `DrawPanel`. |
| `DrawPanel` | «رسم قطاع جديد», the three numbered steps, «عدد النقاط: n · الماكينات داخل الشكل: n», and the buttons «إنهاء» (disabled below 3, title «يلزم ثلاث نقاط على الأقل»), «تراجع عن النقطة», «إلغاء». The map also shows the hint pill «انقر لإضافة نقطة، ثم انقر على النقطة الأولى لإغلاق الشكل» and the live chip «الماكينات داخل الشكل: n» (`aria-live="polite"`). |
| `ColorPicker` | A 6×2 grid of 28 px swatch buttons (`aria-label` = colour name, `aria-pressed`); the tag «مقترح» on the suggested swatch while the zone is new; and «لون مخصص»: a native `<input type="color">` (precedent `hr/contracts/components/BrandingCard.tsx:107-114`) + a hex field validated with `/^#[0-9a-fA-F]{6}$/`. |
| `VertexChip` | Next to the selected vertex: «حذف النقطة» + «اسحبها لتحريكها». A shared vertex shows «نقطة مشتركة مع X و Y». |
| `SaveSummaryDialog` | `Dialog` max-w-lg, «مراجعة التغييرات قبل الحفظ»: «قطاعات جديدة n · معدّلة n · محذوفة n»; a table «القطاع \| قبل \| بعد» (counts before and after; «محذوف»; «—» for a new zone); the overlap lines; «ماكينات ستصبح بلا قطاع: n»; the buttons «الرجوع إلى التعديل» / «حفظ». |
| `ConflictDialog` | «تعذّر الحفظ» + «عدّل مستخدم آخر القطاعات بعد بدء تعديلك. مسودتك محفوظة على هذا الجهاز؛ حمّل النسخة الأحدث ثم أعد تطبيق تغييراتك.», with «تحميل النسخة الأحدث» (asks the discard confirm first) / «إغلاق». |
| `DeleteZoneDialog` | «حذف «{{name}}»؟» + «ستصبح {{count}} بلا قطاع، إلا إذا كانت داخل قطاع آخر.» (count = the machines whose primary zone is this one), with «رجوع» / «حذف» (danger). |
| `DraftRestoreNotice` | «توجد مسودة غير محفوظة من جلسة سابقة.» with «استعادة المسودة» / «تجاهلها». An outdated draft shows «المسودة المحفوظة أقدم من القطاعات الحالية، ولا يمكن استعادتها.». |
| `TileErrorBanner` | §8.4. |
| `UnlocatedPanel` | The progress line «تم تحديد موقع n من m» + n % + a bar; `ReasonChips` (multi-filter, URL `reasons`); `SyncCard`; `LinkResolutionCard`; the search «رقم الماكينة أو اسمها»; the list of `UnlocatedRow` (64 px; unlocated and review points of the selected branch); the empty state «كل الماكينات لها موقع على الخريطة.»; the no-match state. |
| `ReasonChips` | One chip per reason with a count above 0, in this order: يحتاج إلى مراجعة، رابط مختصر، تعذّر التحويل، رابط بدون إحداثيات، رمز مختصر بلا مرجع، إحداثيات غير صالحة، نص غير مقروء، أكثر من سجل مفتوح، لا يوجد سجل مفتوح، بلا موقع، لم يُقرأ من السجل بعد. |
| `UnlocatedRow` | Line 1 «{{code}} · {{name}}»; line 2: the bank dot + bank, area, branch, and the reason chip. Expanded: it fetches `GET …/location`, then shows «الموقع في السجل: …» (only when `sourceVisible`), «فتح الرابط الأصلي» (http(s) only, `noopener noreferrer`), the link failure text for `shortLinkFailed`, the review note «رمز Plus Code مختصر؛ حُدِّد الموقع تقريبيًا بالنسبة إلى الفرع. راجعه على الخريطة ثم اعتمده أو صحّحه.» (+ the far note when `farFromReference`), and the buttons «اعتماد الموقع» / «تصحيح» for review rows. It also has the field «الصق رابطًا كاملًا أو إحداثيات أو رمز Plus Code» (placeholder `30.0444, 31.2357`) + «قراءة» → `POST /locations/parse` → the inline message (§8.12) and a temporary pin, and «وضع على الخريطة» → the map hint «انقر على مكان الماكينة {{code}} على الخريطة» → a click places a draggable pin → `MovePinBar`. Confirming a pin that was neither dragged nor moved after «قراءة» sends `{ mode: 'text', text }`; otherwise it sends `{ mode: 'pin' }`. |
| `SyncCard` | «مزامنة المواقع من سجل الماكينات», its body text, «بانتظار المزامنة: n», «آخر مزامنة: date», and «بدء المزامنة» → `POST /locations/sync` with the selected branch → the toast «اكتملت المزامنة: …». |
| `LinkResolutionCard` | «تحويل الروابط المختصرة تلقائيًا», its body text, «بدء التحويل» / «إيقاف التحويل», the progress «n من m», and «إعادة محاولة ما تعذّر تحويله» when failed > 0. It loops `POST /locations/resolve-links` while `remaining > 0` and it has not been stopped, then shows the toast «اكتمل التحويل: حُوِّل n، وتعذّر m فبقي في القائمة لوضعه يدويًا.». |

### 8.9 Map styles (view mode)

- **Dots** are 10 px with a white 1.5 px ring, in the zone colour (colour-by-zone) or the bank colour
  (colour-by-bank; CIB, HDB and BRK get a `#1f2937` ring).
- A machine in no zone is a grey hollow dot (`#6b7280` ring, white fill).
- A review pin is a `divIcon` with a dashed amber ring and «?».
- An archived machine is drawn at 50 % opacity.
- **Clusters** are neutral ink `#1f2937` with a white count, sized 28–40 px by count. When exactly one
  zone is filtered they take that zone's colour. A click zooms to the cluster's bounds; a stack fans
  out.
- **Labels** are white pills «● name · count» with a dark text halo, shown when «إظهار أسماء القطاعات»
  is on, placed by `placeLabel`.
- Grey `#6b7280` is reserved for «بلا قطاع» and red for errors; no palette colour is grey or red.

### 8.10 Polling, batching and error mapping

- **Sync** is one call.
- **Resolve** loops in the browser: each response gives `remaining`; on `stoppedByBudget` the next
  call starts immediately; «إيقاف التحويل» stops after the current call.
- Errors: 409 `ATM_MAP_ZONES_STALE` opens `ConflictDialog`; 409 `STALE_DOCUMENT` on a pin shows the
  toast `STALE_DOCUMENT` (`shared/lib/errors.ts`) and refetches the detail; a 400 with detail codes
  shows the matching inline message (§8.12); everything else goes through `errorMessage`
  (`shared/lib/errors.ts`).

### 8.11 Accessibility

- The map host has `role="application"` and `aria-label` «خريطة الماكينات والقطاعات»
  (`BranchMapPicker.tsx:109-114` pattern).
- Canvas dots are not focusable (GM-18). Keyboard users reach machines through the search, `ZoneList`
  and the `ZoneDetail` machine rows (buttons; Enter flies to the machine and opens the popup, which
  takes focus and closes on Esc). The unlocated list rows are buttons.
- Vertex handles are focusable `divIcon`s (`keyboard: true`) with `aria-label` «نقطة رقم {{n}} في
  {{zone}}». A selected vertex moves with the arrow keys (DM-41) and is deleted with Delete. Midpoints
  have `aria-label` «نقطة قطاع — اسحبها لإضافة نقطة».
- Every icon button has a text label or an `aria-label`. Toggles use `aria-pressed`, and swatches have
  names. The live counts are in an `aria-live="polite"` region.
- Shortcuts use `KeyboardEvent.code`, so they work on an Arabic keyboard layout, and they pause inside
  text fields.
- Contrast: zone outlines carry the colour, and the light colours get a casing (§8.8). Text over the map
  is dark on white pills.

### 8.12 i18n keys (`apps/web/src/platform/localization/i18n.ts`)

Add each key to the en block (after the `atm.registerImport.*` keys) and to the ar block (same place).
Strings in «» are from the approved mockups unless marked *(new)*. Every Arabic string must pass
`node scripts/check-formal-arabic.mjs`; only `edit.snapHelp` needs the whitelist entry in DM-43.

**Navigation, cards, audit verbs**

| Key | en | ar |
|---|---|---|
| `atm.nav.map` | Machines Map | خريطة الماكينات |
| `atm.cards.map` | Every machine on the map, divided into zones. | الماكينات على الخريطة مقسّمة إلى قطاعات. *(new)* |
| `systemAdmin.users.audit.atmMapLocationSync` | Synced machine locations from the register | مزامنة مواقع الماكينات من سجل الماكينات *(new)* |
| `systemAdmin.users.audit.atmMapLinkResolve` | Resolved Google short links | تحويل روابط Google المختصرة *(new)* |

(The audit labels are required for every verb, `system-admin/system-admin-i18n.spec.ts:121`;
precedent at `i18n.ts:6354-6355, 14731-14732`.)

**Map page (`atm.map.*`)**

| Key | en | ar |
|---|---|---|
| `title` | Machines map | خريطة الماكينات |
| `aria` | Machines and zones map | خريطة الماكينات والقطاعات *(new)* |
| `figures.label` / `.onMap` / `.inZones` / `.outZones` / `.unlocated` | Map figures / On the map / Inside zones / Outside zones / No location | أرقام الخريطة *(new)* / على الخريطة / داخل القطاعات / خارج القطاعات / بدون موقع |
| `actions.unlocated` / `actions.editZones` | Machines without a location / Edit zones | ماكينات بدون موقع / تعديل القطاعات |
| `filters.bank` / `.area` / `.zone` / `.status` / `.location` / `.all` / `.search` | Bank / Area / Zone / Status / Location / All / Machine ID or name | البنك / المنطقة / القطاع / الحالة / الموقع / الكل / رقم الماكينة أو اسمها |
| `filters.bankNone` / `.zoneNone` / `.zoneMulti` | No bank set / No zone / In more than one zone | بنك غير محدد / بلا قطاع / في أكثر من قطاع |
| `status.active` / `.archived` / `.all` | In operation / Archived / All | قيد التشغيل / مؤرشفة / الكل |
| `location.located` / `.review` | On the map / Needs review | على الخريطة / يحتاج إلى مراجعة |
| `panel.branch` / `.branchAll` / `.zones` / `.zonesSearch` | Branch / All branches / Zones ({{count}}) / Search zones | الفرع / كل الفروع / القطاعات ({{count}}) / بحث في القطاعات |
| `panel.summaryIn` / `.summaryOut` / `.summaryUnlocated` | Inside zones: / Outside zones: / No location: | داخل القطاعات: / خارج القطاعات: / بدون موقع: |
| `panel.toggle` / `.narrowNote` | Side panel / Zone editing is available on wider screens only. | اللوحة الجانبية *(new)* / تعديل القطاعات متاح على الشاشات الأعرض فقط. *(new)* |
| `layers.title` / `.pins` / `.zones` / `.names` / `.faded` | Layers / Show machines / Show zones / Show zone names on the map / Faded streets (zone colours stand out) | الطبقات / إظهار الماكينات / إظهار القطاعات / إظهار أسماء القطاعات على الخريطة / شوارع باهتة (لتظهر ألوان القطاعات أوضح) |
| `layers.colorBy` / `.byZone` / `.byBank` / `legend.bank` | Colour machines by: / Zone / Bank / Bank colours | تلوين الماكينات حسب: / القطاع / البنك / ألوان البنوك *(new)* |
| `count.zero` / `.one` / `.two` / `.few` / `.many` | No machines / 1 machine / 2 machines / {{count}} machines / {{count}} machines | لا ماكينات / ماكينة واحدة / ماكينتان / {{count}} ماكينات / {{count}} ماكينة |
| `detail.back` / `.edit` / `.byBank` / `.byArea` / `.machines` / `.overlapsOthers` | Back to zones / Edit / By bank / By area / Machines / Partly inside other zones: {{count}} | رجوع إلى القطاعات / تعديل / حسب البنك / حسب المنطقة / الماكينات / يقع جزء منه في قطاعات أخرى: {{count}} *(new)* |
| `popup.close` / `.branch` / `.zone` / `.zoneMulti` / `.source` / `.lastSet` | Close / Branch / Zone / In more than one zone: {{names}} — counted for «{{primary}}» / Location source / Location last set | إغلاق / الفرع / القطاع / في أكثر من قطاع: {{names}} — يُحتسب على «{{primary}}» *(new)* / مصدر الموقع / آخر تحديث للموقع *(new)* |
| `popup.openRegister` / `.openGoogle` / `.move` | Open in the ATM register / Open in Google Maps / Move location | فتح في سجل الماكينات / فتح في خرائط Google / تحريك الموقع |
| `source.registerUrl` / `.registerShortLink` / `.registerCoordinates` / `.registerPlusCode` / `.registerShortCode` / `.manual` | From the location link / From the location link / From the coordinates in the register / From a Plus Code / From a short Plus Code / Set by hand | من رابط الموقع / من رابط الموقع / من الإحداثيات في السجل *(new)* / من رمز Plus Code / من رمز Plus Code مختصر *(new)* / يدويًا |
| `empty.noZones` / `.drawFirst` / `.noMatch` / `.noBranches` | No zones have been drawn yet. / Draw the first zone / No machines match the filters. / Your access covers no branch. | لم تُرسم أي قطاعات بعد. *(new)* / رسم أول قطاع *(new)* / لا توجد ماكينات مطابقة للتصفية. *(new)* / لا يشمل نطاق صلاحيتك أي فرع. *(new)* |
| `tilesFailed` | Streets could not be loaded. Zones and machines are shown on a blank background. | تعذّر تحميل الشوارع. تظهر القطاعات والماكينات على خلفية فارغة. *(new)* |
| `controls.fitAll` / `.zoomIn` / `.zoomOut` / `scale.m` / `scale.km` | Show all / Zoom in / Zoom out / {{n}} m / {{n}} km | عرض الكل / تكبير / تصغير / {{n}} م / {{n}} كم |
| `search.unlocated` / `search.notFound` | Machine {{code}} has no location on the map. / No machine has this ID or name. | الماكينة {{code}} بلا موقع على الخريطة. *(new)* / لا توجد ماكينة بهذا الرقم أو الاسم. *(new)* |
| `palette.indigo` … `palette.violet` | Indigo, Mustard, Raspberry, Mint, Plum, Sky, Olive, Coral, Petrol, Orchid, Ochre, Violet | نيلي، خردلي، توتي، نعناعي، برقوقي، سماوي، زيتوني، مرجاني، بترولي، أوركيدي، أُكر، بنفسجي |

**Editing (`atm.map.edit.*`, `atm.map.draw.*`, `atm.map.vertex.*`)**

| Key | en | ar |
|---|---|---|
| `edit.banner` / `.unsaved` | Zone editing — {{branch}} branch / Unsaved changes: {{count}} | وضع تعديل القطاعات — فرع {{branch}} / تغييرات غير محفوظة: {{count}} |
| `edit.undo` / `.redo` / `.discard` / `.save` / `.exit` | Undo / Redo / Discard changes / Save changes ({{count}}) / Leave editing | تراجع / إعادة / إلغاء التغييرات / حفظ التغييرات ({{count}}) / خروج من التعديل |
| `edit.branchLocked` / `.newZone` / `.selected` / `.name` / `.color` / `.custom` / `.suggested` | Branch: / New zone / Selected zone / Zone name / Colour / Custom colour / Suggested | الفرع: / قطاع جديد / القطاع المحدد / اسم القطاع / اللون / لون مخصص / مقترح *(new)* |
| `edit.inside` / `.insideWas` / `.points` | Machines inside the zone: {{count}} / (was {{count}}) / Points: {{count}} | الماكينات داخل القطاع: {{count}} / (كانت {{count}}) / عدد النقاط: {{count}} |
| `edit.deleteVertex` / `.dragHint` / `.deleteZone` / `.pickHint` | Delete the selected point / Drag it to move it / Delete zone / Pick a zone on the map or in the list to edit it, or press «New zone» to draw one. | حذف النقطة المحددة / اسحبها لتحريكها / حذف القطاع / اختر قطاعًا من الخريطة أو من القائمة لتعديله، أو اضغط «قطاع جديد» لرسم قطاع. |
| `edit.snap` / `.snapToggle` / `.snapDistance` / `.snapHelp` | Snapping / Snap to a point or zone / Snap distance: {{count}} px / A point shared by two zones moves in both, so no gap appears between them. Hold Alt while dragging to separate it. | الالتصاق / الالتصاق بنقطة أو قطاع / مسافة الالتصاق: {{count}} بكسل / النقطة المشتركة بين قطاعين تتحرك فيهما معًا، فلا تظهر فجوة بينهما. اضغط Alt أثناء السحب لفصلها. |
| `edit.list` / `.sortAz` / `.moveUp` / `.moveDown` / `.priorityHelp` | Zones ({{count}}) / Sort A–Z / Move up / Move down / Where two zones overlap, a machine counts for the zone higher in the list. | القطاعات ({{count}}) / ترتيب أبجدي / تحريك لأعلى / تحريك لأسفل / عند تداخل قطاعين تُحتسب الماكينة للقطاع الأعلى في القائمة. |
| `edit.overlap` / `.defaultName` / `.chooseBranch` / `.branchNotEditable` | Overlaps «{{name}}»; machines in the overlap: {{count}} / Zone {{n}} / Pick a specific branch in the top bar before editing zones. / Your zone-editing access does not cover this branch. | يتداخل مع «{{name}}»؛ في منطقة التداخل {{count}} / قطاع {{n}} *(new)* / اختر فرعًا محددًا من القائمة العلوية قبل تعديل القطاعات. *(new)* / لا تشمل صلاحية تعديل القطاعات هذا الفرع. *(new)* |
| `draw.title` / `.step1` / `.step2` / `.step3` | Draw a new zone / Click the map to add a point. / Repeat until the area is enclosed. / Click the first point or press «Finish» to close the shape. | رسم قطاع جديد / انقر على الخريطة لإضافة نقطة. / كرّر حتى تحيط بالمكان المطلوب. / انقر على النقطة الأولى أو اضغط «إنهاء» لإغلاق الشكل. |
| `draw.points` / `.inside` / `.insideChip` / `.hint` | Points: {{count}} / · Machines inside the shape: {{count}} / Machines inside the shape: {{count}} / Click to add a point, then click the first point to close the shape | عدد النقاط: {{count}} / · الماكينات داخل الشكل: {{count}} / الماكينات داخل الشكل: {{count}} / انقر لإضافة نقطة، ثم انقر على النقطة الأولى لإغلاق الشكل |
| `draw.finish` / `.undoPoint` / `.cancel` / `.needThree` / `.closeShape` | Finish / Undo point / Cancel / At least three points are needed / Close the shape | إنهاء / تراجع عن النقطة / إلغاء / يلزم ثلاث نقاط على الأقل / إغلاق الشكل |
| `draw.cancelled` / `.crossing` / `.added` / `.tooSmall` | Shape discarded. / A zone's border may not cross itself. / Zone added. Change its name and colour in the panel, then save the changes. / The zone is too small; it must cover at least 100 m². | أُلغي الشكل. / لا يجوز أن تتقاطع حدود القطاع مع نفسها. / أُضيف القطاع. غيّر اسمه ولونه من اللوحة، ثم احفظ التغييرات. / القطاع صغير جدًا؛ يجب ألا تقل مساحته عن 100 متر مربع. *(new)* |
| `vertex.label` / `.shared` / `.delete` / `.minThree` / `.midpoint` | Point {{n}} of {{zone}} / Point shared with {{names}} / Delete point / A zone needs at least three points / Zone point — drag it to add a point | نقطة رقم {{n}} في {{zone}} / نقطة مشتركة مع {{names}} / حذف النقطة / يلزم القطاع ثلاث نقاط على الأقل / نقطة قطاع — اسحبها لإضافة نقطة *(new)* |
| `save.title` / `.counts` / `.colZone` / `.colBefore` / `.colAfter` / `.deleted` | Review the changes before saving / New zones {{created}} · changed {{updated}} · deleted {{deleted}} / Zone / Before / After / Deleted | مراجعة التغييرات قبل الحفظ / قطاعات جديدة {{created}} · معدّلة {{updated}} · محذوفة {{deleted}} / القطاع / قبل / بعد / محذوف |
| `save.orphaned` / `.back` / `.confirm` / `.saved` | Machines that will have no zone: {{count}} / Back to editing / Save / Changes saved and recorded in the audit log. | ماكينات ستصبح بلا قطاع: {{count}} / الرجوع إلى التعديل / حفظ / حُفظت التغييرات، وسُجّلت في سجل التدقيق. |
| `conflict.title` / `.body` / `.reload` / `.close` | Could not save / Another user changed the zones after you started editing. Your draft is kept on this device; load the latest version, then apply your changes again. / Load the latest version / Close | تعذّر الحفظ *(new)* / عدّل مستخدم آخر القطاعات بعد بدء تعديلك. مسودتك محفوظة على هذا الجهاز؛ حمّل النسخة الأحدث ثم أعد تطبيق تغييراتك. / تحميل النسخة الأحدث / إغلاق |
| `deleteZone.title` / `.body` / `.back` / `.confirm` | Delete «{{name}}»? / {{count}} will have no zone, unless inside another zone. / Back / Delete | حذف «{{name}}»؟ / ستصبح {{count}} بلا قطاع، إلا إذا كانت داخل قطاع آخر. / رجوع / حذف |
| `discard.body` / `leave.body` / `draft.found` / `draft.restore` / `draft.ignore` / `draft.outdated` | Discard all unsaved changes? / You have unsaved changes. Leave without saving? / An unsaved draft from an earlier session exists. / Restore the draft / Ignore it / The saved draft is older than the current zones and cannot be restored. | إلغاء كل التغييرات غير المحفوظة؟ / لديك تغييرات غير محفوظة. هل تريد المغادرة دون حفظ؟ / توجد مسودة غير محفوظة من جلسة سابقة. / استعادة المسودة / تجاهلها / المسودة المحفوظة أقدم من القطاعات الحالية، ولا يمكن استعادتها. *(new)* |

**Moving a pin and the unlocated screen (`atm.map.move.*`, `atm.map.unlocated.*`, `atm.map.parse.*`,
`atm.map.links.*`, `atm.map.sync.*`)**

| Key | en | ar |
|---|---|---|
| `move.hint` / `.zone` / `.confirm` / `.cancel` / `.clickHint` / `.markerAria` | Drag the marker to the right place / · Zone: {{zone}} / Confirm location / Cancel / Click the location of machine {{code}} on the map / Machine {{code}} marker — drag it to adjust | اسحب العلامة إلى الموقع الصحيح / · القطاع: {{zone}} / تأكيد الموقع / إلغاء / انقر على مكان الماكينة {{code}} على الخريطة / علامة الماكينة {{code}} — اسحبها لضبط الموقع |
| `move.dialogTitle` / `.distance` / `.zoneChange` / `.reason` / `.reasonRequired` / `.back` / `.ok` / `.done` | Confirm the move / The location moved {{km}} km / Zone: {{from}} ← {{to}} / Reason for the move / Give a reason: the move is over 1 km. / Back / Confirm / Machine {{code}} located — zone: {{zone}}. The change is recorded in the audit log. | تأكيد تحريك الموقع *(new)* / تحرّك الموقع {{km}} كم / القطاع: {{from}} ← {{to}} / سبب التحريك / اذكر سبب التحريك لأن المسافة تزيد على 1 كم. *(new)* / رجوع / تأكيد / حُدِّد موقع الماكينة {{code}} — القطاع: {{zone}}. سُجّل التغيير في سجل التدقيق. |
| `unlocated.title` / `.progress` / `.back` / `.search` / `.empty` / `.sourceLabel` | Machines without a location / Located {{done}} of {{total}} / Back to the map / Machine ID or name / Every machine has a location on the map. / Location in the register: | ماكينات بدون موقع / تم تحديد موقع {{done}} من {{total}} / رجوع إلى الخريطة / رقم الماكينة أو اسمها / كل الماكينات لها موقع على الخريطة. / الموقع في السجل: |
| `unlocated.reviewNote` / `.farNote` / `.approve` / `.correct` / `.approved` | Short Plus Code; the location was estimated relative to the branch. Check it on the map, then approve or correct it. / The location is far from the branch's other machines; check it carefully. / Approve location / Correct / Location of machine {{code}} approved. | رمز Plus Code مختصر؛ حُدِّد الموقع تقريبيًا بالنسبة إلى الفرع. راجعه على الخريطة ثم اعتمده أو صحّحه. / الموقع بعيد عن ماكينات الفرع الأخرى؛ راجعه بعناية. *(new)* / اعتماد الموقع / تصحيح / اعتُمد موقع الماكينة {{code}}. *(new)* |
| `unlocated.paste` / `.read` / `.place` / `.openOriginal` | Paste a full link, coordinates or a Plus Code / Read / Place on the map / Open the original link | الصق رابطًا كاملًا أو إحداثيات أو رمز Plus Code / قراءة / وضع على الخريطة / فتح الرابط الأصلي |
| `reason.review` / `.shortLink` / `.shortLinkFailed` / `.noCoordinates` / `.unreadable` / `.none` | Needs review / Short link / Could not convert / Link without coordinates / Unreadable text / No location | يحتاج إلى مراجعة / رابط مختصر / تعذّر التحويل / رابط بدون إحداثيات / نص غير مقروء / بلا موقع |
| `reason.invalidCoordinates` / `.shortPlusCodeNoReference` / `.noEntry` / `.conflictingEntries` / `.notSynced` | Invalid coordinates / Short code without a reference / No open register entry / More than one open entry / Not yet read from the register | إحداثيات غير صالحة / رمز مختصر بلا مرجع / لا يوجد سجل مفتوح / أكثر من سجل مفتوح / لم يُقرأ من السجل بعد *(all new)* |
| `parse.ok` / `.shortLink` / `.noCoordinates` / `.unreadable` / `.invalidCoordinates` | Coordinates read. Drag the marker to adjust it if needed, then press «Confirm location». / This is a short link with no coordinates. Open it, copy the full link from the address bar and paste it here. / The link is for a named place and has no coordinates. Place the marker by hand on the map. / The location could not be read. Paste a full link or coordinates such as 30.0444, 31.2357. / The coordinates are not valid. | تمت قراءة الإحداثيات. اسحب العلامة لضبطها إن لزم، ثم اضغط «تأكيد الموقع». / هذا رابط مختصر لا يحمل إحداثيات. افتحه، ثم انسخ الرابط الكامل من شريط العنوان والصقه هنا. / الرابط لمكان مسمّى ولا يحمل إحداثيات. ضع العلامة يدويًا على الخريطة. / تعذّرت قراءة الموقع. الصق رابطًا كاملًا أو إحداثيات مثل 30.0444, 31.2357. / الإحداثيات غير صالحة. |
| `parse.outsideEgypt` / `.shortPlusCodeReview` / `.shortPlusCodeNoReference` | The location is outside Egypt; check it before saving. / Short Plus Code; the location was estimated relative to the branch. Check it before confirming. / Short Plus Code, and no located machine in the branch to recover it from. Paste the full code or place the marker by hand. | الموقع خارج حدود مصر؛ تأكّد منه قبل الحفظ. / رمز Plus Code مختصر؛ حُدِّد الموقع تقريبيًا بالنسبة إلى الفرع. راجعه قبل التأكيد. *(new)* / رمز Plus Code مختصر ولا توجد ماكينات محددة الموقع في الفرع لاستنتاج موقعه. الصق الرمز الكامل أو ضع العلامة يدويًا. *(new)* |
| `linkFailure.timeout` / `.noCoordinates` / `.httpStatus` / `.tooManyRedirects` / `.hostNotAllowed` / `.network` / `.invalidUrl` | The connection timed out. / The link leads to a named place without coordinates. / The server answered with an unexpected code. / The link exceeded the allowed number of redirects. / The link leads to a site that is not allowed. / The server could not be reached. / The link is not valid. | انتهت مهلة الاتصال. / يؤدي الرابط إلى مكان مسمّى بلا إحداثيات. / ردّ الخادم برمز غير متوقع. / تجاوز الرابط عدد التحويلات المسموح. / يؤدي الرابط إلى موقع غير مسموح. / تعذّر الاتصال بالخادم. / الرابط غير صالح. *(all new)* |
| `links.title` / `.body` / `.start` / `.stop` / `.retry` / `.progress` / `.done` | Convert short links automatically / The server opens each short link once and reads the coordinates. Whatever cannot be converted stays in the list to be placed by hand. / Start converting / Stop converting / Retry the links that failed / {{done}} of {{total}} / Conversion finished: {{resolved}} converted, {{failed}} could not be and stay in the list to be placed by hand. | تحويل الروابط المختصرة تلقائيًا / يفتح الخادم كل رابط مختصر مرة واحدة ويقرأ الإحداثيات. ما يتعذّر تحويله يبقى في القائمة لوضعه يدويًا. / بدء التحويل / إيقاف التحويل *(new)* / إعادة محاولة ما تعذّر تحويله *(new)* / {{done}} من {{total}} / اكتمل التحويل: حُوِّل {{resolved}}، وتعذّر {{failed}} فبقي في القائمة لوضعه يدويًا. |
| `sync.title` / `.body` / `.start` / `.pending` / `.last` / `.done` | Sync locations from the ATM register / The sync reads each machine's location from the two location columns of the ATM register. It does not change a location set by hand or approved unless the register's location text changed. / Start syncing / Waiting to sync: {{count}} / Last sync: {{at}} / Sync finished: {{located}} located, {{review}} need review, {{unlocated}} still without a location. | مزامنة المواقع من سجل الماكينات / تقرأ المزامنة مواقع الماكينات من خانتي الموقع في سجل الماكينات، ولا تغيّر موقعًا حُدِّد يدويًا أو اعتُمد إلا إذا تغيّر نص الموقع في السجل. / بدء المزامنة / بانتظار المزامنة: {{count}} / آخر مزامنة: {{at}} / اكتملت المزامنة: حُدِّد موقع {{located}}، ويحتاج {{review}} إلى مراجعة، وبقي {{unlocated}} بلا موقع. *(all new)* |

Existing keys are reused where they say the same thing: `atm.common.bank`, `atm.common.machineId`,
`atm.common.machineName` and `atm.common.area` (`atm-i18n.spec.ts:16-19`).

---

## 9. Tests

All workbook-like fixtures are **synthetic** (codes 1001–1050, «ماكينة تجريبية n», «منطقة تجريبية n»; the
research checked that none of these codes occurs in the workbook).

### 9.1 Contracts — `packages/contracts/src/modules/atm-map-geometry.spec.ts`, `atm-map.spec.ts` (NEW)

- **`pointInPolygon`:** inside, outside, exactly on an edge (inside), on a vertex (inside), a concave
  "C" with the point in the notch (outside), a point east of the ring at the same latitude as a vertex
  (no double count).
- **`segmentsIntersect` / `selfIntersects`:**
  - bow-tie `[(0,0),(1,1),(1,0),(0,1)]` → true;
  - a square → false;
  - consecutive edges touching at a shared vertex → false;
  - a collinear back-track → true;
  - a 500-point regular polygon → false within 50 ms.
- **`polygonsOverlap`:**
  - disjoint → false;
  - a shared full edge (snapped borders) → false;
  - only a shared vertex → false;
  - a crossing → true;
  - containment → true;
  - a vertex 1e-8° inside the other polygon's edge → false (ε).
- **`polygonAreaM2`:** a 0.001° square at 30°N ≈ 10,707.8 m² (±0.5 %); 0.0001° ≈ 107.1 m²; 0.00009°
  ≈ 86.7 m², which `zoneGeometryIssues` reports as `TOO_SMALL`.
- **`zoneGeometryIssues`:** 2 points `TOO_FEW_POINTS`; 501 `TOO_MANY_POINTS`; a repeated consecutive
  point and last = first `DUPLICATE_POINT`; a bow-tie `SELF_INTERSECTION`.
- **Schemas:**
  - `SaveAtmMapZoneSetSchema`: duplicate tempId refused; an id both updated and deleted refused; an
    update naming no field refused; a 61-character name refused; the name trimmed; the colour
    `#ABCDEF` becomes `#abcdef`; `#abc` refused; a 200-entry `order` accepted and 201 refused.
  - `PlaceAtmMachineLocationSchema` discriminates on `mode`; lat 91 refused; `version: null` accepted.
  - The palette has 12 unique hexes, and exactly the 5 light colours are `cased`.

### 9.2 API unit — `apps/api/src/modules/atm/map/**` (NEW)

- **`location/plus-code.spec.ts`:** every vector in §4.1; round trip `decode(encode(p)).centre` within
  half a cell for 5 Egyptian points; uppercase and lowercase give the same result; each invalid code is
  refused by `isValidCode`.
- **`location/maps-text.spec.ts`:**
  - URL shapes:
    - the place `!3d!4d` beats `@` (the `maps-link.spec.ts:29-35` case);
    - `?q=`, `?q=loc:`, `ll=`, `api=1&query=`;
    - `/maps/search/30.0444,+31.2357`;
    - `/maps/place/30.0444,31.2357`;
    - `@centre` only;
    - a DMS place (30.044389, 31.235694);
    - `maps.app.goo.gl/x` and `goo.gl/maps/x` → `shortLink`;
    - `goo.gl/other` → `noCoordinates`;
    - a named place → `noCoordinates`;
    - `https://example.com/@30,31` → `noCoordinates` (no digit mining);
    - `plus.codes/8G2H26VP+Q7` → `plusCode`;
    - `maps.app.goo.gl/abc` without a scheme → `shortLink`.
  - Plain text:
    - `30.0444, 31.2357` and `30.0444،31.2357` → coordinates;
    - `91, 0` → `invalidCoordinates`;
    - `8G2H26VP+Q7` → `plusCode`;
    - `26VP+Q7 القاهرة` → `shortPlusCode` (`26VP+Q7`);
    - `hello` → `unreadable`;
    - two URLs in one cell → two candidates in order.
  - Distances: `haversineMeters((30.0444,31.2357),(30.0534,31.2357))` ≈ 1000.76 and `…(30.0533,…)`
    ≈ 989.64.
  - Egypt: `insideEgypt` true for Cairo and for Aswan (24.0889, 32.8998); false for (0,0) and (21.0, 31.0).
- **`location/derive.spec.ts`:**
  - every row of the ranking table (§4.3), including "AV coordinates beat an AP full code", "a full
    code beats a short link", "a resolved link beats a short code" and "a short code with an
    unresolved link returns the link to queue";
  - reference by area vs by branch; the median ignores an outlier;
  - a review pin and a `registerShortCode` pin are excluded from the reference;
  - no reference → `shortPlusCodeNoReference`;
  - `farFromReference` at 30.0 km+;
  - `noEntry`, `conflictingEntries`, and equal texts across two open entries → derived;
  - every row of the precedence table, including "pinned + changed text + unlocated → pin kept,
    sourceText updated".
- **`location/short-link-resolver.spec.ts`** (fake `hop`/`sleep`/`now`):
  - `http://maps.app.goo.gl/x` is requested as `https:`;
  - `https://maps.app.goo.gl@evil.example/x`, `https://evil.example/x`, `https://1.2.3.4/x` and
    `https://maps.app.goo.gl:8443/x` never call `hop`;
  - a 302 whose Location carries `!3d!4d` resolves after exactly **one** hop;
  - two redirects then a coordinates URL resolve;
  - six redirects give `tooManyRedirects` after 5 hops;
  - a Location to `evil.example` gives `hostNotAllowed` and is not requested;
  - `consent.google.com?continue=<encoded maps URL with !3d!4d>` resolves without a request to
    `consent.google.com`;
  - a 200 on a named-place URL gives `noCoordinates`; a 404 gives `httpStatus`; an `AbortError`
    gives `timeout`;
  - `cancel()` is called on every response;
  - `sleep(300)` happens between links but not after the last;
  - a batch of 25 processes 20; the 40 s budget stops early with `stoppedByBudget`.
- **`map-scope.spec.ts`:**
  - `mapScopeMatch`: organization `{}`; branch → home; department reach → `departmentBranchIds`;
    section → home branch; own → `NEVER_MATCH`;
  - contrast: the machine repository's widening (`orgScopeMatch` without options) gives `{}` for a
    department selector;
  - `narrowToBranch`: out of reach throws `ValidationError` with `OUT_OF_REACH`, in reach gives
    `{ branchId }`;
  - `writableBranches` drops branches `keyReachesBranch` refuses.

### 9.3 API integration — `apps/api/tests/integration/atm-map.spec.ts` (NEW)

The setup follows `atm-machines-filter.spec.ts` (replica set, `bootPlatform`, `mkUser`, grants per
scope). Run it with `cd apps/api && MONGOMS_SYSTEM_BINARY=/opt/mongod/mongod npx vitest run
tests/integration/atm-map.spec.ts`. Cases:

1. **Permissions:** with no `atmMap.view`, `GET /points|/zones|/context` → 403; with no
   `atmZone.manage`, `PUT /zones` → 403; with no `atmMachine.locate`, every `/locations/*` and
   `/machines/*` route → 403. Super-admin holds all three after boot (`seedAtm`).
2. **Read scope:**
   - an Alex `branch` viewer sees only Alex points and zones;
   - an Alex `department` viewer sees Alex only, while the same grant on `/atm/machines` widens — the
     contrast is asserted;
   - an `own` viewer gets `points: []` and `branches: []`;
   - an organization viewer with `x-active-branch: Tanta` sees Tanta only;
   - `?branchId=<Tanta>` for the Alex viewer → 400 `OUT_OF_REACH`; for the organization viewer it
     narrows;
   - archived machines are hidden by default, shown with `status=archived`; deleted machines never
     appear.
3. **Zone save:**
   - first save `revision: 0` with 2 creates → revision 1, `order` as sent, 2 `create` audits with
     `entityType: 'mapZone'`;
   - an update (name + points) + a delete + a reorder in one request → revision 2, one `update` and one
     `delete` audit, and the deleted zone is gone from `GET`;
   - revision 1 again → 409 `ATM_MAP_ZONES_STALE` and the database is unchanged;
   - **two concurrent saves** with the same revision → exactly one 200 and one 409;
   - a bow-tie, 2 points, 501 points, lat 91 and an area < 100 m² → 400 with field paths;
   - duplicate names, including "  قطاع  أ " vs "قطاع أ" → 400 `DUPLICATE_NAME`;
   - a swap of two names in one save → 200;
   - an id from another branch → 400 `UNKNOWN_ZONE`; an `order` missing an id → 400 `ORDER_MISMATCH`;
   - `body.branchId ≠` the top bar → 400 `BRANCH_MISMATCH`;
   - an organization editor with no top-bar branch in a multi-branch company → 422;
   - an Alex `branch` editor saving with `x-active-branch` = Tanta still files under Alex (the
     switcher only narrows) → `BRANCH_MISMATCH` when the body says Tanta;
   - an editor whose `atmZone.manage` is department-scoped → 403;
   - a 1.1 MB body → 413.
4. **Sync:** fixtures are open entries with synthetic AP/AV for: URL coordinates, a full code, a
   short code in a branch with located pins, a short code in an empty branch, a short link, another
   link, unreadable text, empty cells, a machine without an open entry, and an exempt pair with
   differing texts.
   - Assert each document's status, source and reason, and `needsReview` for the short code.
   - A second sync → `changed: 0`.
   - Exactly **one** audit row `atmMapLocationSync`.
   - A department-scoped `locate` → 403 from the write check, or an empty writable set → 400 when a
     branch is named.
5. **Precedence:**
   - a manual pin + sync with the same text → kept;
   - change AP on the entry (through the register service) + sync → re-derived;
   - change AP to `''` + sync → the pin is kept and `sourceText` updated.
6. **Pins:**
   - `PUT` with `version: null` creates (audit `create`, `entityId = machineId`);
   - a stale version → 409; `version: null` when a document exists → 409;
   - a move of 1000.76 m without a reason → 400 `REQUIRED`, and 989.64 m without a reason → 200;
   - `mode: 'text'` with a short link → 400 `shortLink`;
   - `approve` on a review pin → `needsReview: false`, `pinned: true`; `approve` again → 422;
   - a key that does not reach the machine's branch → 403.
7. **Detail:** `sourceText` is visible with `atmRegister.view` over the branch and `null` without it.
8. **Resolver:** with `setShortLinkHopForTests`:
   - a resolved link → `registerShortLink` located;
   - a failure → `shortLinkFailed` with its failure code;
   - 25 pending → 20 attempted, `remaining: 5`;
   - one `atmMapLinkResolve` audit row, with no URL in its changes;
   - a link already claimed (`claimedAt` now) is skipped by a parallel call.
9. **Summary:** the counts match the points; `pendingSync` counts a machine created after the sync and
   an entry whose AV changed.
10. **Indexes:** `migrateAtmIndexes()` builds `ux_machine`, `ux_branch`, `ix_branch_order`,
    `ix_branch_status` and `ix_branch_link`; a second run reports them `alreadyPresent`.

Existing specs that must stay green unchanged:
- `platform/realtime/realtime-registry.spec.ts` (the new literal entity pairs are classified);
- `infrastructure/http/outbound-only-fetch.spec.ts`;
- `sync-indexes.models.spec.ts`;
- `shared/open-operation.spec.ts`;
- `app-csp.spec.ts` (no CSP change).

### 9.4 Web — `apps/web/src/modules/atm/**` (NEW, node environment)

- **`lib/map-geometry.spec.ts`:**
  - `zoneMembership` picks the first in order (D-M7) and ignores other branches' zones;
  - `snapTarget`: a vertex inside the threshold beats an edge; nothing outside it; the threshold
    boundary (12 px inside, 12.01 outside);
  - `linkedVertices` finds equal 6-decimal keys only;
  - `insertOnEdge` skips a near-duplicate;
  - `midpoints` hides edges < 40 px;
  - `wouldCrossWhileDrawing` refuses the 4th dot of a bow-tie.
- **`lib/zone-editor.spec.ts`:**
  - every transition in §8.6;
  - `FINISH_DRAW` refused below 3 points and for `TOO_SMALL`;
  - undo/redo across 101 gestures keeps 100;
  - a shared-vertex drag moves both zones and Alt moves one;
  - `buildZoneSetSave`: only changed fields; reorder-only produces just `order`; a new zone gets a
    tempId; deletes are listed;
  - `dirtyCount` counts each zone once;
  - `SAVED` clears history;
  - `CONFLICT` keeps the draft.
- **`lib/map-labels.spec.ts`:** the label moves off a pin cluster at the centroid; hidden < 80 px or zoom
  < 9; the lower-listed label is dropped on collision.
- **`lib/map-cluster.spec.ts`:** grid groups at zoom 12; none at 15; identical points stack at any zoom;
  spiderfy radius.
- **`lib/map-colors.spec.ts`:** `suggestColor` skips used colours and then picks the least used;
  `needsCasing` true for the 5 light colours and false for indigo; `bankColor(null)` is grey.
- **`lib/map-filters.spec.ts`:** URL round trip; `status` default `active`; `zones=none,multi`;
  `pruneStale` removes zone ids not offered; figures.
- **`lib/map-count-text.spec.ts`:** 0, 1, 2, 3, 10, 11 and 100 in both locales.
- **`lib/map-shortcuts.spec.ts`:** `KeyN` maps on an Arabic layout (by `code`); nothing maps inside an
  `input`; ctrl+`KeyZ` with shift → redo.
- **`lib/zone-draft-storage.spec.ts`:** a storage that throws on read or write is survived; an outdated
  revision is detected.
- **`lib/map-scale.spec.ts`:** nice numbers and the m/km switch.
- **`lib/unlocated-view.spec.ts`:** chip counts hide zeros; every parse result maps to an existing
  i18n key.
- **`atm-map-i18n.spec.ts`:** every key in §8.12 resolves in `en` and `ar`; so do every palette name,
  every reason, every source and every link failure.
- **`map-page.spec.tsx`** (`renderToStaticMarkup`, the `machines-page.spec.tsx` harness):
  - a viewer without `atmZone.manage` / `atmMachine.locate` gets no «تعديل القطاعات» and no
    «ماكينات بدون موقع», and the «بدون موقع» chip is not a link;
  - the canvas renders its Suspense fallback;
  - the page has no subtitle.
- **`unlocated-page.spec.tsx`:** chips and cards render for a locate holder; «الموقع في السجل» is
  absent when `sourceVisible` is false.
- **Updated, existing:**
  - `atm-i18n.spec.ts` (the overview card through `ATM_SHORTCUTS`);
  - `shared/lib/remembered-filters-coverage.spec.ts` (§7.5);
  - `platform/realtime/realtime.spec.ts` (green with the §6.7 rows);
  - `system-admin/system-admin-i18n.spec.ts` (the two verbs).

### 9.5 Gates (both WPs, before hand-off)

```
npm run lint
npm run typecheck
npm run test -w packages/contracts
npm run test:unit -w apps/api
npm run test -w apps/web
cd apps/api && MONGOMS_SYSTEM_BINARY=/opt/mongod/mongod npx vitest run tests   # final gate: all of tests/
npm run check:page-registry
npm run check:permission-matrix
node scripts/check-formal-arabic.mjs
npm run check:secrets
npm run build
npm run format:check
```

---

## 10. GAP register and rollout

### 10.1 GAP register

| # | Unknown | What v1 does |
|---|---|---|
| GM-1 | Can the production API host reach Google (`maps.app.goo.gl`, `www.google.com`) at all? How does Google answer a server request from that region: a consent interstitial (EU egress), a captcha, or a place page without coordinates? | The resolver handles a consent redirect by parsing `continue` only (§5.1). Everything else fails into `shortLinkFailed` with a reason, and those machines go to the manual list. **Verify on deploy** (§10.2 step 5). |
| GM-2 | Do OSM tiles load in the production build under helmet's `no-referrer`? (The dev server sends no CSP or referrer headers, research `ecms-ui.md` §3.) | The new map sets `referrerPolicy: 'strict-origin-when-cross-origin'` (DM-28). `BranchMapPicker` is unchanged and keeps its current behaviour. Verify both screens on deploy. |
| GM-3 | Does the OSM tile service accept this traffic (usage policy, no SLA)? | A few office users is light use. The tile-failure banner covers outages. Any provider change is a CSP + `app-csp.spec.ts` change (`:17, 37-67`). |
| GM-4 | The research counts (877 / 18 / 163 / 713 / 26 / 5 / 805) come from the workbook snapshot, not production data. | The real numbers are whatever the first sync reports. |
| GM-5 | Workbook cells whose hyperlink target differs from their visible text: the import kept only the text (`read-register-workbook.ts:410`). Column AX (21 Google Maps URLs) is not imported (register EG-4). | Not recovered. Such machines land in the manual list. |
| GM-6 | Live updates for branch-scoped viewers (audit signals carry no `branchId`, `audit.service.ts:179`). | Organization-wide viewers get signals; branch-scoped viewers refetch. The zone-set 409 is the guard between editors. |
| GM-7 | The place names after 82 short Plus Codes cannot be geocoded offline. | Ignored. The reference comes from located machines (DM-34), and without one the reason is `shortPlusCodeNoReference`. |
| GM-8 | Branches whose machines spread over more than ±0.5° (Asyut, Tanta, Port Said; research `ux.md` §6) may recover a short code into the wrong 1° cell. | Every short-code pin needs review, with `farFromReference` beyond 30 km. A person approves or corrects it. |
| GM-9 | Coordinates written in swapped order can still fall inside the Egypt box. | Not detected (no auto-swap, no invention). A visual review on the map is the check. |
| GM-10 | There is no page that opens one register entry. | The popup links to `/atm/register?q=<code>` (`RegisterPage.tsx:107`; `register.service.ts:205-210`). |
| GM-11 | Two open entries for one machine (exempt pairs, register EG-8). | `conflictingEntries` unless the texts are equal; the machine is placed by hand. |
| GM-12 | What zones should become after v1 (written to the legacy `zone`, assigned to crews or vehicles; the sample's "fleet" meaning). | D-M8: display only. Revisit in v1.1 with Split and Cut. |
| GM-13 | Touch editing: Alt (to unlink a vertex or suspend snapping) does not exist on touch screens. | Snapping can be turned off in the panel. The touch toggle is deferred (DM-25). |
| GM-14 | Cross-branch shared borders: zones are per branch, so one branch's zones cannot snap to another's. | By design (D-M6); recorded. |
| GM-15 | The bank of an archived machine (it has no open entry). | «بنك غير محدد» (DM-17). |
| GM-16 | An `own` grant of `atmMap.view` shows nothing (DM-10). | §10.2 step 2 tells administrators. |
| GM-17 | There is no `map` icon in the app's icon set. | The nav row and card use `pin` (`app-icon.tsx:73`). |
| GM-18 | Canvas dots are not keyboard-focusable. | Lists and search give keyboard access (§8.11). |
| GM-19 | Leaflet drawing, clustering and labelling libraries are not installed, and npm registry reachability was not tested. | Everything is in-house and pure (DM-26). No dependency is added. |

### 10.2 Rollout

1. **Deploy.** The pre-deploy step `db:sync-indexes` reports, or builds when `INDEX_SYNC_MODE=apply`,
   the five new indexes (`railway.json:8`). Boot also builds them through `migrateAtmIndexes`
   (`atm.seed.ts:27`), grants the three keys to super-admin (`atm.seed.ts:17-19`), and inserts the nav
   row «خريطة الماكينات» (`syncNavigationCatalog`).
2. **Grant the keys (administrator).**
   - `atmMap.view`: `branch` scope to branch supervisors and Operations, `organization` to HQ. Do not
     grant `own` (GM-16).
   - `atmZone.manage`: `branch` scope to the supervisors who draw zones.
   - `atmMachine.locate`: `branch` or `organization` to the data officers. Department and section
     grants never write (§7.1).
   - Holders of `atmMachine.locate` who should see the raw register text also need `atmRegister.view`.
3. **Run the sync.** On «ماكينات بدون موقع» → «بدء المزامنة», once per branch, or once organization-wide
   with no top-bar branch. Check the toast counts against the research figures (GM-4).
4. **Review the short-code pins** («يحتاج إلى مراجعة»): approve or correct them.
5. **Verify Google egress (GM-1).** Run «بدء التحويل» once and look at the first call's result. If every
   link fails with `network` or `hostNotAllowed`, read the API's warn logs (refusals are logged by
   `outbound.ts:306-317`). Fix the host's egress, or leave the links to the manual flow. Once one call
   resolves links, run until `remaining = 0`, then use «إعادة محاولة ما تعذّر تحويله» once.
6. **Place the rest by hand** through the paste box or «وضع على الخريطة».
7. **Draw the zones** for each branch, with the branch chosen in the top bar.
8. **Verify the tiles** in the production build on `/atm/map` and on the operations catalogs screen
   (GM-2).

---

## Appendix A. Work packages and file ownership

### WP-M1 — contracts + API (first)

**New files:**
- `packages/contracts/src/modules/atm-map.ts` + `atm-map.spec.ts`
- `packages/contracts/src/modules/atm-map-geometry.ts` + `atm-map-geometry.spec.ts`
- `apps/api/src/modules/atm/map/`:
  - `zone.model.ts`, `zone-set.model.ts`, `machine-location.model.ts`
  - `map-scope.ts` (+ spec)
  - `location/plus-code.ts`, `location/maps-text.ts`, `location/derive.ts`,
    `location/short-link-resolver.ts` (+ a spec each)
  - `map.service.ts`, `zone.service.ts`, `location.service.ts`
  - `map.controller.ts`, `map.routes.ts`
- `apps/api/tests/integration/atm-map.spec.ts`

**Modified files:**
- `packages/contracts/src/index.ts` (2 exports)
- `packages/contracts/src/errors/index.ts` (2 codes)
- `packages/contracts/src/platform/audit.ts` (2 verbs)
- `apps/api/src/modules/atm/atm.module.ts` (§7.1)
- `apps/api/src/modules/atm/atm.module.spec.ts` (§7.2)
- `apps/api/src/modules/atm/atm-indexes.ts` (§3.4)
- `apps/api/src/platform/realtime/realtime-registry.ts` (§6.7)
- `apps/api/src/seed-navigation.ts` (§7.3)

**Not touched:** `machine.*`, `register*`, `outbound.ts`, `app.ts` (no CSP or body-limit change),
`atm.seed.ts`.

### WP-M2 — web (after WP-M1's contracts build)

**New files:**
- `apps/web/src/modules/atm/api/map-api.ts`, `api/map-queries.ts`
- `pages/MachineMapPage.tsx`, `pages/UnlocatedMachinesPage.tsx`
- `components/map/*` (§8.8)
- `lib/*` (§8.5) and their specs
- `atm-map-i18n.spec.ts`, `map-page.spec.tsx`, `unlocated-page.spec.tsx`

**Modified files:**
- `routes.tsx` (§8.1)
- `pages/AtmOverviewPage.tsx` (§7.4)
- `platform/localization/i18n.ts` (§8.12)
- `platform/realtime/invalidation-registry.ts` (§6.7)
- `shared/lib/remembered-filters-coverage.spec.ts` (§7.5)
- the module CSS for `.atm-map-faded`
- `scripts/check-formal-arabic.mjs` (`FORMAL` += `'بينهما'`, DM-43)

**Not touched:** `operations/components/BranchMapPicker.tsx`, `operations/lib/maps-link.ts`,
`shared/ui/toast/*`.
