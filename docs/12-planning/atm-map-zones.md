# ATM machine map and owner-drawn zones — implementation spec

**Status:** implementation spec. The owner's decisions D-M1…D-M8 are final (approved 2026-10-18: «موافق على
المقترح كله، ابدأ»). **Approved mockups:** https://claude.ai/artifact/EoEQQMfQqGNggExu4UNcDL (three boards:
«خريطة الماكينات», «رسم وتعديل القطاعات», «ماكينات بدون موقع»). **Target:** ECMS module `atm`; this
manifest grows and no second one is added (`apps/api/src/modules/atm/atm.module.ts:1-9`).
**Revision 2:** revised after three critics (security, data, UI). Every finding and what was done with
it is listed in the **Review log** at the end.

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
- Review log

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
| DM-2 | Re-deriving from the register never overwrites a manual or approved pin unless that machine's AP/AV source text changed since the pin was set (brief default). The text the pin was set against is stored on its own as `pinText`, which only place and approve write. What the last sync read is stored separately as `seenText` (§3.3), and a sync never touches `pinText`. **Refinement:** a changed text that yields NO location (empty, unreadable, or an unresolved link) never erases a pin. The pin stays, `seenText` is updated, and a new short link is queued. When that link later resolves, the text still differs from `pinText`, so the resolved point replaces the pin. | Erasing a human's correct pin because a cell was cleared would lose data that exists. Keeping `pinText` apart lets a later resolution still see that the register moved. |
| DM-3 | The map shows active machines (`isActive`, not deleted) by default (brief default). | — |
| DM-4 | A pin derived from a SHORT Plus Code is placed but flagged «يحتاج إلى مراجعة» until someone with `atmMachine.locate` approves or corrects it (brief default). A short code that a person pastes and confirms (§6.5 Place) is placed by that person, so the confirmation is the review: `needsReview: false`, and `reviewedBy/reviewedAt` = that person. | — |
| DM-5 | **Location lives in its own collection `atm_machine_locations`, one document per machine** — not on `atm_machines` (§3.3). | Master writes are versioned by `__v` (`machine.service.ts:70-81`; `shared/base/base.repository.ts:432-459`). A location write on the machine would make every Operations edit in flight fail with 409, and the first sync would bump 2,607 versions. The machine audit snapshot is shared with register coupling (`register-coupling.ts:60-67`; `machine.service.ts:63`). Location fields would leak into those diffs and into `AtmMachineDto` (`packages/contracts/src/modules/atm.ts:70-91`), which `atmMachine.view` holders read, while D-M5 gates locations by `atmMap.view`. A separate collection also gets its own indexes, audit entity and realtime topic. Archive and delete need no change: a location keyed by `machineId` survives archive and reactivation (D2 of the register spec), and the map reads only machines that are not deleted. |
| DM-6 | A zone is one document in `atm_map_zones`. Its polygon is an open ring of `{lat,lng}` objects with 3–500 points, rounded to 6 decimals, and the first point is not repeated at the end. | `{lat,lng}` is the repository's own point shape (`OperationsLocationSchema`, `packages/contracts/src/modules/operations.ts:171-180`), and 6 decimals is the precedent (`BranchMapPicker.tsx:26-33`). No geo query is needed, so there is no GeoJSON and no `2dsphere` index (a `2dsphere` index would also reject the self-intersecting drafts an editor passes through). |
| DM-7 | Optimistic concurrency of a branch's zone set uses one counter document per branch, `atm_map_zone_sets.revision`. Every save carries the revision the editor loaded. A mismatch returns **409 `ATM_MAP_ZONES_STALE`** and writes nothing. | Two editors have no presence or live notice (realtime does not reach branch-scoped users, §6.7), so this is the only guard (critic §S3). |
| DM-8 | Zone names are unique per branch, compared after trimming, collapsing spaces and case-folding. Uniqueness is enforced **in the service, under the revision check**, not by a unique index. | One save may swap two names (A→B, B→A). A unique index would refuse the intermediate state inside the transaction, and the revision CAS already serialises all writers of a set. |
| DM-9 | Zone membership is computed **in the browser** with the shared pure geometry (§8.5), over the points the caller can read. Only zones of the machine's own branch count, and the first zone in `order` wins (D-M7). | The server needs no membership in v1 (D-M8). Counts can never include another branch's machines, because the browser holds only points in reach. |
| DM-10 | Map read scope = the register's rule: finer scopes narrow to the branch (`registerScopeMatch`, `apps/api/src/modules/atm/register/register.repository.ts:21-25`). A department copy granted by delegation (ADR-032) narrows to the branch that copy sits in, so it reads the **whole** of that branch (`org-scope-match.ts:93-98`; `shared/types/index.ts:245-249`). It does **not** use the machine repository's default, which widens department- and section-scoped grants to the whole company (`machines/machine.repository.ts:6-10` → `shared/base/base.repository.ts:143-157` → `shared/base/org-scope-match.ts:79-82, 111`). **`own` reads nothing** (`NEVER_MATCH`, `org-scope-match.ts:42-44`). | Map rows are machines, created by whoever ran the coupling. Under "own = createdBy", the map would show an arbitrary subset. Reading nothing is the fail-closed answer, and §10.2 tells administrators not to grant `own`. |
| DM-11 | A `branchId` query parameter outside the caller's reach answers **400** (`ValidationError`, detail `{ field: 'query.branchId', code: 'OUT_OF_REACH' }`). It is never silently widened, and it never returns an empty set either. | The parameter may only narrow. A 400 makes a stale or forged parameter visible to the developer, where an empty map would read as "no machines". (The register's `branch-options` answers 403 for the same situation, `register.service.ts:1171-1177`. Here 403 stays reserved for "you lack the key".) |
| DM-12 | A zone save is filed under `resolveZoneEditBranch(ctx)` (§6.2). It returns the top-bar branch when the caller can both read and edit it; otherwise the caller's only editable branch; otherwise nothing, with a reason (`chooseBranch` → 422, `branchNotEditable` → 403). `GET /context` uses the same function, so the branch the editor loads is the branch the save is filed under. The body also carries `branchId`, but only as a **consistency check**: if it differs from the resolved branch, the answer is 400 `BRANCH_MISMATCH`. | D-M6 says the branch comes from the top bar or the caller's only branch. `resolveAtmBranchId` (`atm-context.ts:19-30`) is not used. Its `currentBranchId` puts the home branch before an organization-wide caller's top-bar choice (`shared/types/index.ts:295-303`) and takes its reach from every key (`:297`), while reads narrow an organization grant to the top bar (`:230-232`). An editor would then load one branch and save another (GM-20). The consistency check stops a tab whose top-bar choice changed in another tab (`BranchSwitcher.tsx:76-85` reloads only that tab) from saving one branch's draft over another branch. |
| DM-13 | Location derivation runs only on the server, as pure functions (§4). It is stored, and it is re-run by an explicit, audited **sync** action (§6.5). It is **not** hooked into the register's write paths. | The register and coupling transactions (`register.service.ts:562, 786, 925`) stay untouched (D-M8, "no data is rewritten"). The summary reports how many machines are waiting for a sync (`pendingSync`). |
| DM-14 | The paste box sends the text to a server parse endpoint (§6.5), which is the single parser. The browser holds no copy of the parser. | "The server re-parses every pasted link" (critic §Security). This also avoids a second copy of the Plus Code decoder in the web bundle. |
| DM-15 | Batch actions (sync, link resolution) write **one run audit row per call**, under two new verbs `atmMapLocationSync` and `atmMapLinkResolve`. The run row lists every changed machine id (at most 5000). A batch that replaces a **pinned** point (precedence row 4, §4.3) also writes a per-machine `update` audit for that machine. Interactive pin writes audit **per machine**, with `entityId = machineId`. | This follows the register import's precedent: one run row (DEC-15, `packages/contracts/src/platform/audit.ts:153-165`; `register/import/apply-import.ts:471-480`) beside per-entity audits for the existing records it changes (`:398, 448-462`). A first sync touches about 2,600 machines, almost all unpinned. A pin that a person set is never replaced without its own trail. |
| DM-16 | The status filter is the **machine's** state: «قيد التشغيل» (`isActive`, the default) or «مؤرشفة» (`!isActive`). The mockup's register statuses «بدون تاريخ بدء / تم التسليم» are replaced. **This narrows the owner's approved answer to Q8** («قيد التشغيل افتراضيًا، والباقي من الفلتر.», research `critic.md:349`), so it is recorded as GAP GM-22 for the owner, not as a final decision. | A pending register entry creates no machine: the machine is created on pending → open (`register-coupling.ts:122-127`; statuses `atm-register.ts:153`). There is nothing to place for «بدون تاريخ بدء». A machine is archived by a handover OR by an administrator (`machine.service.ts:253`), so «تم التسليم» would be wrong for some machines. «مؤرشفة» is a **new** label: the existing `i18n.ts:16480` reads «مؤرشفة في قائمة التشغيل». |
| DM-17 | The bank on the map is the **register's** `bankCode`, taken from the machine's open entry. With several open entries it is their common code, or `null` when they differ. That gives the 6 codes plus «بنك غير محدد» when there is none. | Colour-by-bank needs the code (`atm-register.ts:44-51`). The machine's `bankName` is free text (`atm.ts:78-79`). Archived machines have no open entry, so they show «بنك غير محدد». |
| DM-18 | Moving a located pin by more than **1 km** needs a reason, which the server enforces. The confirm dialog shows the distance and the zone change. | Critic §S4. A slip of the mouse at a low zoom level is the likely error. |
| DM-19 | Source labels: «من رابط الموقع» (URL, resolved short link), «من الإحداثيات في السجل» (plain coordinates, *new*), «من رمز Plus Code» (full code), «من رمز Plus Code مختصر» (short code, *new*) and «يدويًا» (any pin or paste set by a person). | The mockup's three labels plus the two kinds of source it did not draw. |
| DM-20 | The popup adds one row for pins that a person set. A manual pin shows «آخر تحريك للموقع: name · date» (`setByName/setAt`; the approved plan's label, research `critic.md:247`). An approved pin shows «اعتُمد الموقع: name · date» (`reviewedByName/reviewedAt`). | The data is stored (§3.3), and reading the audit log once per popup would cost a query (critic §Audit). For an approved pin, `setByName` is the sync's actor, not the approver. |
| DM-21 | Machine counts use the mockup's five forms «لا ماكينات / ماكينة واحدة / ماكينتان / n ماكينات / n ماكينة», chosen by this rule: 0, 1 and 2 have their own forms; «n ماكينات» when n ≥ 3 and n % 100 is 3–10 (3, 10, 103, 1003); «n ماكينة» for every other n (11, 100, 101, 102, 111). This replaces the `{{count}} ماكينة` precedent (`i18n.ts:16379`). | The approved mockup uses these forms (`Edit.dc.html` script) and agrees with the rule up to 100; above 100 the rule follows the Arabic plural categories. They are five plain keys, so no plural engine is needed (`translate`, `i18n.ts:16799-16810`). |
| DM-22 | A new zone's default name is «قطاع {{n}}», where n is the smallest positive integer for which «قطاع n» is not yet a name in the draft under DM-8's normalisation. New zones are appended at the **bottom** of the list, which is the lowest priority under D-M7. | The mockup's letter names (أ…ل) were placeholder data (critic §Placeholder data) and stop at 12. "Count + 1" would repeat «قطاع 3» when zones 1 and 3 exist. Putting a new zone at the bottom never takes machines away from an existing zone silently. |
| DM-23 | «تغييرات غير محفوظة: n» and «حفظ التغييرات (n)» use the approved mockup's formula (`Edit.dc.html:536-544`): created + changed (geometry, name or colour) + deleted, plus 1 when the relative order of the surviving zones changed and no zone was changed (`orderChanged && changed === 0`). | It is the approved mockup's number, and Sort A–Z on 12 zones shows 1, not 12. The audit still records every zone whose order changed (§6.5). |
| DM-24 | Edit mode shows only the edit branch's zones. Machine markers become small dots that cannot be clicked, so they never take a grab away from a handle. | Snapping onto a zone the user cannot edit must never change that zone (critic §Writes), and every zone that is displayed in edit mode is editable. |
| DM-25 | **Deferred with Split and Cut (v1.1):** «قص التداخل» (trim overlap), moving a whole zone, the colour-proximity warning, zone CSV export, dragging a row onto the map, and the touch toggle «إيقاف الالتصاق مؤقتًا». | None of them is in the approved mockups. Trim needs polygon clipping (no library is installed, research `ux.md` §7). D-M7 allows overlaps, and the overlap warning stays. |
| DM-26 | Clustering is a small in-house grid: 56 px cells below zoom 15, and machines at the same point (≤ 1 m apart) fan out ("spiderfy") on click. No `leaflet.markercluster`. | No cluster library is installed (`apps/web/package.json:14-51`), and the brief prefers small tested code to new dependencies. |
| DM-27 | Zone fills, outlines, halos and casings and the machine dots are all drawn on **one shared Leaflet canvas renderer** (`L.canvas()`, passed as `renderer` to every one of them). Zones are added first and dots after, so a dot wins a click, and no SVG renderer is created. Review pins, cluster bubbles, zone labels and edit handles are DOM `divIcon`s whose elements are built with `document.createElement` + `textContent`, **never** an HTML string that contains user data. The popup is a React overlay, not `L.popup` HTML. | About 2,600 DOM markers would be slow. In one pane Leaflet's canvas sits under its SVG (`leaflet.css:116-117`), interactive SVG paths take pointer events (`:252-255`), and the canvas hit-tests only events that reach its own element (`leaflet-src.js:12919-12931`). SVG zones over canvas dots would therefore swallow every click on a dot inside a zone. Machine and zone names are data that users typed, and BranchMapPicker's string `html` (`BranchMapPicker.tsx:35-39`) is safe only because it holds no data. |
| DM-28 | The tile URL and attribution are promoted to `apps/web/src/shared/lib/osm-tiles.ts`. BranchMapPicker imports the same values (`BranchMapPicker.tsx:67-70`), so it does not change. The map adds `referrerPolicy: 'strict-origin-when-cross-origin'` (ATM only) and an attribution control with `prefix: false`, so only «© OpenStreetMap» shows, as in the mockups. An Arabic scale bar is our own component. «شوارع باهتة» is a CSS filter on the tile pane. | "Never copy-paste across modules" (`docs/02-architecture/module-structure.md:120-122`). Helmet sends `Referrer-Policy: no-referrer` by default (`node_modules/helmet/index.mjs:183`, not overridden at `app.ts:157-165`). Leaflet's tile `referrerPolicy` defaults to false (`leaflet-src.js:12101-12107, 12178-12179`), and OSM's policy expects a Referer (GM-2). Leaflet's default attribution prefix is a Leaflet link (`leaflet-src.js:5758-5762`). Leaflet's own scale control is English only. |
| DM-29 | Leaving with unsaved changes is guarded four ways. A `beforeunload` prompt covers closing the tab. A confirm covers the page's own links. While the draft is dirty, a capture-phase `document` click listener sends every same-origin `a[href]` click (the sidebar rows are `NavLink` anchors, `Sidebar.tsx:17, 727`) through the same confirm. A draft is kept in `localStorage` **per user and branch** and restored only when its base revision equals the server's revision. | `useBlocker` does not work under `<BrowserRouter>` (`apps/web/src/platform/app/App.tsx:103`, react-router 6.30.6). Switching modules calls `navigate()` (`Sidebar.tsx:916-921`), which is not an anchor; the stored draft protects that case and the idle logout. |
| DM-30 | Layer toggles, colour-by and snap settings are remembered per viewer in `localStorage` (`ecms.atmMap.layers`, `ecms.atmMap.snap`), wrapped in try/catch. They are not URL filters. | These are view preferences, not filters (`useRememberedFilters.ts:8-14`), and the same try/catch precedent applies (`useRememberedFilters.ts:48-64`). |
| DM-31 | Toasts have no action button (`shared/ui/toast/toast-store.ts:50-55`), so «أُلغي الشكل.» is informational and cannot be undone. | That is the mockup's exact string, and the toast store is not extended. |
| DM-32 | The zone colour schema is local to the new contracts file and stores colours lowercase. `HEX_COLOR` in `hr-contract.ts:521` is left module-private. | This feature does not touch HR contracts. |
| DM-33 | The resolver's Google host policy is passed **per call** to `outboundFetch`. The hosts are not added to `NAMED_SAAS_HOSTS` (`infrastructure/http/outbound.ts:57-62`). | This is narrower: no other api caller can reach Google. |
| DM-34 | The reference point for a short Plus Code is the **median** of located pins in the same branch and same area, falling back to the same branch. One pure function, `referenceFor(pool, branchId, area, selfId)`, serves Parse and Sync. The pool contains only location documents with `status: 'located'`, `needsReview: false`, `source ≠ 'registerShortCode'` and `warnings: []`, whose machine is not deleted, and never the machine itself. For an even count the median is the mean of the two middle values. The warning `weakReference` is added when the basis has fewer than 3 pins, or when any basis pin lies more than 0.4° from the reference in lat or lng. | Never another branch, never invented (brief). The median ignores outliers, and excluding short-code pins avoids chaining one recovery on another. A recovered point always lies within half a cell of its reference (§4.1), so a distance-from-reference warning can never see a wrong-cell recovery. A thin or widely spread basis is what makes one likely. |
| DM-35 | The Egypt bounding box used for the warning is lat 21.7–31.9 and lng 24.6–37.0. It warns and never blocks. | It covers the mainland, Sinai and Halaib with a margin. A pair of coordinates written in swapped order can still fall inside the box (GM-9). |
| DM-36 | The register text parser also reads Google's degrees-minutes-seconds copy format (`30°02'39.8"N 31°14'08.5"E`) and `plus.codes/<code>` links. It reads coordinates from Google Maps hosts and plus.codes only, and it never picks stray digits out of other URLs. | These are Google's own copy formats for a point. Not picking digits out of other URLs is the precedent (`operations/lib/maps-link.spec.ts` "does not mine a non-Maps URL"). The resolver applies the same host rule to every redirect `Location` (§5.1). |
| DM-37 | Up to **200 zones** and **20,000 points** per branch (`ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX`), and at most **20,000 points in one save** (`ATM_MAP_SAVE_POINTS_MAX`, creates + updates). | `selfIntersects` is O(n²) per zone, and the 1 MB body (`app.ts:167`) holds about 30,000 points, so without a point cap one request could block the event loop for seconds. 20,000 points × about 34 B ≈ 680 KB, so a valid save always stays below the body limit. The branch cap also bounds `GET /zones` without `branchId`. |
| DM-38 | The unlocated screen carries a **sync card** («مزامنة المواقع من سجل الماكينات») above the link card. | The mockup assumes the pins already exist. Something has to create them, and D-M5 names the sync as an `atmMachine.locate` action. |
| DM-39 | «تم تحديد موقع n من m» counts the page's selected branch (every branch of the summary scope under «كل الفروع», §6.4). m is the active machines and n is the located pins that are not under review. | The figure stays the same whatever view filter the user has set, and it agrees with the list beside it, which shows the same branch. |
| DM-40 | Below 1024 px the panel moves into a `SideLayer`, on the right in Arabic and the left in English. Editing is offered from 768 px, and below that the page is view only. | `SideLayer.tsx:9-10, 23, 35`. This follows critic §Frame. |
| DM-41 | Keyboard: arrow keys nudge a selected vertex by 1 px, or 10 px with Shift. | Without it, keyboard users cannot edit a zone at all (§8.11). |
| DM-42 | `atmMachine.locate` is declared in its **own** `declarePermissions('atm', 'atmMachine', …, [], [locate], 'atm.map')` call. It therefore sits on the map page, while `atmMachine.view/manage/moveArea` stay on `atm.machines`. | Per-key page placement is how a resource split across two pages is declared (`packages/contracts/src/permissions/def.ts:94-99`). |
| DM-43 | The mockup's snap help text keeps «… فلا تظهر فجوة بينهما …» verbatim, and `'بينهما'` is added to `FORMAL` in `scripts/check-formal-arabic.mjs` (`:60-68`), next to `'بينهم'`. | «بينهما» ("between the two") is formal Arabic that the `بي…` verb-prefix pattern (`:53-57`) catches by accident. The guard's own rule is to list such words one at a time rather than weaken the pattern (`:34-36`). Running the guard's `offendersIn` over every Arabic string in this spec flags only this word. |
| DM-44 | Besides DM-4, a pin is placed with `needsReview: true` in three more cases. **(a)** Only a map viewport gives the point (`/@`, `ll`, `sll`, `center`): warning `viewportOnly`. **(b)** One URL carries two distinct `!3d!4d` pairs more than 50 m apart: `ambiguousUrl`. **(c)** Two locating candidates of the machine (any fields, including two URLs) lie more than 1 km apart: `sourcesDisagree`, and the winner is kept. «اعتماد الموقع» applies to all of them. | The map centre is "never the first choice" and can be "off by hundreds of metres" (`operations/lib/maps-link.ts:47-56`). In the workbook (counts only), 545 of the 568 AV URLs that carry both a pin and a centre differ by more than 50 m. Four AV URLs carry only a centre, 3 AV place URLs carry two distinct pin pairs, and 1 of 63 rows with an AV pin and an AP short code disagrees by more than 5 km. A point the text gives only roughly is placed for a person to confirm, never placed silently. |
| DM-45 | Two writes check that what the person saw still holds. **Approve** answers 409 `ATM_MAP_SOURCE_CHANGED` when the open entries' current text differs from `seenText`, the text the review pin was derived from ("sync first"). **`mode: 'text'`** carries `expected: { lat, lng }` (the previewed point) and answers 409 `ATM_MAP_PARSE_CHANGED` when the server's own parse differs by more than 1 m. | Without the first check, approving would protect a pin derived from out-of-date text forever (DM-2 would then see "equal" text). Without the second, a sync between preview and confirm could move the reference and save a point nobody saw. |
| DM-46 | Link resolution is **one pass**: there is no retry of failed links, no `retryFailed`, and no stop button. A failed link is queued again only when its AV text changes. A run that gets no answer from Google at all stops and leaves its link `pending`, because that link was not opened. "No answer at all" means a DNS failure, a refused connection or a timeout on the first hop, or a 429/503 on any hop. | D-M4: "the SERVER opens each link once". The approved mockup's `convert()` has one pass and no stop or retry (`Unlocated.dc.html:83-87, 280-294`). Stopping on "no answer" keeps a missing egress (GM-1) from marking every link as failed. |
| DM-47 | Throttle (D-M4): one link resolution runs at a time company-wide, held by a cache lease (`getCache().incrWithTtl('lock:atm-map-resolve', 60)`, where count 1 means acquired, released with `del`; `infrastructure/redis/cache.ts:13`). `rateLimit` (`infrastructure/redis/rate-limiter.ts:95-109`, the `recruitment-form.routes.ts:96, 102` pattern) allows per user 10 calls/min on resolve, 6/min on sync and 30/min on zone saves. | The 300 ms pause inside one call throttles nothing across calls or users. A second run while one is active answers `busy: true`. |
| DM-48 | Zone geometry is tested in the plane Leaflet draws: x = lng and y = the Mercator latitude in degrees, `y = (180/π)·ln(tan(π/4 + φ/2))`. This applies to `pointInPolygon` and to the intersection and overlap tests. Area stays equirectangular (§6.1). Every point that enters the editor's draft is rounded to 6 decimals, as the server does. | Leaflet draws straight edges in Web Mercator. At 30°N a 0.5° diagonal edge differs from the lat/lng-plane edge by about 35 m, so a machine drawn inside a zone could count as outside. Rounding in the browser keeps the browser's checks and the server's checks on the same numbers. |

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
export const ATM_MAP_LOCATION_WARNINGS = ['outsideEgypt', 'weakReference', 'viewportOnly',
  'ambiguousUrl', 'sourcesDisagree'] as const;                            // DM-34, DM-35, DM-44
export const ATM_MAP_LINK_FAILURES = ['timeout', 'httpStatus', 'tooManyRedirects', 'hostNotAllowed',
  'consentPage', 'network', 'invalidUrl', 'noCoordinates'] as const;

/** AP/AV as one open-entry set reads them (§4.3 "several open entries"). */
interface AtmMapLocationTexts { plusCode: string | null; url: string | null }

export interface AtmMachineLocationDoc extends BaseDocFields {
  machineId: Types.ObjectId;                 // one live document per machine
  branchId: Types.ObjectId;                  // copied from the machine; a machine's branch never changes
                                             // (UpdateAtmMachineSchema has no branchId, atm.ts:155-163)
  status: 'located' | 'unlocated';
  lat: number | null;                        // 6 decimals; null when unlocated
  lng: number | null;
  source: AtmMapLocationSource | null;       // null when unlocated
  needsReview: boolean;                      // a pin a person must confirm: a short code (DM-4), or
                                             // viewportOnly / ambiguousUrl / sourcesDisagree (DM-44)
  reason: AtmMapUnlocatedReason | null;      // null when located
  warnings: AtmMapLocationWarning[];
  pinned: boolean;                           // manual or approved → protected by DM-2
  pinText: AtmMapLocationTexts | null;       // the open entries' text when the pin was placed or
                                             // approved; written ONLY by place and approve (DM-2)
  pinEntryIds: Types.ObjectId[];             // the open entries at that moment (sorted)
  seenText: AtmMapLocationTexts | null;      // the text the last sync read; null for noEntry and
                                             // conflictingEntries
  seenEntryIds: Types.ObjectId[];            // sorted ids of ALL open entries the last sync read
  sourceField: 'locationUrl' | 'locationPlusCode' | null;       // which column produced the point
  reference: { lat: number; lng: number; basis: 'area' | 'branch' | 'url'; machines: number } | null;
  shortLink: {                               // null when the text holds no link worth resolving
    url: string;                             // (§4.3), and on a pinned document whose current
    status: 'pending' | 'resolved' | 'failed';   // text equals pinText (§6.5 Place/Approve)
    lat: number | null; lng: number | null;
    viewportOnly: boolean;                   // the point came from a map viewport only (DM-44a)
    failure: AtmMapLinkFailure | null;
    attempts: number;                        // 0 or 1: one pass (DM-46)
    lastAttemptAt: Date | null;
    claimedAt: Date | null;                  // §5.4 — a run's atomic claim
  } | null;
  manualText: string | null;                 // the pasted text of a `mode: 'text'` placement (≤ 2048)
  moveReason: string | null;                 // the last move reason (≤ 300)
  setBy: Types.ObjectId | null;              // who last changed the point (a person, or the sync's actor)
  setByName: string | null;                  // `actorName(ctx)` snapshot (atm-context.ts:32-34)
  setAt: Date | null;
  reviewedBy: Types.ObjectId | null;
  reviewedByName: string | null;             // `actorName(ctx)` snapshot of the approver (DM-20)
  reviewedAt: Date | null;
  derivedAt: Date | null;                    // the last sync that EVALUATED this machine, written for
                                             // every evaluated machine whether or not it changed (§6.5)
}
```

When a batch replaces a pinned point (§4.3 row 4), it clears `pinText`, `pinEntryIds`,
`reviewedBy/reviewedByName/reviewedAt`, `manualText` and `moveReason`, and sets `setBy*` to the
batch's actor.

Indexes:

```ts
locationSchema.index({ machineId: 1 }, { unique: true, name: 'ux_machine',
  partialFilterExpression: { isDeleted: false } });
locationSchema.index({ branchId: 1, status: 1, needsReview: 1 }, { name: 'ix_branch_status' });
locationSchema.index({ branchId: 1, 'shortLink.status': 1 }, { name: 'ix_branch_link' });
model 'AtmMachineLocation' → collection 'atm_machine_locations'
```

`pinText`, `seenText` and `shortLink.url` are copies of P-class register text (`atm-register.ts:383,
505, 511`). They contain no K or S value. A DTO returns `seenText` only to a caller who holds
`atmRegister.view` and can read the source register entry (§6.5 Detail), and never returns `pinText` or
`shortLink.url`.

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
- **Exact integer arithmetic.** Inputs are rounded to 6 decimals first, so the cell indices are computed
  from integers: `latInt = (Math.round(lat × 1e6) + 90_000_000) × 25` (units of 1/25,000,000°) and
  `lngInt = Math.floor((Math.round(lng × 1e6) + 180_000_000) × 8192 / 1000)` (units of 1/8,192,000°;
  pair precision 8000 × grid 5⁵ / 4⁵). Both stay below 2⁵³. Clip the latitude to [-90, 90) and
  normalise the longitude to [-180, 180) before rounding. The floating-point form
  `floor((lat + 90) × 25_000_000)` is wrong on cell edges: (22.226405, 36.922625) gives `7GJR6WGF+H2`,
  but the exact code is `7GJR6WGF+H3`, because 216.922625 × 8,192,000 = 1,777,030,144 exactly. Over
  200,000 random Egyptian 6-decimal points, the integer form above agrees with exact fractions every
  time.
- `isValidCode(code)` (case-insensitive):
  - exactly one `+`, at an even index from 2 to 8;
  - only alphabet characters, `0` and `+`;
  - padding `0`s only before `+`, never at index 0, starting at an even index, contiguous, and with
    nothing after `+` when the code is padded;
  - exactly one character after `+` is invalid.
- `isFull(code)`: valid, `+` at index 8, first character's value ≤ 8 (latitude < 180°) and second
  character's value ≤ 17 (longitude < 360°). `isShort(code)`: valid, `+` index < 8, and **not padded**
  (a padded code is never treated as short).
- **Derivation use.** A valid code that is neither full nor short (`WG2H26VP+Q7`: first character
  value 18 > 8) is `unreadable`. A full code with fewer than 10 digits (padded, or nothing after `+`:
  a cell of 0.0025° ≈ 275 m or more) is also `unreadable`, because it does not give a machine's point.
- `encode(lat, lng, length = 10)`, for lengths 2–8 (even, padded with `0` up to `+`), 10, and 11–15.
  The 5 grid digits are computed first, from the least significant end: `row = latInt % 5`,
  `col = lngInt % 4`, `digit = ALPHABET[row × 4 + col]`, then `latInt = floor(latInt / 5)` and
  `lngInt = floor(lngInt / 4)`. The remaining values (units of 1/8000°) give the five pairs, also from
  the least significant end: `ALPHABET[latInt % 20]`, `ALPHABET[lngInt % 20]`, then divide both by 20.
  The code is the pairs, then the grid digits (most significant first), cut to `length`, with `+`
  after the 8th character. The pair resolutions are 20°, 1°, 0.05°, 0.0025° and 0.000125°.
- `decode(code) → { south, west, north, east, lat, lng }`, where (lat, lng) is the cell centre. Decode
  accumulates **integer** offsets in the same units as `encode` and divides once at the end. Tests
  compare with `toBeCloseTo(…, 9)`, because a floating-point sum gives 2.7821249999999997 for the west
  edge of `7FG49QCJ+2V`.
- `recoverNearest(shortCode, refLat, refLng)`: `pad = 8 − indexOf('+')`, `resolution = 20^(2 − pad/2)`,
  `half = resolution / 2`. Decode `encode(ref)[0:pad] + shortCode`. If `ref.lat + half < centre.lat`
  and `centre.lat − resolution ≥ −90`, subtract `resolution`; else if `ref.lat − half > centre.lat` and
  `centre.lat + resolution ≤ 90`, add it. Apply the same rule to the longitude, without the bounds
  check. Return the re-encoded code and its centre. The recovery window is the cell's half width
  around the reference:

  | Characters before `+` | `pad` | resolution | Recovers correctly when the reference lies within |
  |---|---|---|---|
  | 6 | 2 | 20° | ±10° of the true point |
  | 4 | 4 | 1° | ±0.5° (GM-8, GM-9) |
  | 2 | 6 | 0.05° | ±0.025° |

  The recovered point therefore always lies within `half` of the reference on each axis, whatever the
  true point. A distance-from-reference warning cannot detect a wrong cell (DM-34 `weakReference`).

**Test vectors** (derived by hand from the algorithm above, then cross-checked by a separate
exact-fraction script):

| Input | Expected |
|---|---|
| `decode('7FG49QCJ+2V')` | south-west (20.37, 2.782125), north-east (20.370125, 2.78225), centre (20.3700625, 2.7821875) |
| `decode('7FG49Q00+')` | south-west (20.35, 2.75), north-east (20.4, 2.8), centre (20.375, 2.775) |
| `decode('8FVC9G8F+6X')` | centre (47.3655625, 8.5249375) |
| `decode('8FVC9G8F+6XQ')` (11 digits, grid) | south-west (47.365575, 8.52496875), north-east (47.3656, 8.525) |
| `encode(30.0444, 31.2357)` | `8G2H26VP+Q7` → centre (30.0444375, 31.2356875) |
| `encode(30.0444, 31.2357, 11)` (grid) | `8G2H26VP+Q78` → south-west (30.0444, 31.2356875), north-east (30.044425, 31.23571875) |
| `encode(47.36559, 8.524997, 11)` | `8FVC9G8F+6XQ` (inside the cell decoded above) |
| `encode(22.226405, 36.922625)` (cell edge) | `7GJR6WGF+H3` (the floating-point form gives `…+H2`) |
| `encode(31.2001, 29.9187)` / `(27.1809, 31.1837)` / `(31.2653, 32.3019)` | `8G3F6W29+2F` / `7GVH55JM+9F` / `8G3J7882+4Q` |
| `recoverNearest('26VP+Q7', 30.05, 31.20)` | `8G2H26VP+Q7` |
| `recoverNearest('26VP+Q7', 30.6, 31.2357)` | `8G3H26VP+Q7` (centre 31.0444…: the reference lies more than 0.5° from the true point) |
| `recoverNearest('26VP+Q7', 29.5444, 31.2357)` | `7GXH26VP+Q7` (on the 0.5° boundary) |
| invalid (`isValidCode` false) | `8G2H26VP+Q` (one char after `+`), `8G2H26V+PQ7` (odd `+` index), `8G2H26VP+Q7A!`, `8G0H26VP+Q7`, `8G2H2600+Q7`, `0G2H26VP+Q7` (padding at index 0) |
| valid, neither full nor short → `unreadable` | `WG2H26VP+Q7` (first char value 18 > 8) |
| valid full, fewer than 10 digits → `unreadable` | `8G2H2600+`, `8G2H26VP+` |
| padded, never short | `2600+` is not `isShort` |

Hand derivation of `8G2H26VP+Q7`: lat + 90 = 120.0444 and lng + 180 = 211.2357. Pair 1 (÷20) gives
6 → `8` and 10 → `G`, leaving 0.0444 / 11.2357. Pair 2 (÷1) gives 0 → `2` and 11 → `H`, leaving
0.0444 / 0.2357. Pair 3 (÷0.05) gives 0 → `2` and 4 → `6`, leaving 0.0444 / 0.0357. Pair 4 (÷0.0025)
gives 17 → `V` and 14 → `P`, leaving 0.0019 / 0.0007. Pair 5 (÷0.000125) gives 15 → `Q` and 5 → `7`.

### 4.2 `maps-text.ts` — reading one register cell

`readLocationText(raw: string): LocationCandidate[]` returns every candidate found in one cell, in the
order they occur. The cell is trimmed, and an empty cell returns `[]`.

**Hosts.** "A Google Maps URL" means a host matching `^(www\.|maps\.)?google\.(com|com\.eg)$` with
`pathname === '/maps' || pathname.startsWith('/maps/')`, or the host `maps.google.com` with any path.
"A short link" means the host `maps.app.goo.gl`, or `goo.gl` with `pathname === '/maps' ||
pathname.startsWith('/maps/')`. A bare prefix test such as "starts with `/maps`" is not used, because
`goo.gl/mapsXYZ` is a generic goo.gl link. Hosts are compared case-insensitively after removing a
trailing dot.

1. **URLs.**
   - **Finding the token.** A URL is `https?://` followed by non-whitespace, or, without a scheme, one of
     `maps.app.goo.gl/`, `goo.gl/`, `maps.google.com/`, `www.google.com/`, `google.com/` at a word
     boundary anywhere in the cell. A scheme-less URL gets `https://` prefixed. The token ends at
     whitespace. Trailing `) ] } > ' " ، . ؛ , ! ?` are stripped. For a short-link host, the token
     also ends at the first non-ASCII character, because short-link tokens are ASCII and Arabic text
     stuck to the link is not part of it. Other hosts keep non-ASCII characters, because a copied
     place URL may carry the place name unencoded.
   - Each URL is parsed with `new URL()`; a parse failure gives `{ kind: 'unreadable' }`.
   - A short link → `{ kind: 'shortLink', url }` (the token as found).
   - A Google Maps URL → `coordinatesFromGoogleUrl(url)`. It splits what it finds into a **pin**
     (the place's own point) and a **viewport** (where the map was centred; `maps-link.ts:46-56`):
     - **Path decoding.** For each path segment, replace a literal `+` with a space FIRST, then
       percent-decode. Decoding first would turn `/place/26VP%2BQ7+Cairo` into «26VP Q7 Cairo» and
       lose the code. (`plus.codes/` paths are never treated this way; there `+` is the code's own.)
     - **Pins, in this order:**
       1. every `!3d<lat>!4d<lng>` pair in `href`. If two distinct pairs lie more than 50 m apart, the
          first is kept with `needsReview` and the warning `ambiguousUrl` (DM-44);
       2. query parameters `q`, `query`, `destination`, `daddr` whose WHOLE value matches
          `^\s*(loc:)?LAT\s*,\s*LNG\s*(\(.*\))?$` (`?q=Building 26, 30 St` is not a pair);
       3. a `/maps/place/<seg>` or `/maps/search/<seg>` segment that is EXACTLY a pair after decoding;
       4. a DMS pair in a decoded `/place/` segment (DM-36);
       5. a **full** Plus Code (`isFull`, §4.1) in the decoded place/search segment or in `q`.
     - **Viewport:** `/@<lat>,<lng>`, then the parameters `ll`, `sll` and `center`. It is never read on
       `/maps/dir/` URLs.
     - **Results.** A pin → `{ kind: 'coordinates', lat, lng, via: 'url', ambiguous }`, or
       `{ kind: 'plusCode', code }` for a full code. Otherwise, a **short** Plus Code (`isShort`) in
       the place segment or `q` → `{ kind: 'shortPlusCode', code, urlReference }`, where
       `urlReference` is the same URL's viewport when there is one (basis `'url'`, §4.3). Otherwise a
       viewport → `{ kind: 'viewport', lat, lng }` (DM-44). Otherwise → `{ kind: 'noCoordinates' }`.
   - Host `plus.codes` → the first path segment as a Plus Code, classified with `isFull`/`isShort`, or
     `unreadable`.
   - Any other host → `{ kind: 'noCoordinates' }`. Digits are never picked out of other URLs.
2. **Non-URL text** (the remainder once URLs are removed, trimmed):
   - A whole-field decimal pair `^-?\d{1,2}(\.\d+)?\s*[,،]\s*-?\d{1,3}(\.\d+)?$` →
     `{ kind: 'coordinates', via: 'text' }`. The Arabic comma is accepted. This applies only when the
     field is nothing but the pair (`maps-link.ts:106-113`).
   - A DMS pair such as `30°02'39.8"N 31°14'08.5"E` (`′″` accepted) → coordinates (DM-36). Each part
     needs its hemisphere letter. Latitude and longitude are assigned by the letter (N/S = latitude,
     E/W = longitude), in either order; S and W are negative. Minutes and seconds must be below 60,
     otherwise → `unreadable`.
   - A Plus Code token `(?<![0-9A-Z])([2-9CFGHJMPQRVWX]{2,8}0*\+[2-9CFGHJMPQRVWX]{0,7})(?![0-9A-Z])`
     (case-insensitive). If `isFull` (with at least 10 digits), → `{ kind: 'plusCode', code }`. If
     `isShort`, → `{ kind: 'shortPlusCode', code }`. Otherwise → `unreadable` (§4.1 "Derivation use").
     Any trailing place name («… القاهرة») is ignored (GM-7).
   - Anything else → `{ kind: 'unreadable' }`.
3. **Range check.** Coordinates with lat ∉ [−90, 90] or lng ∉ [−180, 180] become
   `{ kind: 'invalidCoordinates' }`. All values are rounded to 6 decimals.

`insideEgypt({lat,lng})` checks the box in DM-35. `haversineMeters(a, b)` uses R = 6,371,008.8 m.

### 4.3 `derive.ts` — choosing a machine's location

```ts
deriveLocation(input: {
  texts: AtmMapLocationTexts | null;   // null = no usable open entry
  entryIds: string[];                  // sorted ids of ALL open entries (→ seenEntryIds)
  entryProblem: 'noEntry' | 'conflictingEntries' | null;
  resolvedLink: { url: string; status: 'resolved' | 'failed'; lat?: number; lng?: number;
                  viewportOnly?: boolean; failure?: AtmMapLinkFailure } | null;   // the doc's shortLink
  reference: (urlReference: LatLng | null) => ReferencePoint | null;   // referenceFor, DM-34
}): Derived   // { status, lat, lng, source, needsReview, reason, warnings, sourceField,
              //   shortLinkUrl, reference, seenText, seenEntryIds }
```

**Reading the register: one helper.** Every read of register text for this feature goes through
`openEntryLocationTexts(machineIds)` in `location.service.ts`:
`AtmRegisterEntryModel.find({ machineId: { $in: machineIds }, isDeleted: false, status: 'open' },
{ _id: 1, machineId: 1, locationUrl: 1, locationPlusCode: 1 }).lean()`, using index
`ix_machine_status` (`register.model.ts:227`). Entries hold `keys`, `receiptNotes` and `handoverNotes`
in the clear plus the `safeCombination` ref (`register.model.ts:59-77, 173-187`). The projection keeps
those fields out of this feature's memory, which is also the logger's rule (`logger.ts:8-13`). The
helper serves the summary, the sync, Place and Approve. The points read keeps its own `{ machineId,
bankCode }` projection (§6.4).

**Which register entry is the source.** For each machine:
- **no open entry** → `entryProblem: 'noEntry'`. This covers an active master with no open entry (the
  import's "active-master-without-open-entry" category, or a machine created by Operations). An active
  machine whose entries are all `ended` is also `noEntry`, and the last ended entry's text is **not**
  used (GM-23).
- **one** → that entry's `locationUrl` / `locationPlusCode`.
- **several.** Only an exempt duplicate pair can produce this (`openPeriodExempt`, `register.model.ts:81,
  206-218`; EG-8). Field by field, collect the non-empty trimmed values across the entries. If each
  field's set has at most one value, use those values. If any field has two different values →
  `entryProblem: 'conflictingEntries'`, with `seenText: null` and `seenEntryIds` = all the ids.

Text comparisons in this section trim values, treat `null` and `''` as equal, and treat a `null` text
as equal to an all-empty pair.

**Candidate ranking.** Candidates from AV (`locationUrl`) come before those from AP
(`locationPlusCode`); within a field they keep their order. The best rank wins, and on equal rank AV
wins:

| Rank | Candidate | Result |
|---|---|---|
| 1 | `coordinates` (url pin or text) | located, `registerUrl` or `registerCoordinates`; `ambiguous` → `needsReview`, warning `ambiguousUrl` (DM-44) |
| 2 | `plusCode` (full, ≥ 10 digits) | located, `registerPlusCode` (cell centre) |
| 3 | `shortLink` with a stored `resolved` result for the same URL | located, `registerShortLink`; a result read from a viewport only → `needsReview`, `viewportOnly` |
| 4 | `shortPlusCode` and a reference exists | located, `registerShortCode`, `needsReview: true`, `reference` stored. The URL's own viewport is the reference when the code came from a URL (basis `'url'`), otherwise DM-34 |
| 5 | `viewport` | located, `registerUrl`, `needsReview: true`, warning `viewportOnly` (DM-44) |
| 6 | `shortLink` not yet resolved | unlocated, `shortLink` (queued, `shortLink.status: 'pending'`) |
| 7 | `shortLink` with a stored `failed` result | unlocated, `shortLinkFailed` |
| 8 | `noCoordinates` | unlocated, `noCoordinates` |
| 9 | `shortPlusCode` without a reference | unlocated, `shortPlusCodeNoReference` |
| 10 | `invalidCoordinates` | unlocated, `invalidCoordinates` |
| 11 | `unreadable` | unlocated, `unreadable` |
| — | no candidate (both cells empty) | unlocated, `none` |
| — | `entryProblem` | unlocated, `noEntry` / `conflictingEntries` |

**Which short link is queued.** `shortLinkUrl` is the first short link among the candidates when that
link is itself the winner (rank 3, 6 or 7), or when the winner ranks 4 or worse, because a resolved
link (rank 3) would outrank it. When a rank 1 or 2 candidate wins, or the text holds no short link,
`shortLinkUrl` is `null`, and the document's `shortLink` is set to `null`. A link nobody needs is
never fetched and never counted.

**Disagreeing sources (DM-44c).** When two candidates that each give a point (after their own
recovery) lie more than 1 km apart, the winner is kept and gets `needsReview: true` with the warning
`sourcesDisagree`.

**Warnings.** `outsideEgypt` is added when a located point is outside DM-35's box. `weakReference` is
added to a rank-4 point whose DM-34 basis is weak (DM-34). A `'url'` basis is never weak, because it
is the same link's own viewport.

**Reference point (DM-34).** `referenceFor(pool, branchId, area, selfId)` is pure. The pool is built
once per request, never per machine. It contains the location documents of the branch with `status:
'located'`, `needsReview: false`, `source ≠ 'registerShortCode'` and `warnings: []`, whose machine is
not deleted, joined to their machine's `area`. The machine `selfId` is left out. If at least one pin
has the same area (trimmed, case-folded) → `basis: 'area'`, and the median lat and median lng of those
pins (for an even count, the mean of the two middle values). Else, if at least one pin exists in the
branch → `basis: 'branch'`. Else `null`. Another branch is never used, and no coordinate is invented
(brief). Sync pass 2 builds its pool from the state **after** pass 1 (§6.5). A machine whose stored pin
pass 1 replaced is therefore counted once, with its new point.

**Re-derive precedence** (`applyDerivation(existing, derived, currentTexts)`, pure):

| # | Existing document | Current text vs `existing.pinText` | New derivation | Outcome |
|---|---|---|---|---|
| 1 | none | — | any | insert the derivation (`pinned: false`) |
| 2 | `pinned: false` | — | any | write the derivation when any stored field differs: point, status, source, `needsReview`, reason, warnings, `sourceField`, reference, `seenText`, `seenEntryIds` or `shortLink.url`. Otherwise keep |
| 3 | `pinned: true` | equal | any | **keep the point** (DM-2); write `seenText`/`seenEntryIds` only when they differ |
| 4 | `pinned: true` | changed | located (rank 1–5) | replace: `pinned: false`, `needsReview` as derived, pin provenance cleared (§3.3), and a per-machine audit (DM-15) |
| 5 | `pinned: true` | changed | unlocated | **keep the pin**; write `seenText`/`seenEntryIds` and queue the new short link, if any (DM-2 refinement) |

The comparison is exact equality of the `{ url, plusCode }` pair under the rule above. Placing or
approving a pin stores the open entries' current texts as both `pinText` and `seenText` (§6.5), so the
pin is protected "since the pin was set". Row 5 never touches `pinText`. When the queued link later
resolves, the current text still differs from `pinText`, so row 4 applies.

---

## 5. Short-link resolver (D-M4) — `apps/api/src/modules/atm/map/location/short-link-resolver.ts`

### 5.1 Rules

- **Server only, admin-triggered** through `POST /atm/map/locations/resolve-links` (`atmMachine.locate`
  + `atmMap.view`, §6.3). Never on a read, never on a schedule. **One pass** (DM-46): every link is
  opened at most once. A failed link is queued again only when its AV text changes, which resets
  `shortLink` (§6.5 Sync step 4).
- **Single flight and throttle (DM-47).** A run first takes the company-wide lease
  `getCache().incrWithTtl('lock:atm-map-resolve', 60)`. Count 1 means acquired. Any other count returns
  `{ attempted: 0, busy: true, … }` without touching a link. The lease is released with
  `getCache().del('lock:atm-map-resolve')` in a `finally`; its 60 s TTL frees it if the process dies.
  The route is also rate-limited per user (§6.3).
- **Batch:** up to `ATM_MAP_LINK_BATCH_MAX = 20` links per call, **sequentially**, with a 300 ms pause
  between links. The **40 s budget** is checked before every link AND before every hop. A run that
  hits it stops with `stopReason: 'budget'`, so the HTTP request finishes. The worst case is 40 s +
  one link's 12 s deadline = 52 s, below the lease TTL and the 60 s claim TTL. The browser calls again
  while `remaining > 0` and the previous call made progress (§8.10).
- **First URL.** It must parse, be `https:` (`http:` is upgraded to `https:` for the same host and path),
  have no userinfo and no explicit port, and be a short link under §4.2's exact host rule
  (`maps.app.goo.gl`, or `goo.gl` with `pathname === '/maps' || pathname.startsWith('/maps/')`).
  Anything else is never requested: `failure: 'invalidUrl'` or `'hostNotAllowed'`.
- **Host allowlist for every hop:** exactly `maps.app.goo.gl`, `goo.gl`, `www.google.com`, `google.com`
  and `maps.google.com`, compared case-insensitively after removing a trailing dot, with
  `hostMatches` (`infrastructure/http/outbound.ts:108-114`) against `GOOGLE_MAPS_LINK_POLICY.allowHosts`.
  No wildcard and no other Google domain. The resolver checks this itself, purely, **before** each hop.
- **DNS, checked by the resolver itself, under the deadline.** Before each hop the resolver calls
  `lookup(host, { all: true, verbatim: true })` from `node:dns/promises`, raced against the hop's
  signal (`raceAbort(promise, signal)`, a small helper in the resolver that rejects with an
  `AbortError`). `ENOTFOUND` or `EAI_AGAIN` → `network`. An address for which `isPrivateAddress`
  (`outbound.ts:212`) is true → `hostNotAllowed`. Otherwise the addresses are handed to `outboundFetch`
  as `lookup: async () => addresses` (`OutboundFetchOptions.lookup`, `outbound.ts:292-297`). Its own
  check (`outboundRefusal`, `:239-270`) then sees the same allowlist and the same addresses and cannot
  refuse, so `assertOutboundAllowed` never logs a resolver URL (`:306-317`). `outbound.ts` is **not
  changed**.
- **Manual redirects, hop limit 5.** Each hop calls `outboundFetch(url, init, { policy:
  GOOGLE_MAPS_LINK_POLICY, maxRedirects: 0, lookup })` (`outbound.ts:323-347`). `outboundFetch` returns
  the 3xx response unchanged when `maxRedirects` is 0 (`:336`).
  `GOOGLE_MAPS_LINK_POLICY = { allowHosts: [the five hosts], pinnedHosts: [], allowPrivate: false }`
  (DM-33; `OUTBOUND_HTTP_ALLOW_PRIVATE` does not apply).
- **Request:** `GET`, headers `{ accept: 'text/html' }` only, `cache: 'no-store'`, `redirect: 'manual'`
  (set by `outboundFetch`). No cookies (Node's fetch has no cookie jar), no `Authorization`, no
  `Referer`. **Deadlines:** each hop runs under `AbortSignal.any([AbortSignal.timeout(5000),
  linkSignal])`, where `linkSignal = AbortSignal.timeout(12000)` is created once per link. The same
  signal covers the DNS lookup above and the `fetch` (Node 22, `package.json:8`). A lookup that never
  answers therefore ends as `timeout` within 5 s.
- **The response body is never read or stored.** Every response body is cancelled with
  `response.body?.cancel()` before the next step.
- **Only URLs are parsed, and only Google Maps URLs (DM-36).** At each 3xx, the `Location` header is
  checked first: longer than 4096 characters → `failed / invalidUrl`. Then it is resolved with
  `new URL(location, current)`, and a throw → `failed / invalidUrl`. Then:
  1. if it is `https:` **and** a Google Maps URL under §4.2's host rule, `coordinatesFromGoogleUrl`
     reads it. A pin → **resolved**. A viewport only → **resolved** with `viewportOnly: true`, which
     the derivation turns into a review pin (§4.3 rank 3). Neither → step 2;
  2. else if its host is on the allowlist and it is `https:` → that URL is the next hop;
  3. else if the host is `consent.google.com` and its `continue` parameter is an `https:` Google Maps
     URL → parse **that string only** (it is never fetched), as in step 1. Nothing found →
     `failed / consentPage`;
  4. else → `failed / hostNotAllowed`. Coordinates are never read from a non-Google `Location`, so
     `https://evil.example/@30,31` is refused as `hostNotAllowed`.

  A 200 response parses the final URL as in step 1: a pin or a viewport → resolved; otherwise
  `failed / noCoordinates` (a named place). Any other status → `failed / httpStatus`. More than 5 hops
  → `failed / tooManyRedirects`. An `AbortError` → `failed / timeout`. Any other error →
  `failed / network`.
- **"No answer at all" stops the run (DM-46).** A `network` or `timeout` failure on the **first hop**
  (the request to the short-link host itself), or a **429 or 503** on any hop, means Google was not
  reached or refused service. The link was not opened: it stays `pending` with `attempts` unchanged,
  its claim is cleared, and the run stops with `stopReason: 'unreachable'` or `'rateLimited'`.
- **Stored:** after a link finishes, the resolver re-reads the document and writes, conditionally on
  `{ _id, __v: reread.__v, isDeleted: false, 'shortLink.url': claimedUrl }` with `$inc: { __v: 1 }`,
  the `shortLink` result `{ status, lat, lng, viewportOnly, failure, attempts: 1, lastAttemptAt,
  claimedAt: null }` and the re-derivation (§4.3 precedence, from the stored `seenText`; the resolver
  never reads the register). A resolved link becomes `registerShortLink` unless a pin is protected. An
  unmatched write is re-read and applied once more; a second miss is counted in `conflicts`. The final
  URL is not stored.
- **Logging:** only `{ host, status, failure }`, never a URL, a path, a query string or an error object.
  Node's `ERR_INVALID_URL` carries the input, which is why `new URL()` failures are caught and mapped to
  `invalidUrl` rather than logged. A short link's path IS its secret-like token, and a place path holds
  the coordinates.

### 5.2 SSRF considerations

- The input is user-typed register text. The URL parser decides the host, so a URL such as
  `https://maps.app.goo.gl@evil.example/` has hostname `evil.example` and is refused before any request.
- IP-literal hosts are refused, because they are not on the allowlist. Every hop is judged again. A
  listed host that redirects to `169.254.169.254` or to an internal name is refused by the allowlist,
  and an allowlisted name that resolves to a private address is refused by the resolver's own DNS
  check before any connection.
- The bound on work is: no body is read, header size is the Node default, a `Location` of at most 4096
  characters, at most 5 hops per link, 5 s per hop including DNS, 12 s per link, 20 links per call, a
  40 s budget checked before every hop, one run at a time company-wide, a per-user rate limit, and the
  endpoint is gated by `atmMachine.locate` and audited.
- **Residual risk (accepted, the same as the platform door):** DNS can rebind between the resolver's
  lookup and the connection `fetch` makes.

### 5.3 Testability

`resolveShortLink(url, deps)` takes `deps: { lookup(host, signal): Promise<string[]>; hop(url: URL,
addresses: string[], signal: AbortSignal): Promise<{ status: number; location: string | null;
cancel(): Promise<void> }>; sleep(ms): Promise<void>; now(): number }`. The default `lookup` wraps
`node:dns/promises` with `raceAbort`, and the default `hop` wraps `outboundFetch` as above. The
service exposes `setShortLinkDepsForTests(deps | null)`, following `setOutboundPolicyForTests`
(`outbound.ts:97-99`), so that integration tests never touch the network or DNS.
`outbound-only-fetch.spec.ts` stays green, because no file other than `outbound.ts` calls `fetch`
(`infrastructure/http/outbound-only-fetch.spec.ts:1-4`; a DNS lookup is not a `fetch`).

### 5.4 Concurrency

- **The lease** (§5.1) means one run at a time company-wide.
- **The claim.** Each link is claimed atomically **immediately before it is fetched**, not up front:
  `findOneAndUpdate({ _id, isDeleted: false, 'shortLink.status': 'pending', $or: [{ 'shortLink.claimedAt':
  null }, { 'shortLink.claimedAt': { $lt: now − 60 s } }] }, { $set: { 'shortLink.claimedAt': now } })`.
  The claim does **not** bump `__v`, so it never makes a person's open pin form stale. A claim that
  matches nothing (another run, or the document changed) skips the link.
- **Ending a run.** A run that stops (budget, rate limit, unreachable) clears `claimedAt` on any link it
  claimed but did not finish. A claim left by a crashed process expires after 60 s, which is above the
  12 s per-link deadline.
- **`remaining`** = the eligible documents (`shortLink.status: 'pending'`, machine active and not
  deleted, in the writable scope) counted after the run, whatever their `claimedAt`.

**Production egress to Google is unverified: GAP GM-1.**

---

## 6. API (WP-M1)

### 6.1 Contracts — `packages/contracts/src/modules/atm-map.ts` (NEW) and `atm-map-geometry.ts` (NEW)

Both are exported from `packages/contracts/src/index.ts` after `atm-register.js` (`index.ts:67-68`).

`atm-map-geometry.ts` holds pure functions, shared by the API (validation) and the web (editor). Every
test except the area runs in the plane Leaflet draws (DM-48): `project({lat,lng}) = { x: lng, y:
(180/π)·ln(tan(π/4 + lat·π/360)) }`. ε = 1e-7 is in those projected degrees.
- `pointInPolygon(p, ring)`: ray casting in the projected plane; a point on the boundary counts as
  inside. A bounding-box test runs first.
- `segmentsIntersect(a, b, c, d)`: true for a proper crossing, and for a collinear overlap of positive
  length.
- `selfIntersects(ring)`: a bounding-box prefilter per edge pair, then:
  - **adjacent edges** (sharing a vertex; the first and last edges are adjacent) intersect when they
    are collinear and overlap beyond the shared vertex (a back-track such as (0,0)→(2,0)→(1,0));
  - **non-adjacent edges** intersect when they have ANY common point, including an endpoint touching
    the other edge;
  - a vertex repeated at two non-consecutive positions (a pinch) is a self-intersection.
- `polygonsOverlap(a, b)`: true when any of these holds:
  - a proper edge crossing;
  - a vertex of one ring strictly inside the other (by more than ε from its boundary);
  - the midpoint of any edge of one ring strictly inside the other;
  - the centroid of either ring strictly inside the other, counted only when that centroid also lies
    inside its own ring (the mockup's `overlaps()`, `Edit.dc.html:354-362`; the guard stops a
    C-shaped zone whose centroid falls in its notch from "overlapping" a zone in that notch);
  - the two vertex sets are equal (a zone duplicated by snapping).
  Shared edges and shared vertices alone are not an overlap. This catches a triangle on a square's own
  vertices and two identical rings, which vertex tests alone miss.
- `polygonAreaM2(ring)`: equirectangular projection about the mean latitude, R = 6,371,008.8 m, shoelace
  formula.
- `zoneGeometryIssues(points) → ('TOO_FEW_POINTS' | 'TOO_MANY_POINTS' | 'DUPLICATE_POINT' |
  'SELF_INTERSECTION' | 'TOO_SMALL')[]`. Duplicates are consecutive points that are equal after
  6-decimal rounding, including last→first. A repeated non-consecutive point is `SELF_INTERSECTION`.
  The minimum area is `ATM_MAP_ZONE_MIN_AREA_M2 = 100`.

`atm-map.ts` holds the constants, schemas and DTOs:

```ts
export const ATM_MAP_ZONE_MIN_POINTS = 3, ATM_MAP_ZONE_MAX_POINTS = 500, ATM_MAP_ZONES_PER_BRANCH_MAX = 200,
  ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX = 20_000, ATM_MAP_SAVE_POINTS_MAX = 20_000,   // DM-37
  ATM_MAP_ZONE_NAME_MAX = 60, ATM_MAP_MOVE_REASON_METERS = 1000, ATM_MAP_LINK_BATCH_MAX = 20,
  ATM_MAP_SYNC_MAX_MACHINES = 5000, ATM_MAP_PARSE_TOLERANCE_METERS = 1;             // DM-45
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
const TempIdSchema = z.string().regex(/^new-[a-z0-9]{1,24}$/);
export const SaveAtmMapZoneSetSchema = z.object({
  branchId: objectId(),                          // consistency check only (DM-12)
  revision: z.number().int().min(0),
  creates: z.array(z.object({ tempId: TempIdSchema,
    name: ZoneNameSchema, color: ZoneColorSchema, points: ZonePointsSchema }).strict()).max(200),
  updates: z.array(z.object({ id: objectId(), name: ZoneNameSchema.optional(),
    color: ZoneColorSchema.optional(), points: ZonePointsSchema.optional() }).strict()).max(200),
  deletes: z.array(objectId()).max(200),
  order: z.array(z.union([objectId(), TempIdSchema])).max(200),   // final order, top = first
}).strict().superRefine(/* unique tempIds; no id both updated and deleted; no duplicate in order,
                          deletes or updates; each update names ≥ 1 field; Σ points over creates +
                          updates ≤ ATM_MAP_SAVE_POINTS_MAX → issue code TOO_MANY_POINTS_IN_SAVE */);
export const ParseAtmMapLocationSchema = z.object({ machineId: objectId(),
  text: z.string().trim().min(1).max(2048) }).strict();
const MoveReason = z.string().trim().min(1).max(300).optional();
export const PlaceAtmMachineLocationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('pin'), lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180), version: z.number().int().min(0).nullable(),
    reason: MoveReason }).strict(),
  z.object({ mode: z.literal('text'), text: z.string().trim().min(1).max(2048),
    expected: z.object({ lat: z.number().finite().min(-90).max(90),        // the previewed point
      lng: z.number().finite().min(-180).max(180) }).strict(),          // (DM-45)
    version: z.number().int().min(0).nullable(), reason: MoveReason }).strict(),
]);
export const ApproveAtmMachineLocationSchema = z.object({ version: z.number().int().min(0) }).strict();
export const SyncAtmMapLocationsSchema = z.object({ branchId: objectId().optional() }).strict();
export const ResolveAtmMapLinksSchema = z.object({ branchId: objectId().optional() }).strict();
```

DTOs (all fields JSON-safe):

```ts
AtmMapContextDto { branches: { id; name: LocalizedString; canManageZones; canLocate }[];
  organizationWide: boolean;            // scopeSelector(ctx,'atmMap.view').scope === 'organization'
                                        // → «كل الفروع» offered (false once the top bar narrows)
  editBranchId: string | null;          // resolveZoneEditBranch (§6.2): where a save is filed
  editBlocked: 'chooseBranch' | 'branchNotEditable' | null }   // why editBranchId is null
AtmMapPointDto { machineId; code; name; branchId; area; bankName; bankCode: AtmBankCode | null;
  active: boolean; lat: number | null; lng: number | null;
  state: 'located' | 'review' | 'unlocated'; source: AtmMapLocationSource | null;
  reason: AtmMapUnlocatedReasonDto | null; warnings: AtmMapLocationWarning[];
  lastSet: { kind: 'moved' | 'approved'; byName: string | null; at: string } | null }
  // DM-20: 'moved' = a manual pin (setByName/setAt); 'approved' = reviewedByName/reviewedAt;
  // null otherwise. No register text, manualText or moveReason is ever in this DTO.
AtmMapPointsDto { points: AtmMapPointDto[]; generatedAt: string }
AtmMapZoneDto { id; branchId; name; color; order; points: { lat; lng }[]; updatedAt: string }
AtmMapZoneSetDto { branchId; revision: number; zones: AtmMapZoneDto[] }
AtmMapZonesDto { sets: AtmMapZoneSetDto[] }
AtmMachineLocationDetailDto { machineId; version: number | null; state; lat; lng; source; reason;
  warnings; needsReview; pinned; reference; shortLink: { status; failure; attempts } | null;
  sourceVisible: boolean; sourceText: { plusCode; url } | null;   // = seenText, when visible
  manualText: string | null; moveReason; setByName; setAt; reviewedByName: string | null;
  reviewedAt; derivedAt }
AtmMapParseResultDto = { ok: true; lat; lng; kind: 'url' | 'coordinates' | 'plusCode' |
  'shortPlusCode' | 'viewport'; needsReview: boolean; warnings: AtmMapLocationWarning[] }
  | { ok: false; reason: 'shortLink' | 'noCoordinates' | 'invalidCoordinates' | 'unreadable' |
      'shortPlusCodeNoReference' }
AtmMapLocationSummaryDto { totalActive; located; review; unlocated;
  byReason: Record<AtmMapUnlocatedReasonDto, number>; pendingSync; shortLinksPending;
  shortLinksFailed; lastSyncAt: string | null }
AtmMapSyncResultDto { processed; changed; located; review; unlocated; kept; conflicts }
  // processed = located + review + unlocated (every active machine evaluated);
  // changed = documents written; conflicts = writes that matched no document because a person
  // wrote it in between (version guard, §6.5); kept = processed − changed − conflicts
AtmMapLinkResolveResultDto { attempted; resolved; failed; remaining; conflicts; busy: boolean;
  stopReason: 'budget' | 'rateLimited' | 'unreachable' | null }
```

(`AtmMapUnlocatedReasonDto` = `ATM_MAP_UNLOCATED_REASONS` + `'notSynced'`.)

**Error codes** (`packages/contracts/src/errors/index.ts`, after the register block `:123-148`):
- `ATM_MAP_ZONES_STALE` (409, DM-7);
- `ATM_MAP_SOURCE_CHANGED` (409, DM-45: approve while the register text moved; "sync first");
- `ATM_MAP_PARSE_CHANGED` (409, DM-45: text-mode placement whose parse moved);
- `ATM_MAP_NOT_UNDER_REVIEW` (422, used with `BusinessRuleError`, `shared/errors/index.ts:63-67`).

Everything else uses the generic classes: `ValidationError` 400 (`:27-31`), `ForbiddenError` 403
(`:39-43`), `StaleDocumentError` 409 `STALE_DOCUMENT` (`:57-61`), `NotFoundError` 404 and
`RateLimitedError` 429 (from `rateLimit`).

**Audit verbs** (`packages/contracts/src/platform/audit.ts`, after `atmRegisterImport` `:164`):
`atmMapLocationSync` and `atmMapLinkResolve`, each with a comment in the style of `:153-162`. They are
not added to `REALTIME_BROADCAST_ACTIONS` (`packages/contracts/src/platform/realtime.ts:19-27`).

### 6.2 Scope helpers — `apps/api/src/modules/atm/map/map-scope.ts` (NEW)

```ts
/** DM-10: the register's rule for every map READ; `own` reads nothing. */
export const mapScopeMatch = (s: ScopeSelector): Record<string, unknown> => {
  if (s.scope === 'own') return { ...NEVER_MATCH };
  const m = orgScopeMatch(s, { branch: 'branchId' }, { finerNarrowsToBranch: true });
  // orgScopeMatch answers `{}` for organization AND for a department reach it cannot place
  // (org-scope-match.ts:99-100). Only the first may read everything.
  if (m === undefined || (Object.keys(m).length === 0 && s.scope !== 'organization')) return { ...NEVER_MATCH };
  return m;
};
/** The branches that match covers: 'all' | ids (registerScopeBranches, register.repository.ts:33-47;
 *  own → []; a non-organization shape that registerScopeBranches calls 'all' (:41) → []). */
export const mapScopeBranches = (s: ScopeSelector): 'all' | string[];
/** DM-11: a browser branch may only narrow. Throws ValidationError OUT_OF_REACH. Returns `{}` when
 *  `branchId` is undefined, else `{ branchId }`. */
export const narrowToBranch = (s: ScopeSelector, branchId: string | undefined): Record<string, unknown>;
/** Writes: the branches among `candidates` this key reaches. 'all' ONLY when
 *  ctx.permissions[key] === 'organization' AND candidates === 'all'; otherwise an explicit list,
 *  enumerated through keyReachesBranch (shared/types/index.ts:210-211) over the candidates (or over the
 *  company's active branches when candidates === 'all'). */
export const writableBranches = (ctx: AuthContext, key: string, candidates: 'all' | string[]): 'all' | string[];
/** D-M6 / DM-12: the ONE branch zones are edited and saved in. */
export const resolveZoneEditBranch = async (ctx: AuthContext):
  Promise<{ branchId: string } | { branchId: null; blocked: 'chooseBranch' | 'branchNotEditable' }>;
```

**Composition.** Every read filter is an `$and`, never an object spread:
`{ $and: [{ isDeleted: false }, mapScopeMatch(s), narrowToBranch(s, b), statusFilter] }`. This is used for
points, zones, the summary, the sync's selection and the resolver's selection. With a spread, a
narrowing that also sets `branchId` would overwrite the scope clause, and safety would rest only on
`narrowToBranch`'s validation.

**`resolveZoneEditBranch(ctx)`** (pure but for one branch query):
1. `readable = mapScopeBranches(scopeSelector(ctx, 'atmMap.view'))`.
2. A branch `b` is **editable** when `keyReachesBranch(ctx, 'atmZone.manage', b)` and (`readable ===
   'all'` or `readable.includes(b)`).
3. If `ctx.activeBranchId` (the top bar, already validated as a live active branch,
   `platform/auth/active-branch.ts:47-70`) is editable → return it.
4. Otherwise the candidates are the editable branches: those in `readable` or, when `readable ===
   'all'`, those among the company's active branches (the list `active-branch.ts:26-29` reads, one
   query). Exactly one candidate → return it. For an organization-wide editor, that is the company's
   only branch. For a branch editor whose map view is organization-wide, it is the home branch.
5. Otherwise → `branchId: null`, with `blocked: 'chooseBranch'` when some branch would be editable
   (the caller must pick one in the top bar), else `'branchNotEditable'`.

Examples:
- An organization-wide editor placed in Alex, with the top bar at Tanta → Tanta. Reads show Tanta
  too.
- The same editor with the top bar at «كل الفروع» in a multi-branch company → `chooseBranch`.
- An Alex `branch` editor, with any top bar → Alex.
- Another key's delegation reaching Tanta does not matter: only `atmZone.manage`'s own reach and the
  map's read scope count (case B).

Every read uses `scopeSelector(ctx, key)` (`shared/types/index.ts:221-254`). It applies the top-bar
narrowing for an organization-wide grant (`:230-232`) and keeps a reach as the ceiling (`:233-252`).
Every write checks `keyReachesBranch(ctx, key, branchId)` (`:210-211`). That check is false for `own`,
`section` and a home-only `department` grant (`keyCoversUnit`, `:162-186`), so those scopes read but
never write. This is the register's rule (DEC-29, `register.repository.ts:1-14`).

### 6.3 Routes — `apps/api/src/modules/atm/map/map.routes.ts` (NEW), mounted at `/atm/map`

All routes go through `authenticate`, `authorize(key)` and `validate({...})`, the pattern of
`machines/machine.routes.ts:42-106`. `authorize` takes one key (`platform/rbac/rbac.middleware.ts:25`),
so a route that needs two keys chains two `authorize` calls. Every `/locations/*` and `/machines/*`
route requires **both** `atmMachine.locate` and `atmMap.view`, because they return coordinates or
counts of the map, and the web route already asks for both (§8.1). Literal paths are declared before
`/:machineId`. Final paths are `/api/v1/atm/map/...` (`app.ts:237`). Responses use `ok(res, data)`
(`infrastructure/http/respond.ts:6`). Rate limits use `rateLimit` with `keyOf: (req) =>
authContextOrNull(req)?.userId ?? null` (DM-47).

| # | Method + path | Keys | Request schema | Response | Errors |
|---|---|---|---|---|---|
| 1 | `GET /context` | `atmMap.view` | — | `AtmMapContextDto` | 403 |
| 2 | `GET /points` | `atmMap.view` | query `AtmMapPointsQuerySchema` | `AtmMapPointsDto` | 400 `OUT_OF_REACH`, 403 |
| 3 | `GET /zones` | `atmMap.view` | query `AtmMapZonesQuerySchema` | `AtmMapZonesDto` | 400, 403 |
| 4 | `PUT /zones` | `atmZone.manage` (+ `rateLimit` 30/min/user) | body `SaveAtmMapZoneSetSchema` | `AtmMapZoneSetDto` | 400 (geometry, names, ids, order, `BRANCH_MISMATCH`, `TOO_MANY_POINTS_IN_SAVE`, `TOO_MANY_POINTS_IN_BRANCH`), 403 (`branchNotEditable`, or the key does not reach the branch), 409 `ATM_MAP_ZONES_STALE`, 422 (`chooseBranch`), 429 |
| 5 | `GET /locations/summary` | `atmMachine.locate` + `atmMap.view` | query `AtmMapLocationSummaryQuerySchema` | `AtmMapLocationSummaryDto` | 400 `OUT_OF_REACH`, 403 |
| 6 | `POST /locations/parse` | `atmMachine.locate` + `atmMap.view` | body `ParseAtmMapLocationSchema` | `AtmMapParseResultDto` (always 200; `ok:false` is a result, not an error) | 403, 404 (machine access, §6.5) |
| 7 | `POST /locations/sync` | `atmMachine.locate` + `atmMap.view` (+ `rateLimit` 6/min/user) | body `SyncAtmMapLocationsSchema` | `AtmMapSyncResultDto` | 400 (`OUT_OF_REACH`, `TOO_MANY_MACHINES` > 5000), 403, 429 |
| 8 | `POST /locations/resolve-links` | `atmMachine.locate` + `atmMap.view` (+ `rateLimit` 10/min/user) | body `ResolveAtmMapLinksSchema` | `AtmMapLinkResolveResultDto` | 400 `OUT_OF_REACH`, 403, 429 |
| 9 | `GET /machines/:machineId/location` | `atmMachine.locate` + `atmMap.view` | params `{ machineId: objectId() }` | `AtmMachineLocationDetailDto` | 403, 404 |
| 10 | `PUT /machines/:machineId/location` | `atmMachine.locate` + `atmMap.view` | body `PlaceAtmMachineLocationSchema` | `AtmMachineLocationDetailDto` | 400 (parse failure → detail `{ field: 'body.text', code: <reason> }`; `{ field: 'body.reason', code: 'REQUIRED' }`), 403, 404, 409 `STALE_DOCUMENT` / `ATM_MAP_PARSE_CHANGED` |
| 11 | `POST /machines/:machineId/location/approve` | `atmMachine.locate` + `atmMap.view` | body `ApproveAtmMachineLocationSchema` | `AtmMachineLocationDetailDto` | 403, 404, 409 `STALE_DOCUMENT` / `ATM_MAP_SOURCE_CHANGED`, 422 `ATM_MAP_NOT_UNDER_REVIEW` |

**Error contract for the batch routes 7 and 8 (pinned in tests):**
- the writable set (`writableBranches(ctx, 'atmMachine.locate', mapScopeBranches(view selector))`) is
  empty → **403**, whether or not a branch is named;
- `branchId` outside the READ reach → **400 `OUT_OF_REACH`** (DM-11);
- `branchId` readable but not writable → **403**.

A body above 1 MB is refused by `express.json` before any of this runs (`app.ts:167`). The platform
answers that with its generic 500 today (GM-21). A valid save cannot reach the limit (DM-37).

### 6.4 Reads — `map.service.ts`

- **`context`.** The branches = `mapScopeBranches(scopeSelector(ctx, 'atmMap.view'))`. `'all'` means
  every active branch, read the way `active-branch.ts:26-29` reads them. Ids are named through
  `branchRepository.findByIdsSystem`. `canManageZones` = `keyReachesBranch(ctx, 'atmZone.manage', id)`;
  `canLocate` = the same with `atmMachine.locate`. `editBranchId` / `editBlocked` come from
  `resolveZoneEditBranch(ctx)` (§6.2), the same function the save uses.
  `organizationWide` = `scopeSelector(ctx, 'atmMap.view').scope === 'organization'`, which is false
  once the top bar narrows an organization grant (`shared/types/index.ts:230-232`), so «كل الفروع» is
  offered only when it really returns every branch.
- **`points` (not paginated, lean; this is the endpoint `MAX_PAGE_SIZE` = 100 cannot serve,
  `common/index.ts:81`).** `match = { $and: [{ isDeleted: false }, mapScopeMatch(s), narrowToBranch(s,
  q.branchId), statusFilter] }` (§6.2 composition), where `statusFilter` is `active` → `isActive:
  true`, `archived` → `false`, `all` → `{}`. It runs three lean queries:
  1. `AtmMachineModel.find(match, { branchId, machineCode, name, area, bankName, isActive })`;
  2. `AtmMachineLocationModel.find({ isDeleted: false, machineId: { $in } })` (only the fields the DTO
     needs);
  3. `AtmRegisterEntryModel.find({ machineId: { $in }, isDeleted: false, status: 'open' },
     { machineId, bankCode })`.

  `state` is `located` when status is located and `!needsReview`, `review` when `needsReview`, and
  `unlocated` otherwise. A missing location document gives `unlocated` with reason `notSynced`.
  `bankCode` is the open entries' common code, or `null` when they differ (DM-17). Rows are sorted by
  `machineCode`. The response is compressed by `responseCompression` (`app.ts:134`). Nothing K or S is
  sent (`atm-register.ts:383`), and no register text, `manualText` or `moveReason` either.
- **`zones`.** Read the **set documents first**, then every non-deleted zone matching the §6.2
  composition, sorted by `{ branchId, order }`. In that order, a save that commits between the two
  reads gives the client the newer zones under the older revision, and its next save gets a 409. The
  other order would label old zones with the new revision, and the next save would pass the CAS and
  silently overwrite the other editor's work. When `branchId` is given, its set is always returned,
  with `revision: 0` and `zones: []` if the branch has none.
- **`summary`.** Its scope is the map's read scope limited to the branches where the caller can
  locate: `{ $and: [{ isDeleted: false, isActive: true }, mapScopeMatch(view selector), { branchId: {
  $in: writableBranches(ctx, 'atmMachine.locate', mapScopeBranches(view selector)) } } (omitted when
  'all'), narrowToBranch(view selector, q.branchId)] }`. This is exactly the set of rows the
  unlocated screen lists and can act on (§8.8), so «n من m» always matches the list. An empty writable
  set gives zero counts, not an error. Three queries: the machines, their location documents, and
  `openEntryLocationTexts` (§4.3). The counts come from the same mapping as `points`. `pendingSync` =
  machines with no document, plus documents whose `seenEntryIds` or `seenText` differs from the current
  open entries (sorted ids; texts under §4.3's comparison). `shortLinksPending` / `shortLinksFailed`
  count `shortLink.status` (a pinned document whose text equals `pinText` has `shortLink: null`, so it
  is never counted). `lastSyncAt` = the maximum `derivedAt`.

**Figures (one definition for both screens):**

| Figure | Formula |
|---|---|
| S1 «على الخريطة» (`onMap`) | visible points that have coordinates: `located` + `review` |
| S1 «داخل القطاعات» (`inZones`) | `onMap` points that have a primary zone (DM-9) |
| S1 «خارج القطاعات» (`outZones`) | `onMap` − `inZones` |
| S1 «بدون موقع» (`unlocated`) | visible `unlocated` points, including `notSynced` |
| A zone's count (list, detail, labels) | primary membership over the branch's points that pass the view filters |
| Edit-mode, save-summary and delete-dialog counts | primary membership over **all** the edit branch's active points, ignoring view filters |
| S5 «تم تحديد موقع n من m» | summary `located` of summary `totalActive` (DM-39) |
| Sync toast | `processed` = located + review + unlocated |

"Visible" means the points that pass the view filters (§8.5 `applyMapFilters`).

### 6.5 Writes — `zone.service.ts`, `location.service.ts`

**Zone-set save (`PUT /zones`):**
1. `const r = await resolveZoneEditBranch(ctx)` (§6.2). `blocked: 'chooseBranch'` → 422 with the
   `edit.chooseBranch` meaning; `blocked: 'branchNotEditable'` → 403. If `body.branchId !==
   r.branchId` → 400 `BRANCH_MISMATCH` (DM-12). `keyReachesBranch(ctx, 'atmZone.manage', branchId)` is
   true by construction, and the service asserts it again.
2. Load the branch's live zones. Then validate (400, each detail naming its field, such as
   `creates[2].points`):
   - every update and delete id belongs to the branch (`UNKNOWN_ZONE`);
   - `order` is a permutation of (live ids − deletes) ∪ creates' tempIds (`ORDER_MISMATCH`);
   - the final count is ≤ 200 (`TOO_MANY_ZONES`);
   - the final point total of the branch is ≤ `ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX`
     (`TOO_MANY_POINTS_IN_BRANCH`);
   - final names are unique under DM-8 (`DUPLICATE_NAME`);
   - `zoneGeometryIssues` is empty for every create and for every update that carries points.
3. `unitOfWork` (`platform/kernel/unit-of-work.ts:5-17`). `withTransaction` may run the callback more
   than once (`:9`), so the callback builds a **fresh** pending-audit list each time, and nothing is
   recorded inside it:
   - **Revision CAS.** If `revision === 0`, `AtmMapZoneSetModel.create([{ branchId, revision: 1,
     createdBy, updatedBy }], { session })`; an E11000 means a set already exists → 409
     `ATM_MAP_ZONES_STALE`. Otherwise `findOneAndUpdate({ branchId, revision, isDeleted: false },
     { $inc: { revision: 1, __v: 1 }, $set: { updatedBy } }, { new: true, session })`, and `null` →
     409. Either way, nothing is written.
   - Soft-delete the deletes.
   - `$set` the changed fields of each update, plus `updatedBy` and `$inc __v`.
   - `insertMany` the creates, each with `order` = its final index (`createdBy`/`updatedBy` = caller).
   - Write `order` = final index for every existing zone whose **stored `order` ≠ its final index**.
     After a delete this renumbers the zones below, which keeps `order` at 0..n-1.
   - Build the pending audits:
     - `create` → `diffChanges({}, zoneSnapshot(z))` with the final `order`;
     - `update` → one row per zone whose fields or `order` changed: the field diffs merged with
       `{ field: 'order', old, new }`. A pure reorder is audited too, because under D-M7 the order
       decides which zone a machine counts for;
     - `delete` → `diffChanges(zoneSnapshot(before), {})`.
   - Read the branch's full set **with the transaction's session** and return it with the audits.
4. After the commit, record the returned audits (the `recordAll` pattern, `register.service.ts:185-187`).
   `zoneSnapshot = { branchId, name, color, order, points: [[lat, lng], …] }`, and the entity ref is
   `{ moduleId: 'atm', entityType: 'mapZone', entityId }` (a literal pair, so the realtime registry
   scan sees it, `realtime-registry.spec.ts` `LITERAL_PAIR`).
5. Respond with the set read in step 3, the same shape as `GET /zones?branchId`.

**Machine access for the machine routes (6, 9, 10, 11):** `AtmMachineModel.findOne({ $and: [{ _id,
isDeleted: false }, mapScopeMatch(scopeSelector(ctx, 'atmMap.view'))] })`. Not found → 404, so a
machine outside the map's read scope is indistinguishable from one that does not exist.
`!keyReachesBranch(ctx, 'atmMachine.locate', String(machine.branchId))` → 403. The resulting location
write always copies `branchId` from the machine, never from the request.

**Parse (`POST /locations/parse`):** read with `readLocationText(text)`, rank with §4.3 (no stored
link), and recover a short code with `referenceFor(pool(machine.branchId), machine.branchId,
machine.area, machine._id)` (or the URL's own viewport, basis `'url'`). Return `ok:true` with
`needsReview` for a short code, a viewport, `ambiguousUrl` or `sourcesDisagree`, or `ok:false` with
the reason. A short link returns `shortLink`; it is never fetched here.

**Place / move (`PUT /machines/:id/location`):**
1. The point comes from `mode: 'pin'` (round to 6 decimals), or from `mode: 'text'` parsed exactly as
   in Parse; a failure → 400 with the reason as the detail code. In text mode, if
   `haversineMeters(parsed, body.expected) > ATM_MAP_PARSE_TOLERANCE_METERS` → 409
   `ATM_MAP_PARSE_CHANGED` (DM-45). The web then re-reads and shows the new preview.
2. Version check:
   - **document exists:** `body.version` must equal `doc.__v`, otherwise 409 `STALE_DOCUMENT`; the
     write is `updateById` with `version` (`base.repository.ts:432-459`);
   - **no document:** `body.version` must be `null`; a create that hits E11000 on `ux_machine` → 409
     `STALE_DOCUMENT` (another writer won).
3. If the existing point is located and `haversineMeters(old, new) > 1000` and `reason` is missing →
   400 `{ field: 'body.reason', code: 'REQUIRED' }` (DM-18).
4. Write `status: 'located'`, `source: 'manual'`, `needsReview: false`, `pinned: true`,
   `warnings: insideEgypt ? [] : ['outsideEgypt']`, `reason: null`, `shortLink: null`, `manualText`
   (text mode), `moveReason`, `setBy/setByName/setAt` = the caller, now. A pasted **short** code is
   confirmed by this person, so `reviewedBy/reviewedByName/reviewedAt` = the caller too (DM-4). Read
   the open entries with `openEntryLocationTexts([machineId])` and store their current text as both
   `pinText`/`pinEntryIds` and `seenText`/`seenEntryIds`. That is what makes DM-2's "since the pin was
   set" true.
5. Audit `create` or `update` on `{ moduleId: 'atm', entityType: 'machineLocation', entityId:
   machineId }` with the diff of `locationSnapshot = { lat, lng, status, source, needsReview, reason,
   pinned, moveReason }` plus `{ field: 'distanceMeters', old: null, new: rounded }` for a move.

**Approve (`POST …/approve`):**
1. The document must be `needsReview: true`, otherwise 422 `ATM_MAP_NOT_UNDER_REVIEW`.
2. Read the open entries with `openEntryLocationTexts([machineId])`. If their current text (or their
   sorted ids) differs from `doc.seenText` / `doc.seenEntryIds` → 409 `ATM_MAP_SOURCE_CHANGED`. The
   pin was derived from text that has since changed, and approving it would protect a point derived
   from out-of-date text (DM-45). The person runs the sync and reviews again.
3. Check the version, then set `needsReview: false`, `pinned: true`,
   `reviewedBy/reviewedByName/reviewedAt` = the caller, `pinText`/`pinEntryIds` = the current text and
   ids, and `shortLink: null`. Audit `update`.

A sync that moved the review pin after the person loaded it has bumped `__v` (version guard below), so
«اعتماد» on the point the person saw answers 409 `STALE_DOCUMENT`, never approves a point they did not
see.

**Detail (`GET /machines/:id/location`):** `sourceVisible = hasPermission(ctx, 'atmRegister.view')
&& seenEntryIds.length > 0 && every id in seenEntryIds passes
atmRegisterEntryRepository.findById(id, scopeSelector(ctx, 'atmRegister.view')) !== null`
(`hasPermission`, `shared/types/index.ts:108`; at most two ids, EG-8). The key check comes
first. For a caller without the key, `scopeSelector` falls back to `own` (`:222`), and the register's
`own` match is `createdBy: userId` (`register.repository.ts:21-25`). The entry's creator, for example
whoever ran the workbook import, would otherwise see the AP/AV text without holding
`atmRegister.view`. `sourceText` (= `seenText`) is `null` when `sourceVisible` is false. With no open
entry, `sourceVisible` is false.

**Version guard for every batch write (sync and resolver).** These writes run outside a transaction
from documents loaded earlier, while a person may place or approve a pin in between. So:
- every update filters `{ _id, __v: loaded.__v, isDeleted: false }` and does `$inc: { __v: 1 }`;
- a new document is `updateOne({ machineId, isDeleted: false }, { $setOnInsert: { …derived } },
  { upsert: true })`. An existing document matched by that filter is left alone;
- operations that match nothing, and E11000 errors on `ux_machine` reported in a `BulkWriteError`, are
  **counted in `conflicts`, never thrown**. The person's write stands, and the next sync re-evaluates
  that machine.

**Sync (`POST /locations/sync`):**
1. The scope is `writableBranches(ctx, 'atmMachine.locate', mapScopeBranches(scopeSelector(ctx,
   'atmMap.view')))`, narrowed by `body.branchId` under §6.3's error contract (empty → 403; outside the
   read reach → 400 `OUT_OF_REACH`; readable but not writable → 403).
2. Load the **active, not deleted** machines there; more than 5000 → 400 `TOO_MANY_MACHINES`. Also load
   their location documents (with `__v`) and `openEntryLocationTexts(machineIds)`: 3 queries.
3. **Pass 1:** derive every machine whose best candidate is not a short code. **Pass 2:** build the
   DM-34 pool from the state **after** pass 1 (stored pins, replaced by pass 1's results where pass 1
   changed them), then derive the short codes.
4. Apply §4.3 precedence. Write only the documents that changed, in one unordered `bulkWrite` under the
   version guard above. A test hook, `setSyncBeforeWriteForTests(fn | null)`, runs between steps 3 and
   4, so the integration suite can place a pin in between (§9.3 #5). A new or changed `shortLinkUrl` resets `shortLink` to `{ url, status:
   'pending', attempts: 0, viewportOnly: false, claimedAt: null }`. An unchanged URL keeps its stored
   result. A null `shortLinkUrl` sets `shortLink: null`. `setBy/setAt` change only when the point
   changed.
5. Then one `updateMany({ machineId: { $in: evaluated }, isDeleted: false }, { $set: { derivedAt: now }
   })` for every evaluated machine. It does not bump `__v` and is not counted as `changed`. It is what
   makes «آخر مزامنة» move on a sync with `changed: 0`.
6. **Audits.** One run row: `{ moduleId: 'atm', entityType: 'mapLocationSync', entityId: new ObjectId()
   }`, action `atmMapLocationSync`, changes `[{ field: 'branchIds', new }, { field: 'counts', new:
   result }, { field: 'changedMachineIds', new: all of them (≤ 5000) }]`. For every document that was
   `pinned: true` and whose point this sync changed (row 4), also write an `update` audit on
   `{ moduleId: 'atm', entityType: 'machineLocation', entityId: machineId }` with old and new `lat`,
   `lng`, `source` and `pinned` (DM-15).

**Resolve links (`POST /locations/resolve-links`):**
1. Take the lease (§5.1). Use the same writable scope and error contract as Sync.
2. Select up to 20 documents with `shortLink.status: 'pending'` whose machine is **active and not
   deleted** (machine ids from the scope, then `machineId: { $in }`), oldest `lastAttemptAt` first.
3. For each, in order: check the budget, claim it (§5.4), resolve it (§5.1), then write the result and
   the re-derivation under the version guard. A run that stops clears its unfinished claims.
4. `remaining` = §5.4's count after the run.
5. **Audits.** One run row: `{ moduleId: 'atm', entityType: 'mapLinkResolution', entityId: new
   ObjectId() }`, action `atmMapLinkResolve`, changes `[{ field: 'counts', new }, { field: 'outcomes',
   new: [{ machineId, status, failure }] }]`. No URLs. A resolution that replaces a pinned point also
   writes the per-machine audit, as in Sync.

### 6.6 Request size limits

- The JSON body limit is 1 MB (`app.ts:167`). body-parser refuses a larger body before routing with
  `type: 'entity.too.large'`. That is not an `AppError`, so today `errorHandler` answers it with 500
  `INTERNAL` and reports it to Sentry (`infrastructure/http/error-handler.ts:31-69`). Nothing in
  `apps/api/src` maps it to 413. This feature does not change the platform handler (GM-21). Instead:
  - a valid save cannot reach 1 MB, because the point caps (DM-37) keep it at about 700 KB;
  - the web refuses to send a save whose serialised body it measures as over 900 KB, and shows
    `save.error.tooManyPoints`.
- Zod caps: 200 creates, 200 updates, 200 deletes and 200 order entries (each an ObjectId or a tempId);
  3–500 points per zone; at most 20,000 points per save (`TOO_MANY_POINTS_IN_SAVE`); names of at most 60
  characters; texts of at most 2048 characters; reasons of at most 300 characters.
- The service caps the branch's final total at 20,000 points (`TOO_MANY_POINTS_IN_BRANCH`).
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
| `atmMap.view` | `branch`, `organization`. A home-only `department`/`section` grant narrows to the home branch. A department copy granted by delegation (ADR-032) reads the **whole** branch that copy sits in (`org-scope-match.ts:93-98`; `shared/types/index.ts:245-249`) | `own` reads nothing (DM-10) |
| `atmZone.manage` | `branch` (supervisor), `organization` | writes need `keyReachesBranch`; finer scopes never write |
| `atmMachine.locate` | `branch`, `organization` | same; every locate route also needs `atmMap.view` (§6.3) |

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
(`:8-22`). The census reads the page file itself:
- `const REMEMBERED_FILTERS = [...] as const;` must be declared in the page (`:328`), and a page that
  declares nothing fails (`:367`);
- only the page source is scanned for the params it reads (`sp.get('…')` and the other shapes, `:311`);
- an excluded param that the page never reads fails as a stale exclusion (`:378`).

So each page declares its list and reads every param with `sp.get(...)` in its own file, as
`MachinesPage.tsx:60, 69, 74-83` does. `lib/map-filters.ts` takes the already-read values; it never
reads `URLSearchParams` itself.
- `MachineMapPage.tsx`: `const REMEMBERED_FILTERS = ['banks', 'areas', 'zones', 'status', 'loc', 'branch']
  as const;` and `useRememberedFilters([sp, setSp], REMEMBERED_FILTERS)`. It also reads `q` (the fly-to
  search) and `machine` (a deep link that opens one popup); neither is a filter. Add to `COVERED`
  (`:46-53`): `['modules/atm/pages/MachineMapPage.tsx', ['q', 'machine']]`.
- `UnlocatedMachinesPage.tsx`: `const REMEMBERED_FILTERS = ['reasons'] as const;`. It reads `q` (the
  list search) and `branch` (handed over by S1's links and validated against `context.branches`; not
  remembered, so a branch remembered on a shared browser can never come back on its own). Add:
  `['modules/atm/pages/UnlocatedMachinesPage.tsx', ['q', 'branch']]`. It does not read `machine`.

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
  (`PageContainer.tsx:48-98`, no subtitle). **In edit mode the header keeps only the title**: no
  figures and no actions (`Edit.dc.html:62-64`).
- The filter bar (`DARK_FILTER_BAR`, `shared/ui/dark-filter-bar.ts:9-23`, the `MachinesPage.tsx:207-215`
  pattern) is shown in view mode. In edit mode it is replaced by `EditStrip`.
- The working row is `flex min-h-0 flex-1 gap-4`: panel `w-[360px] shrink-0 overflow-y-auto` on the
  reading-start side, and map `min-w-0 flex-1`. Below `lg` the panel moves into `SideLayer` (DM-40),
  opened by the map button «اللوحة الجانبية».
- **Data, in this order.** `context` loads first. Before any other query, a `branch` from the URL or
  restored by `useRememberedFilters` that is not in `context.branches` (or «كل الفروع» when
  `!organizationWide`) is replaced through `pruneStale` with the default below. Only then are
  `points(branch, status)` and `zones(branch)` enabled (`enabled: context.isSuccess`). A value
  remembered by another account on the same browser (`useRememberedFilters.ts:44-45` keys by pathname
  only), or left from an earlier top-bar choice, therefore never reaches the server as a 400
  `OUT_OF_REACH`.
- The default view branch is `context.editBranchId` when it is in `branches`; else the only branch;
  else «كل الفروع» when `organizationWide`; else the first branch. An empty `branches` list shows the
  empty state «لا يشمل نطاق صلاحيتك أي فرع.».

**`pages/UnlocatedMachinesPage.tsx` (S5)**
- `PageHeader` «ماكينات بدون موقع», with the figure «تم تحديد موقع n من m» (DM-39) and the action
  «رجوع إلى الخريطة» (a guarded `Link` to `/atm/map`, carrying the current `branch`).
- Working row: panel `w-[440px]`, gap 16, map flex (critic §S5).
- **Branch.** S5 reads `?branch=`, which S1's links pass, and validates it against `context.branches`
  with S1's default rule (the mockup has no branch control). The branch is not remembered (§7.5).
- **Data:** `context` first, then `points(branch, 'active')`, `zones(branch)` and `summary(branch)`. The
  map shows the zones at fill 0.12 and the located dots, as the mockup does. `MovePinBar`'s
  «القطاع: …» uses the zones and the shared membership.
- **Rows** are the points in the summary's scope: those whose branch has `canLocate` (§6.4). Every row
  shown can therefore be acted on, and the list agrees with «n من m».

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
- **Tiles:** `L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION, referrerPolicy:
  'strict-origin-when-cross-origin' })`. `OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'`
  and `OSM_ATTRIBUTION = '&copy; OpenStreetMap'` are promoted to `apps/web/src/shared/lib/osm-tiles.ts`
  (DM-28). `BranchMapPicker.tsx:67-70` is changed to import them; the values are identical, so the
  operations screen keeps its current behaviour, and `referrerPolicy` stays ATM-only. The CSP already
  allows the host (`app.ts:161`), so there is no CSP change. `{s}.` must stay, because
  `*.tile.openstreetmap.org` does not match the bare host (research `ecms-ui.md` §3).
- **Attribution control:** `L.map(host, { attributionControl: false })` plus
  `L.control.attribution({ prefix: false }).addTo(map)`, so only «© OpenStreetMap» shows, as in the
  mockups (Leaflet's default prefix is a Leaflet link, `leaflet-src.js:5758-5762`).
- **Keyboard:** `map.keyboard.disable()` on `ENTER_EDIT` and `enable()` on `EXIT_EDIT`. Leaflet focuses
  the map on mousedown (`leaflet-src.js:13998-14009`) and then pans on the arrow keys from a `document`
  listener (`:14056-14058`; `keyboard: true` by default, `:13938-13941`). Without this, selecting a
  vertex with the mouse and pressing an arrow would pan the map instead of moving the point (DM-41).
  The editor's shortcut listener is attached to the map wrapper and calls `preventDefault` on the
  arrows it handles.
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
- **Rendering (DM-27):**
  - ONE `L.canvas()` renderer, created with the map and passed as `renderer` to every zone fill,
    outline, halo and casing (`L.polygon`/`L.polyline`) and every machine dot (`L.circleMarker`). No
    SVG renderer is created. Zones are added first and dots after, and zones are never brought to the
    front, so the canvas's own hit-test (`leaflet-src.js:12919-12931`, last drawn wins) gives a dot
    the click over the zone under it. After a zone layer is rebuilt, the dots are re-added on top;
  - review pins, clusters, labels and handles: `L.marker` + `L.divIcon` whose `html` is an element
    built by `lib/map-dom.ts` with `textContent`. Labels are `interactive: false`;
  - **edit mode:** dots are `interactive: false`, there are no cluster bubbles, and vertex and midpoint
    handles exist only for the **selected** zone (the mockup's `editHandles`, `Edit.dc.html:213, 585`);
  - the popup: the React `MachinePopup` positioned with `map.latLngToContainerPoint` and updated on
    `move`/`zoom`. Closing it returns focus to the control that opened it.
- **Performance budget (live counts).** Each zone gets a cached bounding box, and a point is tested
  against a zone only inside that box. During a gesture, membership is recomputed only for the zones
  the gesture touches and the zones overlapping them, at most once per animation frame. The final
  counts are computed at gesture end. Labels are placed on `moveend`/`zoomend`, and only for zones in
  the viewport. The `aria-live` region updates at gesture end only. Budget: a full recompute of 2,607
  points × 200 zones of 50 vertices in under 200 ms (§9.4).
- **Imperative bridge:** `MapCanvas` builds the `L.map` once and reads changing values through refs
  (the `BranchMapPicker.tsx:52-81` pattern). Props diffs update layers in place, so tiles are never
  rebuilt. The component exposes `onViewportChange(projector)` so that pure `lib/` functions get pixel
  coordinates.

### 8.5 Pure modules — `lib/` (each with a `.spec.ts`)

| File | Responsibility |
|---|---|
| `map-geometry.ts` | Re-exports the contracts geometry (§6.1, in the projected plane of DM-48). `round6(p)`, applied to every point that enters the draft. `zoneMembership(point, zonesOfBranchInOrder) → { primary: id \| null; all: id[] }` (D-M7, DM-9), with the bounding-box prefilter of §8.4. `wouldCrossWhileDrawing(openPath, next)`: the new edge against the drawn edges, under the same adjacent/non-adjacent rules as `selfIntersects`. `closestPointOnSegmentPx`. `snapTarget(cursorPx, candidatesPx, thresholdPx) → { kind: 'vertex' \| 'edge' \| 'first', zoneId, index, latlng } \| null` (a vertex beats an edge, which beats nothing; the first dot while drawing gives `first` = close the shape). `coordKey(p) = lat.toFixed(6)+','+lng.toFixed(6)`. `linkedVertices(draft, key)` (the shared vertices, DM-6). `zonesWithEdge(draft, keyA, keyB)`: every draft zone that has the edge between those two keys, in either orientation. `insertOnEdge(zone, edgeIndex, p)` (skipped when a vertex is within 1e-7°). `midpoints(zone, projector) → { edgeIndex, latlng, hidden: lengthPx < 40 }[]`. `overlapsOf(zone, others) → { zoneId, machinesInBoth }[]`. |
| `map-labels.ts` | `placeLabel(polygonPx, pinsPx, labelSizePx)`. Sample a 9×9 grid over the bounding box and keep the points inside the polygon and ≥ 8 px from its edges. Score each = (distance to the nearest edge) − 40 × (pins under the label rectangle); on a tie, prefer the one closer to the centroid. Return `null` when the polygon's on-screen box is < 80 px or zoom < 9. `resolveCollisions(labelsInListOrder)` drops the later label of two that overlap (lower in the list = dropped). |
| `map-cluster.ts` | `clusterPoints(pointsPx, cellPx = 56, zoom)`. At zoom ≥ 15 there is no grid. Points ≤ 1 m apart always group as a "stack" (spiderfy). Output `{ kind: 'single' \| 'cluster' \| 'stack', members, centerPx }`. `spiderfy(centerPx, n)` puts n points on a circle of radius 18 + 4n px. |
| `map-colors.ts` | `ATM_MAP_ZONE_PALETTE` with its i18n names. `suggestColor(draft, newZoneBbox)`: the first palette colour not used in the branch; else the least-used one that no touching zone uses; ties go to palette order. `needsCasing(hex)`: contrast against `#f2efe9` < 3:1 (WCAG relative luminance). `bankColor(code \| null)`: `ATM_BANK_REPORT_COLORS` (`atm-register.ts:44-51`), or `#6b7280` for null. `paleBank(code)` is true for CIB, HDB and BRK (they get a dark ring). |
| `map-filters.ts` | Filter values ⇄ the param strings the page read with `sp.get` (§7.5): `banks` (codes + `none`), `areas`, `zones` (ids + `none` + `multi`), `status` (`active` \| `archived` \| `all`, default `active`), `loc` (`all` \| `located` \| `review`), `branch`, `q`, `machine`. `applyMapFilters(points, zonesMembership, f)` gives the visible points. `mapFigures(visible, membership) → { onMap, inZones, outZones, unlocated }` (the formulas of §6.4). `pruneStale(filters, options)` removes values no longer offered, the precedent from task #20; it handles `branch` FIRST, against `context.branches` and `organizationWide` (§8.3). |
| `zone-editor.ts` | The reducer and the history (§8.6), plus `buildZoneSetSave(base, draft) → SaveAtmMapZoneSet` (only changed fields; `order` = the final ids and tempIds), `dirtyCount(base, draft)` (the mockup's formula, DM-23), `nextDefaultName(draft)` (DM-22), `duplicateNames(draft)` (DM-8, checked before saving) and `saveBodyBytes(body)` (§6.6 900 KB guard). |
| `zone-draft-storage.ts` | `loadDraft(userId, branchId)`, `saveDraft(userId, branchId, { baseRevision, draft, savedAt }) → boolean` and `clearDraft(userId, branchId)` under the key `ecms.atmMap.zoneDraft.<userId>.<branchId>`. Every access is in try/catch (`useRememberedFilters.ts:48-64`), and `saveDraft` returns `false` when storage refused (quota, private mode). The key carries the user, so another account on a shared browser is never offered this user's draft. |
| `map-shortcuts.ts` | `shortcutFor(event, { modalOpen }) → action \| null` by `KeyboardEvent.code` (`KeyN`, `Enter`, `Escape`, `Backspace`, `Delete`, `KeyZ` with ctrl/meta, ±shift, `KeyY` with ctrl, arrows ±shift). It returns `null` when the target is `input`, `textarea`, `select` or `[contenteditable]`, and while any `Dialog` or `SideLayer` is open (`modalOpen`). Esc then closes only the dialog, and Delete or Ctrl+Z never act behind a modal. |
| `map-count-text.ts` | `machineCountText(n, t, locale)` → the five forms by DM-21's rule (`n % 100` in 3–10 → `few`), with numbers through `formatNumber` (`shared/lib/format.ts:92-93`). |
| `map-scale.ts` | `scaleFor(metersPerPixel, maxPx = 72) → { meters, px, label }`. |
| `unlocated-view.ts` | `reasonChipCounts(points)` (chips with 0 are hidden). `parseFeedback(result) → i18n key + tone`. `linkFailureKey(failure)`. `resolveLoopShouldContinue(result)` (§8.10). |
| `map-links.ts` | `registerSearchUrl(code)` = `/atm/register?q=<code>` (`RegisterPage.tsx:107`). The Google Maps link comes from `apps/web/src/shared/lib/google-maps-url.ts` (`googleMapsUrl({ lat, lng })` = `https://www.google.com/maps?q=lat,lng`), promoted from `operations/lib/maps-link.ts:127-128`. `maps-link.ts` keeps exporting `mapsUrl` as that same function, so its callers do not change. |

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
  and the viewport is ≥ 768 px. It is enabled when `context.editBranchId !== null`. Otherwise it is
  disabled, and its title is `edit.chooseBranch` («اختر فرعًا محددًا من القائمة العلوية قبل تعديل
  القطاعات.») or `edit.branchNotEditable` («لا تشمل صلاحية تعديل القطاعات هذا الفرع.»), from
  `context.editBlocked`.
  - Fetch `zones?branchId=editBranchId`. That fresh revision is the base. `editBranchId` is always in
    the read scope (§6.2), so this fetch cannot answer 400 `OUT_OF_REACH`.
  - The panel's «الفرع» switches to the edit branch and is locked («الفرع: name 🔒», the lock's title
    «مقفول أثناء وجود تغييرات غير محفوظة», `Edit.dc.html:85`).
  - `map.keyboard.disable()` (§8.4).
  - If a stored draft exists for (this user, this branch) with `baseRevision === set.revision`, offer
    «استعادة المسودة / تجاهلها». If its revision differs, show the outdated notice and clear it.
- **edit → draw (`START_DRAW`, the «قطاع جديد» button or N):** set the crosshair cursor and
  `map.doubleClickZoom.disable()`. The suggested colour is preselected.
- **draw:**
  - `ADD_POINT(p)` applies snap (unless Alt is held or the toggle is off) and refuses a crossing edge
    (the toast «لا يجوز أن تتقاطع حدود القطاع مع نفسها.» and the dot flashes red).
  - A double-click drops its duplicate second dot (within 4 px of the previous one), then finishes.
  - `UNDO_POINT` is Backspace, Ctrl+Z or «تراجع عن النقطة».
  - `FINISH_DRAW` (click the first dot, double-click, Enter or «إنهاء») needs ≥ 3 points and no issues
    from `zoneGeometryIssues`. `TOO_SMALL` gives the toast «القطاع صغير جدًا؛ يجب ألا تقل مساحته عن 100
    متر مربع.». On success it appends `{ id: 'new-<rand>', name: nextDefaultName(draft), color }`
    (DM-22: the smallest unused «قطاع n»), pushes
    history, selects the zone, returns to edit and shows the toast «أُضيف القطاع. غيّر اسمه ولونه من
    اللوحة، ثم احفظ التغييرات.».
  - `CANCEL_DRAW` (Esc or «إلغاء») with ≥ 3 points shows the toast «أُلغي الشكل.»; with fewer it is
    silent (DM-31).
- **edit:**
  - `SELECT_ZONE` (click a fill or a list row);
  - `SELECT_VERTEX`;
  - `MOVE_VERTEX(zoneId, index, p, { unlink })` moves the vertices linked to it too, unless Alt is held;
    on drag end it checks `selfIntersects` for every zone touched, and on a failure it reverts and shows
    the crossing toast. A snap moves only the dragged point (the mockup's `snapPoint`); it never edits
    a zone the user did not touch;
  - `INSERT_VERTEX(zoneId, edgeIndex, p)` comes from a midpoint drag. It inserts the new point into
    **every** draft zone that has the same edge (`zonesWithEdge`, the same two `coordKey`s in either
    orientation), in one history step, and the new vertices are linked. That is the mockup's
    `mids.down` (`Edit.dc.html:495-505`), and it is what keeps «فلا تظهر فجوة بينهما» true;
  - `DELETE_VERTEX` (Delete, Backspace, a **double-click on the vertex** (`Edit.dc.html:218, 488`), the
    chip «حذف النقطة» or the panel button «حذف النقطة المحددة») is disabled at 3 points with the title
    «يلزم القطاع ثلاث نقاط على الأقل»;
  - `RENAME` is committed on blur or Enter (one step). The name is edited only in the «اسم القطاع»
    field of «القطاع المحدد»; the list rows are buttons (`Edit.dc.html:163-170`);
  - `RECOLOR`;
  - `MOVE_UP`, `MOVE_DOWN` and `SORT_AZ`. Sort uses `new Intl.Collator('ar', { numeric: true,
    sensitivity: 'base' })` whatever the UI locale, and ties keep their current order (a stable
    sort). Under `localeCompare` without `numeric`, «قطاع 10» would sort before «قطاع 2», and the order
    is the priority (D-M7);
  - `DELETE_ZONE`, after confirmation.

  Every point that enters the draft (added, moved, inserted or restored) goes through `round6` (DM-48).
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
- The draft is autosaved to storage, under (user, branch), after each history push. When `saveDraft`
  returns `false`, the page remembers that the draft is NOT kept, and `ConflictDialog` leaves out the
  sentence about the draft being kept on this device (§8.8).
- `EXIT_EDIT` calls `map.keyboard.enable()`.

### 8.7 Unsaved-changes guard — `lib/useUnsavedGuard.ts`

While `dirtyCount > 0`:
- `useEffect` adds a `beforeunload` listener.
- The page's own navigation («ماكينات بدون موقع», «فتح في سجل الماكينات», «رجوع إلى الخريطة», «خروج من
  التعديل») goes through `confirmLeave()`, which shows the dialog «لديك تغييرات غير محفوظة. هل تريد
  المغادرة دون حفظ؟».
- A **capture-phase** `document` click listener intercepts clicks on same-origin `a[href]` elements
  outside the page. The sidebar rows are `NavLink` anchors (`Sidebar.tsx:17, 727`). The listener runs
  before React's root listener, so it can `preventDefault()` + `stopPropagation()`. It then calls
  `confirmLeave()`, and on confirmation `navigate(href)`. Clicks with a modifier key, a middle click,
  `target="_blank"` and `download` links are left alone.
- **A confirmed leave clears the stored draft**, because the person chose to discard it. Leaving
  without a confirm keeps the draft: closing the tab, the idle logout, or a module switch through
  `navigate()` (`Sidebar.tsx:916-921`), which no anchor listener sees.

The idle logout still applies, and map gestures count as activity, because `pointermove`,
`pointerdown` and `wheel` are activity events (`platform/auth/idle-session.ts:176-183`). The draft
survives it, keyed by user.

### 8.8 Components — `components/map/` (NEW)

| Component | Responsibility (mockup reference) |
|---|---|
| `MapCanvas` (lazy, default export) | §8.4 rules; layers for zones (fill 0.25, 0.35 on hover or selection; outline 3, or 4 with a white halo when selected; casing `#1f2937` at 60 % for `cased` colours), dots, clusters, labels, the drawing preview (dashed cursor line for the mouse only; first dot 14 px, others 10 px; a ring and the tooltip «إغلاق الشكل» near the first dot), handles (orange `#F97316` squares 12 px visible / 32 px hit area; blue `#2563EB` diamonds), the temporary pin (`L.marker({ draggable: true })` + `dragend`, `BranchMapPicker.tsx:95-99`), and the scale bar. |
| `MapFigures` | Four chips in the `MachineFigures` style (`components/MachineFigures.tsx:33-72`): «على الخريطة», «داخل القطاعات», «خارج القطاعات», «بدون موقع» (amber, «?»), with §6.4's formulas. The last one is a link to `/atm/map/unlocated?branch=<the selected branch>` only for `atmMachine.locate`, plain text otherwise. |
| `MapFilters` | `FilterBar` + `FilterWithIcon` + `MultiSelect`, as on `MachinesPage.tsx:207-282`: «البنك» (6 codes + «بنك غير محدد»), «المنطقة», «القطاع» (zones + «بلا قطاع» + «في أكثر من قطاع»; with «كل الفروع» the label is "name — branch"), «الحالة» (`active` default / `archived` / `all`), «الموقع» (الكل / على الخريطة / يحتاج إلى مراجعة), search «رقم الماكينة أو اسمها» (Enter → fly to zoom 17 and open the popup; an unlocated machine gives a toast with the link), and reset. The page owns `REMEMBERED_FILTERS` and reads the params (§7.5); `MapFilters` receives the values and a `patch` callback. |
| `MapPanel` | View mode: «الفرع» select (hidden with one branch); «القطاعات (n)» + «بحث في القطاعات» + `ZoneList` (10 per page, `NumberedPager`); the summary line «داخل القطاعات: n · خارج القطاعات: n · بدون موقع: n»; `LayersSection`. With «كل الفروع», the zone list is grouped under branch headings. |
| `ZoneList` | 48 px rows: a 12 px swatch with a ring, the name, the count pill (`machineCountText`) and a chevron. Hover raises the fill on the map; a click zooms to the zone and opens `ZoneDetail`. |
| `ZoneDetail` | «› رجوع إلى القطاعات»; a header with swatch, name, count pill and «تعديل» (shown only when `zone.branchId === context.editBranchId` → edit mode with this zone selected; for another branch the button is absent, because edit mode always opens the edit branch, §8.6); «حسب البنك» (an 8 px stacked bar + rows in bank colours); «حسب المنطقة»; «الماكينات» (rows رقم الماكينة \| اسم الماكينة \| البنك, the mockup's three columns, 10 per page; a row is a button and a click flies to the machine); «يقع جزء منه في قطاعات أخرى: n» when it overlaps. Counts cover visible points only. |
| `LayersSection` | «الطبقات»: «إظهار الماكينات», «إظهار القطاعات», «إظهار أسماء القطاعات على الخريطة», «شوارع باهتة (لتظهر ألوان القطاعات أوضح)», and «تلوين الماكينات حسب:» as a segmented control «القطاع \| البنك» with `aria-pressed`. These are remembered per viewer (DM-30). |
| `BankLegend` | Bottom-left inside the map when colouring by bank: the 6 banks in their colours, plus «بنك غير محدد» (an addition to the mockup's 6, §8.13). |
| `MachinePopup` | 280 px, React overlay. Title: the code (monospace, `dir="ltr"`), the bank dot, the status pill «قيد التشغيل»/«مؤرشفة», the chip «يحتاج إلى مراجعة» when under review, and close «إغلاق». Rows: «اسم الماكينة», «البنك» (name (code) or «بنك غير محدد»), «المنطقة», «الفرع», «القطاع» (● name / «بلا قطاع» / «في أكثر من قطاع: … — يُحتسب على «…»»), «مصدر الموقع» (DM-19), and «آخر تحريك للموقع» or «اعتُمد الموقع» from `lastSet` (DM-20). Links: «فتح في سجل الماكينات» (`atmRegister.view`), «فتح في خرائط Google» (`noopener noreferrer`), «تحريك الموقع» (`canLocate` for the branch → `MovePinBar`). Esc closes it, and focus returns to the control that opened it. |
| `MovePinBar` | A bottom bar over the map: «اسحب العلامة إلى الموقع الصحيح · القطاع: X» (live), «تأكيد الموقع», «إلغاء». When it opens it fetches `GET …/location` (`detailKey('atm', 'mapLocation', id)`), because `AtmMapPointDto` carries no version, and it sends that `version`. The pin gets an orange ring and becomes draggable with the mouse, and with the arrow keys (1 px, 10 px with Shift; DM-41) when it has focus. Confirming a move of > 1 km opens `MoveConfirmDialog`; otherwise it calls `PUT … { mode: 'pin' }`. On 409 `STALE_DOCUMENT` it refetches the detail, keeps the dragged position and asks again. On success: the toast «حُدِّد موقع الماكينة {{code}} — القطاع: {{zone}}. سُجّل التغيير في سجل التدقيق.». |
| `MoveConfirmDialog` | «تأكيد تحريك الموقع»: «تحرّك الموقع {{km}} كم», «القطاع: {{from}} ← {{to}}», the required field «سبب التحريك», and the buttons «تأكيد» / «رجوع». |
| `EditStrip` | 48 px, `amber-50`: «وضع تعديل القطاعات — فرع {{branch}}», the badge «تغييرات غير محفوظة: {{count}}», «↶ تراجع», «↷ إعادة», «إلغاء التغييرات» (secondary, disabled when there are no changes, `Edit.dc.html:74`), «حفظ التغييرات ({{count}})» (primary, disabled at 0), and the link «خروج من التعديل». In edit mode the map wrapper gets an amber border (`border-2 border-amber-300`) and the `aria-label` «الخريطة — وضع التعديل» (`Edit.dc.html:180`). |
| `EditPanel` | In this order: «الفرع: name 🔒»; «+ قطاع جديد»; when a zone is selected, «القطاع المحدد» (the field «اسم القطاع», «اللون» via `ColorPicker`, «الماكينات داخل القطاع: n (كانت m)», «عدد النقاط: n», «حذف النقطة المحددة» + «اسحبها لتحريكها», the overlap lines «يتداخل مع «X»؛ في منطقة التداخل n», «حذف القطاع»); otherwise the hint «اختر قطاعًا من الخريطة أو من القائمة لتعديله، أو اضغط «قطاع جديد» لرسم قطاع.». Then «الالتصاق» (the checkbox «الالتصاق بنقطة أو قطاع», a slider 4–30 default 12 «مسافة الالتصاق: n بكسل», and the help text); «القطاعات (n)» + «ترتيب أبجدي» + rows (a button with swatch, name and count that selects the zone; ↑ «تحريك لأعلى», ↓ «تحريك لأسفل»; ↑ is disabled on the first row and ↓ on the last) + «عند تداخل قطاعين تُحتسب الماكينة للقطاع الأعلى في القائمة.»; and «إظهار أسماء القطاعات على الخريطة». In draw mode only «+ قطاع جديد» and «القطاع المحدد» are replaced by `DrawPanel`; «الالتصاق» and «القطاعات» stay (`Edit.dc.html:88-110`). |
| `DrawPanel` | «رسم قطاع جديد», the three numbered steps, «عدد النقاط: n · الماكينات داخل الشكل: n», and the buttons «إنهاء» (disabled below 3, title «يلزم ثلاث نقاط على الأقل»), «تراجع عن النقطة», «إلغاء». The map also shows the hint pill «انقر لإضافة نقطة، ثم انقر على النقطة الأولى لإغلاق الشكل» and the live chip «الماكينات داخل الشكل: n» (`aria-live="polite"`). |
| `ColorPicker` | A 6×2 grid of 28 px swatch buttons in a `role="radiogroup"` («لون القطاع»), each `role="radio"` with `aria-checked` and `aria-label` = colour name (`Edit.dc.html:117-119`); the tag «مقترح» on the suggested swatch while the zone is new; and «لون مخصص»: a native `<input type="color">` (precedent `hr/contracts/components/BrandingCard.tsx:107-114`) + a hex field validated with `/^#[0-9a-fA-F]{6}$/`. |
| `VertexChip` | Next to the selected vertex: «حذف النقطة» + «اسحبها لتحريكها». A shared vertex shows «نقطة مشتركة مع X و Y». |
| `SaveSummaryDialog` | `Dialog` max-w-lg, «مراجعة التغييرات قبل الحفظ»: «قطاعات جديدة n · معدّلة n · محذوفة n»; a table «القطاع \| قبل \| بعد» (counts before and after; «محذوف»; «—» for a new zone); the overlap lines; «ماكينات ستصبح بلا قطاع: n»; the buttons «الرجوع إلى التعديل» / «حفظ». |
| `ConflictDialog` | «تعذّر الحفظ» + «عدّل مستخدم آخر القطاعات بعد بدء تعديلك. مسودتك محفوظة على هذا الجهاز؛ حمّل النسخة الأحدث ثم أعد تطبيق تغييراتك.». When the last `saveDraft` failed it shows `conflict.bodyNoDraft` instead, without the "kept on this device" clause. Buttons «تحميل النسخة الأحدث» (asks the discard confirm first) / «إغلاق». |
| `DeleteZoneDialog` | «حذف «{{name}}»؟» + «ستصبح {{count}} بلا قطاع، إلا إذا كانت داخل قطاع آخر.» (count = the machines whose primary zone is this one), with «رجوع» / «حذف» (danger). |
| `DraftRestoreNotice` | «توجد مسودة غير محفوظة من جلسة سابقة.» with «استعادة المسودة» / «تجاهلها». An outdated draft shows «المسودة المحفوظة أقدم من القطاعات الحالية، ولا يمكن استعادتها.». |
| `TileErrorBanner` | §8.4. |
| `UnlocatedPanel` | The progress line «تم تحديد موقع n من m» + n % + a bar; `ReasonChips` (multi-filter, URL `reasons`); `SyncCard`; `LinkResolutionCard`; the search «رقم الماكينة أو اسمها»; the list of `UnlocatedRow` (64 px; the unlocated and review points of the selected branch whose branch has `canLocate`, §8.3); the empty state «كل الماكينات لها موقع على الخريطة.»; the no-match state. |
| `ReasonChips` | One chip per reason with a count above 0, in this order: يحتاج إلى مراجعة، رابط مختصر، تعذّر التحويل، رابط بدون إحداثيات، رمز مختصر بلا مرجع، إحداثيات غير صالحة، نص غير مقروء، أكثر من سجل مفتوح، لا يوجد سجل مفتوح، بلا موقع، لم يُقرأ من السجل بعد. |
| `UnlocatedRow` | Line 1 «{{code}} · {{name}}»; line 2: the bank dot + bank, area, branch, and the reason chip. Expanded: it fetches `GET …/location`, then shows «الموقع في السجل: …» (only when `sourceVisible`), «فتح الرابط الأصلي» (http(s) only, `noopener noreferrer`), the link failure text for `shortLinkFailed`, the review note for the pin's warning (`unlocated.reviewNote` for a short code, «رمز Plus Code مختصر؛ حُدِّد الموقع تقريبيًا بالنسبة إلى الفرع. راجعه على الخريطة ثم اعتمده أو صحّحه.»; `unlocated.weakNote`, `.viewportNote`, `.ambiguousNote` or `.disagreeNote` for the other warnings), and the buttons «اعتماد الموقع» / «تصحيح» for review rows. «تصحيح» makes the suggested pin draggable and opens `MovePinBar` (mode `pin`). Approve's success toast is the mockup's «حُدِّد موقع الماكينة {{code}} — القطاع: {{zone}}. سُجّل التغيير في سجل التدقيق.» (`Unlocated.dc.html:301`); a 409 `ATM_MAP_SOURCE_CHANGED` shows `unlocated.sourceChanged`. The row's actions exist only when the row's branch has `canLocate`. It also has the field «الصق رابطًا كاملًا أو إحداثيات أو رمز Plus Code» (placeholder `30.0444, 31.2357`) + «قراءة» → `POST /locations/parse` → the inline message (§8.12) and a temporary pin, and «وضع على الخريطة» → the map hint «انقر على مكان الماكينة {{code}} على الخريطة» → a click places a draggable pin → `MovePinBar`. Confirming a pin that was neither dragged nor moved after «قراءة» sends `{ mode: 'text', text, expected: <the previewed point> }`; otherwise it sends `{ mode: 'pin' }`. A 409 `ATM_MAP_PARSE_CHANGED` re-reads the text and shows the new preview with `parse.changed`. |
| `SyncCard` | «مزامنة المواقع من سجل الماكينات», its body text, «بانتظار المزامنة: n», «آخر مزامنة: date», and «بدء المزامنة» → `POST /locations/sync` with the selected branch → the toast «اكتملت المزامنة: …». |
| `LinkResolutionCard` | «تحويل الروابط المختصرة تلقائيًا», its body text, «بدء التحويل» and the progress «n من m», exactly the mockup's card (`Unlocated.dc.html:83-87`): no stop button and no retry (DM-46). It loops `POST /locations/resolve-links` (§8.10). When the loop ends with nothing left it shows `links.done`, «اكتمل التحويل: حُوِّل {{resolved}} من {{total}}، وتعذّر {{failed}} فبقي في القائمة لوضعه يدويًا.», or `links.doneAll`, «اكتمل التحويل: حُوِّل {{resolved}} من {{total}}.», when nothing failed (the mockup's `convert()`, `:284`). `busy` shows `links.busy`, `rateLimited` shows `links.rateLimited`, and `unreachable` shows `links.unreachable`. Leaving the page ends the loop. The pending state is on the server, so «بدء التحويل» resumes it. |

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
- **Resolve** loops in the browser. The next call starts immediately when `remaining > 0`,
  `attempted > 0`, `!busy` and `stopReason` is `null` or `'budget'`. The loop stops when `attempted ===
  0`, `busy`, `stopReason` is `'rateLimited'` or `'unreachable'`, `remaining === 0`, the page unmounts,
  or a call fails. A 401 ends it too. The idle logout (`SESSION_IDLE_MINUTES` default 10,
  `infrastructure/config/env.ts:145`) is not prevented by the app's own requests
  (`platform/auth/idle-session.ts:165-183`), and about 713 links take about 36 calls of up to about
  52 s. After signing back in, «بدء التحويل» resumes, because the pending state is on the server.
- Errors:
  - 409 `ATM_MAP_ZONES_STALE` opens `ConflictDialog`;
  - 409 `STALE_DOCUMENT` on a pin shows the toast `STALE_DOCUMENT` (`shared/lib/errors.ts`) and
    refetches the detail;
  - 409 `ATM_MAP_SOURCE_CHANGED` / `ATM_MAP_PARSE_CHANGED` show `unlocated.sourceChanged` /
    `parse.changed`;
  - a 400 on `PUT /zones` maps its detail code to `atm.map.save.error.*`: `DUPLICATE_NAME` →
    `duplicateName`, `TOO_MANY_ZONES` → `tooManyZones`, `TOO_MANY_POINTS_IN_SAVE` /
    `TOO_MANY_POINTS_IN_BRANCH` / `TOO_MANY_POINTS` → `tooManyPoints`, and the geometry codes
    (`SELF_INTERSECTION`, `TOO_FEW_POINTS`, `DUPLICATE_POINT`, `TOO_SMALL`) → `geometry`;
  - `BRANCH_MISMATCH` shows `branchChanged` and reloads the page. It can happen:
    `BranchSwitcher.choose` stores the new branch and calls `setActiveBranch` before reloading
    (`BranchSwitcher.tsx:76-85`; `api-client.ts:55`), and a cancelled `beforeunload` leaves the tab
    sending the new branch;
  - 422 `chooseBranch` and 403 `branchNotEditable` on save show `edit.chooseBranch` /
    `edit.branchNotEditable`;
  - other 400 detail codes on the location routes show the matching inline message (§8.12);
  - everything else goes through `errorMessage` (`shared/lib/errors.ts`).
- Before saving, the web checks DM-8 name uniqueness (`duplicateNames`) and the 900 KB body guard
  (§6.6), and shows the same messages without a request.

### 8.11 Accessibility

- The map host has `role="application"` and `aria-label` «خريطة الماكينات والقطاعات»
  (`BranchMapPicker.tsx:109-114` pattern).
- Canvas dots are not focusable (GM-18). Keyboard users reach machines through the search, `ZoneList`
  and the `ZoneDetail` machine rows (buttons; Enter flies to the machine and opens the popup, which
  takes focus and closes on Esc). The unlocated list rows are buttons.
- Vertex handles are focusable `divIcon`s (`keyboard: true`) with `aria-label` «نقطة رقم {{n}} في
  {{zone}}». A selected vertex moves with the arrow keys (DM-41) and is deleted with Delete. Midpoints
  have `aria-label` «نقطة قطاع — اسحبها لإضافة نقطة».
- Cluster markers are focusable `divIcon` buttons (`keyboard: true`) with the mockup's `aria-label`
  «{{count}} متجمعة — اضغط للتفصيل» (`Main.dc.html:200`, with the DM-21 count text). Enter or Space zooms
  to the cluster, or fans out a stack.
- The temporary pin in `MovePinBar` is focusable and moves with the arrow keys (DM-41).
- Every icon button has a text label or an `aria-label`. Toggles use `aria-pressed`. The colour
  swatches are a `role="radiogroup"` of `role="radio"` buttons with `aria-checked` (the mockup's
  pattern), not `aria-pressed`. The live counts are in an `aria-live="polite"` region, updated at
  gesture end only.
- When the popup or a dialog closes, focus returns to the control that opened it.
- Drawing a NEW zone is pointer-only (GM-24). Editing an existing zone's vertices works from the
  keyboard (DM-41).
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
| `aria` / `ariaEdit` | Machines and zones map / Map — edit mode | خريطة الماكينات والقطاعات *(new)* / الخريطة — وضع التعديل |
| `cluster.label` | {{countText}} grouped — press for details | {{countText}} متجمعة — اضغط للتفصيل |
| `figures.label` / `.onMap` / `.inZones` / `.outZones` / `.unlocated` | Map figures / On the map / Inside zones / Outside zones / No location | أرقام الخريطة *(new)* / على الخريطة / داخل القطاعات / خارج القطاعات / بدون موقع |
| `actions.unlocated` / `actions.editZones` | Machines without a location / Edit zones | ماكينات بدون موقع / تعديل القطاعات |
| `filters.bank` / `.area` / `.zone` / `.status` / `.location` / `.all` / `.search` | Bank / Area / Zone / Status / Location / All / Machine ID or name | البنك / المنطقة / القطاع / الحالة / الموقع / الكل / رقم الماكينة أو اسمها |
| `filters.bankNone` / `.zoneNone` / `.zoneMulti` | No bank set / No zone / In more than one zone | بنك غير محدد / بلا قطاع / في أكثر من قطاع |
| `status.active` / `.archived` / `.all` | In operation / Archived / All | قيد التشغيل / مؤرشفة *(new; GM-22)* / الكل |
| `location.located` / `.review` | On the map / Needs review | على الخريطة / يحتاج إلى مراجعة |
| `panel.branch` / `.branchAll` / `.zones` / `.zonesSearch` | Branch / All branches / Zones ({{count}}) / Search zones | الفرع / كل الفروع / القطاعات ({{count}}) / بحث في القطاعات |
| `panel.summaryIn` / `.summaryOut` / `.summaryUnlocated` | Inside zones: / Outside zones: / No location: | داخل القطاعات: / خارج القطاعات: / بدون موقع: |
| `panel.toggle` / `.narrowNote` | Side panel / Zone editing is available on wider screens only. | اللوحة الجانبية *(new)* / تعديل القطاعات متاح على الشاشات الأعرض فقط. *(new)* |
| `layers.title` / `.pins` / `.zones` / `.names` / `.faded` | Layers / Show machines / Show zones / Show zone names on the map / Faded streets (zone colours stand out) | الطبقات / إظهار الماكينات / إظهار القطاعات / إظهار أسماء القطاعات على الخريطة / شوارع باهتة (لتظهر ألوان القطاعات أوضح) |
| `layers.colorBy` / `.byZone` / `.byBank` / `legend.bank` | Colour machines by: / Zone / Bank / Bank colours | تلوين الماكينات حسب: / القطاع / البنك / ألوان البنوك *(new)* |
| `count.zero` / `.one` / `.two` / `.few` / `.many` | No machines / 1 machine / 2 machines / {{count}} machines / {{count}} machines | لا ماكينات / ماكينة واحدة / ماكينتان / {{count}} ماكينات / {{count}} ماكينة |
| `detail.back` / `.edit` / `.byBank` / `.byArea` / `.machines` / `.overlapsOthers` | Back to zones / Edit / By bank / By area / Machines / Partly inside other zones: {{count}} | رجوع إلى القطاعات / تعديل / حسب البنك / حسب المنطقة / الماكينات / يقع جزء منه في قطاعات أخرى: {{count}} *(new)* |
| `popup.close` / `.branch` / `.zone` / `.zoneMulti` / `.source` / `.lastSet` / `.approved` | Close / Branch / Zone / In more than one zone: {{names}} — counted for «{{primary}}» / Location source / Location last moved / Location approved | إغلاق / الفرع / القطاع / في أكثر من قطاع: {{names}} — يُحتسب على «{{primary}}» *(new)* / مصدر الموقع / آخر تحريك للموقع / اعتُمد الموقع *(new)* |
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
| `edit.branchLocked` / `.locked` / `.newZone` / `.selected` / `.name` / `.color` / `.colorGroup` / `.custom` / `.suggested` | Branch: / Locked while there are unsaved changes / New zone / Selected zone / Zone name / Colour / Zone colour / Custom colour / Suggested | الفرع: / مقفول أثناء وجود تغييرات غير محفوظة / قطاع جديد / القطاع المحدد / اسم القطاع / اللون / لون القطاع / لون مخصص / مقترح *(new)* |
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
| `save.error.duplicateName` / `.tooManyZones` / `.tooManyPoints` | Another zone in this branch has the same name. / A branch cannot have more than 200 zones. / Too many points: a branch's zones may have at most 20,000 points in total. | يوجد قطاع آخر بالاسم نفسه في هذا الفرع. / لا يمكن أن يزيد عدد القطاعات في الفرع على 200. / عدد النقاط كبير جدًا؛ يجب ألا يزيد مجموع نقاط قطاعات الفرع على 20000. *(all new)* |
| `save.error.geometry` / `.branchChanged` | One zone's shape is not valid. Check for crossing borders, the number of points and the area. / The branch chosen in the top bar changed. The page will reload. | شكل أحد القطاعات غير صالح. راجع تقاطع الحدود وعدد النقاط والمساحة. / تغيّر الفرع المختار في القائمة العلوية. سيُعاد تحميل الصفحة. *(all new)* |
| `conflict.title` / `.body` / `.bodyNoDraft` / `.reload` / `.close` | Could not save / Another user changed the zones after you started editing. Your draft is kept on this device; load the latest version, then apply your changes again. / Another user changed the zones after you started editing. Load the latest version, then apply your changes again. / Load the latest version / Close | تعذّر الحفظ *(new)* / عدّل مستخدم آخر القطاعات بعد بدء تعديلك. مسودتك محفوظة على هذا الجهاز؛ حمّل النسخة الأحدث ثم أعد تطبيق تغييراتك. / عدّل مستخدم آخر القطاعات بعد بدء تعديلك. حمّل النسخة الأحدث ثم أعد تطبيق تغييراتك. *(new)* / تحميل النسخة الأحدث / إغلاق |
| `deleteZone.title` / `.body` / `.back` / `.confirm` | Delete «{{name}}»? / {{count}} will have no zone, unless inside another zone. / Back / Delete | حذف «{{name}}»؟ / ستصبح {{count}} بلا قطاع، إلا إذا كانت داخل قطاع آخر. / رجوع / حذف |
| `discard.body` / `leave.body` / `draft.found` / `draft.restore` / `draft.ignore` / `draft.outdated` | Discard all unsaved changes? / You have unsaved changes. Leave without saving? / An unsaved draft from an earlier session exists. / Restore the draft / Ignore it / The saved draft is older than the current zones and cannot be restored. | إلغاء كل التغييرات غير المحفوظة؟ / لديك تغييرات غير محفوظة. هل تريد المغادرة دون حفظ؟ / توجد مسودة غير محفوظة من جلسة سابقة. / استعادة المسودة / تجاهلها / المسودة المحفوظة أقدم من القطاعات الحالية، ولا يمكن استعادتها. *(new)* |

**Moving a pin and the unlocated screen (`atm.map.move.*`, `atm.map.unlocated.*`, `atm.map.parse.*`,
`atm.map.links.*`, `atm.map.sync.*`)**

| Key | en | ar |
|---|---|---|
| `move.hint` / `.zone` / `.confirm` / `.cancel` / `.clickHint` / `.markerAria` | Drag the marker to the right place / · Zone: {{zone}} / Confirm location / Cancel / Click the location of machine {{code}} on the map / Machine {{code}} marker — drag it to adjust | اسحب العلامة إلى الموقع الصحيح / · القطاع: {{zone}} / تأكيد الموقع / إلغاء / انقر على مكان الماكينة {{code}} على الخريطة / علامة الماكينة {{code}} — اسحبها لضبط الموقع |
| `move.dialogTitle` / `.distance` / `.zoneChange` / `.reason` / `.reasonRequired` / `.back` / `.ok` / `.done` | Confirm the move / The location moved {{km}} km / Zone: {{from}} ← {{to}} / Reason for the move / Give a reason: the move is over 1 km. / Back / Confirm / Machine {{code}} located — zone: {{zone}}. The change is recorded in the audit log. | تأكيد تحريك الموقع *(new)* / تحرّك الموقع {{km}} كم / القطاع: {{from}} ← {{to}} / سبب التحريك / اذكر سبب التحريك لأن المسافة تزيد على 1 كم. *(new)* / رجوع / تأكيد / حُدِّد موقع الماكينة {{code}} — القطاع: {{zone}}. سُجّل التغيير في سجل التدقيق. |
| `unlocated.title` / `.progress` / `.back` / `.search` / `.empty` / `.sourceLabel` | Machines without a location / Located {{done}} of {{total}} / Back to the map / Machine ID or name / Every machine has a location on the map. / Location in the register: | ماكينات بدون موقع / تم تحديد موقع {{done}} من {{total}} / رجوع إلى الخريطة / رقم الماكينة أو اسمها / كل الماكينات لها موقع على الخريطة. / الموقع في السجل: |
| `unlocated.reviewNote` / `.weakNote` / `.approve` / `.correct` | Short Plus Code; the location was estimated relative to the branch. Check it on the map, then approve or correct it. / The location was estimated from few or widely spread machines in the branch; check it carefully. / Approve location / Correct | رمز Plus Code مختصر؛ حُدِّد الموقع تقريبيًا بالنسبة إلى الفرع. راجعه على الخريطة ثم اعتمده أو صحّحه. / حُدِّد الموقع تقريبيًا من ماكينات قليلة أو متباعدة في الفرع؛ راجعه بعناية. *(new)* / اعتماد الموقع / تصحيح |
| `unlocated.viewportNote` / `.ambiguousNote` / `.disagreeNote` | The link gives only where the map was centred, not the machine's own point. Check the location, then approve or correct it. / The link carries more than one point. Check the location, then approve or correct it. / The register's location text points to two places far apart. Check the location, then approve or correct it. | يحدد الرابط منطقة عرض الخريطة فقط، لا موقع الماكينة نفسه. راجع الموقع ثم اعتمده أو صحّحه. / يحمل الرابط أكثر من موقع. راجع الموقع ثم اعتمده أو صحّحه. / يشير نص الموقع في السجل إلى مكانين متباعدين. راجع الموقع ثم اعتمده أو صحّحه. *(all new)* |
| `unlocated.sourceChanged` | The register's location text changed after this location was suggested. Run the sync, then review it again. | تغيّر نص الموقع في السجل بعد اقتراح هذا الموقع. شغّل المزامنة ثم راجعه من جديد. *(new)* |
| `unlocated.paste` / `.read` / `.place` / `.openOriginal` | Paste a full link, coordinates or a Plus Code / Read / Place on the map / Open the original link | الصق رابطًا كاملًا أو إحداثيات أو رمز Plus Code / قراءة / وضع على الخريطة / فتح الرابط الأصلي |
| `reason.review` / `.shortLink` / `.shortLinkFailed` / `.noCoordinates` / `.unreadable` / `.none` | Needs review / Short link / Could not convert / Link without coordinates / Unreadable text / No location | يحتاج إلى مراجعة / رابط مختصر / تعذّر التحويل / رابط بدون إحداثيات / نص غير مقروء / بلا موقع |
| `reason.invalidCoordinates` / `.shortPlusCodeNoReference` / `.noEntry` / `.conflictingEntries` / `.notSynced` | Invalid coordinates / Short code without a reference / No open register entry / More than one open entry / Not yet read from the register | إحداثيات غير صالحة / رمز مختصر بلا مرجع / لا يوجد سجل مفتوح / أكثر من سجل مفتوح / لم يُقرأ من السجل بعد *(all new)* |
| `parse.ok` / `.shortLink` / `.noCoordinates` / `.unreadable` / `.invalidCoordinates` | Coordinates read. Drag the marker to adjust it if needed, then press «Confirm location». / This is a short link with no coordinates. Open it, copy the full link from the address bar and paste it here. / The link is for a named place and has no coordinates. Place the marker by hand on the map. / The location could not be read. Paste a full link or coordinates such as 30.0444, 31.2357. / The coordinates are not valid. | تمت قراءة الإحداثيات. اسحب العلامة لضبطها إن لزم، ثم اضغط «تأكيد الموقع». / هذا رابط مختصر لا يحمل إحداثيات. افتحه، ثم انسخ الرابط الكامل من شريط العنوان والصقه هنا. / الرابط لمكان مسمّى ولا يحمل إحداثيات. ضع العلامة يدويًا على الخريطة. / تعذّرت قراءة الموقع. الصق رابطًا كاملًا أو إحداثيات مثل 30.0444, 31.2357. / الإحداثيات غير صالحة. |
| `parse.changed` / `.viewportReview` | The reading of the location changed. Check the new marker, then confirm. / The link gives only where the map was centred; put the marker on the machine itself before confirming. | تغيّرت نتيجة قراءة الموقع. راجع العلامة الجديدة ثم أكّد. / يحدد الرابط منطقة عرض الخريطة فقط؛ ضع العلامة على الماكينة نفسها قبل التأكيد. *(all new)* |
| `parse.outsideEgypt` / `.shortPlusCodeReview` / `.shortPlusCodeNoReference` | The location is outside Egypt; check it before saving. / Short Plus Code; the location was estimated relative to the branch. Check it before confirming. / Short Plus Code, and no located machine in the branch to recover it from. Paste the full code or place the marker by hand. | الموقع خارج حدود مصر؛ تأكّد منه قبل الحفظ. / رمز Plus Code مختصر؛ حُدِّد الموقع تقريبيًا بالنسبة إلى الفرع. راجعه قبل التأكيد. *(new)* / رمز Plus Code مختصر ولا توجد ماكينات محددة الموقع في الفرع لاستنتاج موقعه. الصق الرمز الكامل أو ضع العلامة يدويًا. *(new)* |
| `linkFailure.timeout` / `.noCoordinates` / `.httpStatus` / `.tooManyRedirects` / `.hostNotAllowed` / `.network` / `.invalidUrl` | The connection timed out. / The link leads to a named place without coordinates. / The server answered with an unexpected code. / The link exceeded the allowed number of redirects. / The link leads to a site that is not allowed. / The server could not be reached. / The link is not valid. | انتهت مهلة الاتصال. / يؤدي الرابط إلى مكان مسمّى بلا إحداثيات. / ردّ الخادم برمز غير متوقع. / تجاوز الرابط عدد التحويلات المسموح. / يؤدي الرابط إلى موقع غير مسموح. / تعذّر الاتصال بالخادم. / الرابط غير صالح. *(all new)* |
| `linkFailure.consentPage` | Google answered with a consent page instead of the location. | أعاد Google صفحة موافقة بدل الموقع. *(new)* |
| `links.title` / `.body` / `.start` / `.progress` | Convert short links automatically / The server opens each short link once and reads the coordinates. Whatever cannot be converted stays in the list to be placed by hand. / Start converting / {{done}} of {{total}} | تحويل الروابط المختصرة تلقائيًا / يفتح الخادم كل رابط مختصر مرة واحدة ويقرأ الإحداثيات. ما يتعذّر تحويله يبقى في القائمة لوضعه يدويًا. / بدء التحويل / {{done}} من {{total}} |
| `links.done` / `.doneAll` | Conversion finished: {{resolved}} of {{total}} converted; {{failed}} could not be and stay in the list to be placed by hand. / Conversion finished: {{resolved}} of {{total}} converted. | اكتمل التحويل: حُوِّل {{resolved}} من {{total}}، وتعذّر {{failed}} فبقي في القائمة لوضعه يدويًا. / اكتمل التحويل: حُوِّل {{resolved}} من {{total}}. |
| `links.busy` / `.rateLimited` / `.unreachable` | Another conversion is running. Try again in a minute. / Google asked to slow down. Conversion stopped; try again later. / The server could not reach Google. Conversion stopped, and the links are still waiting. | يجري تحويل آخر الآن. حاول بعد دقيقة. / طلب Google التمهّل. توقّف التحويل؛ أعد المحاولة لاحقًا. / تعذّر الوصول إلى Google من الخادم. توقّف التحويل، وبقيت الروابط بانتظار التحويل. *(all new)* |
| `sync.title` / `.body` / `.start` / `.pending` / `.last` / `.done` | Sync locations from the ATM register / The sync reads each machine's location from the two location columns of the ATM register. It does not change a location set by hand or approved unless the register's location text changed. / Start syncing / Waiting to sync: {{count}} / Last sync: {{at}} / Sync finished: {{located}} located, {{review}} need review, {{unlocated}} still without a location. | مزامنة المواقع من سجل الماكينات / تقرأ المزامنة مواقع الماكينات من خانتي الموقع في سجل الماكينات، ولا تغيّر موقعًا حُدِّد يدويًا أو اعتُمد إلا إذا تغيّر نص الموقع في السجل. / بدء المزامنة / بانتظار المزامنة: {{count}} / آخر مزامنة: {{at}} / اكتملت المزامنة: حُدِّد موقع {{located}}، ويحتاج {{review}} إلى مراجعة، وبقي {{unlocated}} بلا موقع. *(all new)* |

Existing keys are reused where they say the same thing: `atm.common.bank`, `atm.common.machineId`,
`atm.common.machineName` and `atm.common.area` (`atm-i18n.spec.ts:16-19`).

### 8.13 Mockup elements not built, or built differently

| Mockup element | In the build | Why |
|---|---|---|
| The sidebar «جديد» pill on «خريطة الماكينات» (`Main.dc.html:59`) | not built | No nav-badge mechanism exists; the nav row is a plain catalog row (§7.3). |
| The tag «حسب قرارك» on the link card (`Unlocated.dc.html:83`) | not built | An annotation for the owner, not product text. |
| The stand-in caption «الخلفية رسم توضيحي — الشوارع الفعلية من OpenStreetMap» (`Main.dc.html:243`) | not built | The real map shows OSM tiles. Only «© OpenStreetMap» remains, because Leaflet's prefix is turned off (DM-28). |
| The bank legend's 6 banks | 6 banks + «بنك غير محدد» | Machines without an open entry have no bank code (DM-17). |
| The status options «بدون تاريخ بدء / تم التسليم» | «مؤرشفة» | DM-16; shown to the owner as GM-22. |
| A stop or retry control on the link card | not built, as in the mockup | DM-46. |
| «آخر تحديث للموقع» (first draft of this spec) | «آخر تحريك للموقع» / «اعتُمد الموقع» | The approved plan's label (DM-20). |
| ZoneDetail machine rows | the mockup's three columns: code, name, bank | `Main.dc.html:162` and following. |

---

## 9. Tests

All workbook-like fixtures are **synthetic** (codes 1001–1050, «ماكينة تجريبية n», «منطقة تجريبية n»; the
research checked that none of these codes occurs in the workbook).

### 9.1 Contracts — `packages/contracts/src/modules/atm-map-geometry.spec.ts`, `atm-map.spec.ts` (NEW)

- **`pointInPolygon`** (projected plane, DM-48):
  - inside; outside; exactly on an edge (inside); on a vertex (inside);
  - a concave "C" with the point in the notch (outside);
  - a point east of the ring at the same latitude as a vertex (no double count);
  - a point between the lat/lng chord and the Mercator chord of the edge (24.0, 32.8)–(31.5, 32.3)
    is classified the way Leaflet draws it.
- **`segmentsIntersect` / `selfIntersects`:**
  - bow-tie `[(0,0),(1,1),(1,0),(0,1)]` → true;
  - a square → false;
  - consecutive edges touching only at their shared vertex → false;
  - the consecutive back-track `[(0,0),(2,0),(1,0),(1,1)]` → true;
  - a vertex lying on a non-adjacent edge → true;
  - a vertex repeated at two non-consecutive positions (a pinch) → true;
  - a 500-point regular polygon → false within 50 ms.
- **`polygonsOverlap`:**
  - disjoint → false;
  - a shared full edge (snapped borders) → false;
  - only a shared vertex → false;
  - a crossing → true;
  - containment → true;
  - the triangle (0,0),(1,0),(1,1) on a square's own vertices → true;
  - the triangle (0,0),(2,0),(0,2) inside the square (0,0),(2,0),(2,2),(0,2) → true;
  - two identical rings → true;
  - a C-shaped ring and a small ring inside its notch, not touching → false;
  - a vertex 1e-8 inside the other polygon's edge → false (ε).
- **`polygonAreaM2`:** a 0.001° square at 30°N ≈ 10,707.8 m² (±0.5 %); 0.0001° ≈ 107.1 m²; 0.00009°
  ≈ 86.7 m², which `zoneGeometryIssues` reports as `TOO_SMALL`.
- **`zoneGeometryIssues`:** 2 points `TOO_FEW_POINTS`; 501 `TOO_MANY_POINTS`; a repeated consecutive
  point and last = first `DUPLICATE_POINT`; a bow-tie and a pinch `SELF_INTERSECTION`.
- **Schemas:**
  - `SaveAtmMapZoneSetSchema`: duplicate tempId refused; an id both updated and deleted refused; an
    update naming no field refused; a 61-character name refused; the name trimmed; the colour
    `#ABCDEF` becomes `#abcdef`; `#abc` refused; a 200-entry `order` accepted and 201 refused; an
    `order` entry that is neither an ObjectId nor a tempId refused; 20,001 points over creates +
    updates → `TOO_MANY_POINTS_IN_SAVE`, 20,000 accepted.
  - `PlaceAtmMachineLocationSchema` discriminates on `mode`; lat 91 refused; `version: null` accepted;
    `mode: 'text'` without `expected` refused.
  - `ResolveAtmMapLinksSchema` refuses `retryFailed` (strict).
  - The palette has 12 unique hexes, and exactly the 5 light colours are `cased`.

### 9.2 API unit — `apps/api/src/modules/atm/map/**` (NEW)

- **`location/plus-code.spec.ts`:**
  - every vector in §4.1, including the cell-edge vector `7GJR6WGF+H3` and the grid vectors; decoded
    values compared with `toBeCloseTo(…, 9)`;
  - an exact reference written with `BigInt` in the spec agrees with `encode` on 10,000 seeded random
    6-decimal points inside DM-35's box;
  - round trip `decode(encode(p)).centre` within half a cell for 5 Egyptian points;
  - uppercase and lowercase give the same result;
  - each "invalid" code is refused by `isValidCode`; `WG2H26VP+Q7` is valid but neither full nor
    short; `2600+` is never short; the recovery window of each short length (±10° / ±0.5° /
    ±0.025°).
- **`location/maps-text.spec.ts`:**
  - URL shapes:
    - the place `!3d!4d` beats `@` (the `maps-link.spec.ts:29-35` case);
    - `?q=`, `?q=loc:`, `api=1&query=` → pin; `?q=Building 26, 30 St` → `noCoordinates`;
    - `ll=` / `center=` only → `viewport`;
    - `/maps/search/30.0444,+31.2357` and `/maps/place/30.0444,31.2357` → pin;
    - `/maps/search/<name>/@…` and a `/place/<name>/@…` URL without `!3d!4d` → `viewport`;
    - `/maps/dir/…/@30,31` → `noCoordinates` (no viewport on directions);
    - two distinct `!3d!4d` pairs more than 50 m apart → pin with `ambiguous`;
    - `/place/26VP%2BQ7+Cairo/@30.05,31.2` → `shortPlusCode` `26VP+Q7` with the URL reference;
    - `/place/8G2H26VP%2BQ7/@30.1,31.3` → `plusCode` (a full code beats the viewport);
    - a DMS place (30.044389, 31.235694);
    - `maps.app.goo.gl/x` and `goo.gl/maps/x` → `shortLink`; `goo.gl/mapsX` and `goo.gl/other` →
      `noCoordinates`;
    - a named place → `noCoordinates`;
    - `https://example.com/@30,31` → `noCoordinates` (no digit mining);
    - `plus.codes/8G2H26VP+Q7` → `plusCode` (no `+` → space there);
    - `maps.app.goo.gl/abc` without a scheme, at the start of the cell and after other words →
      `shortLink`;
    - `https://maps.app.goo.gl/abc)،` and a short link with Arabic letters stuck to it → the URL
      without them.
  - Plain text:
    - `30.0444, 31.2357` and `30.0444،31.2357` → coordinates;
    - `91, 0` → `invalidCoordinates`;
    - `8G2H26VP+Q7` → `plusCode`; `8G2H26VP+` → `unreadable`;
    - `26VP+Q7 القاهرة` → `shortPlusCode` (`26VP+Q7`);
    - DMS with E first, with S/W (negative), and with 60 minutes (→ `unreadable`);
    - `hello` → `unreadable`;
    - two URLs in one cell → two candidates in order.
  - Distances: `haversineMeters((30.0444,31.2357),(30.0534,31.2357))` ≈ 1000.76 and `…(30.0533,…)`
    ≈ 989.64.
  - Egypt: `insideEgypt` true for Cairo and for Aswan (24.0889, 32.8998); false for (0,0) and (21.0, 31.0).
- **`location/derive.spec.ts`:**
  - every row of the ranking table (§4.3), including "AV coordinates beat an AP full code", "a full
    code beats a short link", "a resolved link beats a short code", "a short code with an unresolved
    link returns the link to queue", "a viewport is a review pin with `viewportOnly`", and "a rank 1
    winner returns `shortLinkUrl: null`";
  - `sourcesDisagree` for two candidates 1.2 km apart, none at 0.9 km;
  - several open entries: per-field equal sets → derived, with both ids in `seenEntryIds`; one
    differing field → `conflictingEntries`, `seenText: null`; `bankCode` null when the codes differ;
  - `referenceFor`: area vs branch; the median ignores an outlier; an even count gives the mean of
    the two middle values; review pins, `registerShortCode` pins, pins with warnings, deleted machines
    and the machine itself are excluded; `weakReference` for a 2-pin basis and for a basis pin 0.5°
    away;
  - no reference → `shortPlusCodeNoReference`;
  - every row of the precedence table, including:
    - "pinned + changed text + unlocated → pin kept, `seenText` updated, `pinText` unchanged";
    - "a pin set at AV = A; AV becomes short link B; sync keeps the pin and queues B; B resolves →
      the pin is replaced" (the DM-2 scenario);
    - "a replaced pin clears `pinText`, review and move provenance".
- **`location/short-link-resolver.spec.ts`** (fake `lookup`/`hop`/`sleep`/`now`, a logger spy):
  - `http://maps.app.goo.gl/x` is requested as `https:`;
  - `https://maps.app.goo.gl@evil.example/x`, `https://evil.example/x`, `https://1.2.3.4/x`,
    `https://maps.app.goo.gl:8443/x` and `https://goo.gl/mapsX` never call `hop`;
  - a lookup answering a private address → `hostNotAllowed` with no `hop`; `ENOTFOUND` → `network`;
    a lookup that never answers → `timeout` within 5 s (fake timers);
  - a 302 whose Location carries `!3d!4d` resolves after exactly **one** hop;
  - two redirects then a coordinates URL resolve;
  - six redirects give `tooManyRedirects` after 5 hops;
  - a Location to `evil.example` gives `hostNotAllowed` and is not requested;
    `https://evil.example/@30,31` is NOT read as coordinates;
  - a Location longer than 4096 characters, and one `new URL` cannot parse → `invalidUrl`;
  - `consent.google.com?continue=<encoded maps URL with !3d!4d>` resolves without a request to
    `consent.google.com`; a consent page whose `continue` has no point → `consentPage`;
  - a 200 on a named-place URL gives `noCoordinates`; a 404 gives `httpStatus`; an `AbortError`
    gives `timeout`;
  - a 429 or 503 → the run stops with `rateLimited`, and the link stays `pending` with `attempts`
    unchanged; a `network` failure on the first hop → `unreachable`, the link stays `pending`;
  - `cancel()` is called on every response;
  - `sleep(300)` happens between links but not after the last;
  - a batch of 25 processes 20; the 40 s budget, checked before every hop, stops with
    `stopReason: 'budget'` and clears the unfinished claims;
  - **logging:** across all the cases above, the logger spy never receives a URL path, a query
    string or an error object; only `{ host, status, failure }`.
- **`map-scope.spec.ts`:**
  - `mapScopeMatch`: organization `{}`; branch → home; department reach → `departmentBranchIds`;
    section → home branch; own → `NEVER_MATCH`; a non-organization shape for which `orgScopeMatch`
    answers `{}` → `NEVER_MATCH`;
  - contrast: the machine repository's widening (`orgScopeMatch` without options) gives `{}` for a
    department selector;
  - `narrowToBranch`: out of reach throws `ValidationError` with `OUT_OF_REACH`, in reach gives
    `{ branchId }`;
  - `writableBranches` drops branches `keyReachesBranch` refuses, and returns `'all'` only for an
    `organization` grant;
  - `resolveZoneEditBranch`:
    - **case A:** an organization editor placed in Alex with the top bar at Tanta → Tanta; with
      «كل الفروع» in a multi-branch company → `chooseBranch`;
    - **case B:** a branch editor in Alex whose other key reaches Tanta through a delegation, with
      the top bar at Tanta → Alex;
    - a branch editor in Alex with any top bar → Alex;
    - a department-scoped editor → `branchNotEditable`.
- **`location.service.spec.ts`:** `openEntryLocationTexts` uses exactly the projection `{ _id,
  machineId, locationUrl, locationPlusCode }`. Its rows (integration, §9.3 #4) carry no `keys`,
  `receiptNotes`, `handoverNotes` or `safeCombination`.
- **`atm-indexes.spec.ts`** (existing, extended): `atmIndexedModels()` lists `atm_map_zones`,
  `atm_map_zone_sets` and `atm_machine_locations` with `rowsInLog: true`.

### 9.3 API integration — `apps/api/tests/integration/atm-map.spec.ts` (NEW)

The setup follows `atm-machines-filter.spec.ts` (replica set, `bootPlatform`, `mkUser`, grants per
scope). Run it with `cd apps/api && MONGOMS_SYSTEM_BINARY=/opt/mongod/mongod npx vitest run
tests/integration/atm-map.spec.ts`. Cases:

1. **Permissions:**
   - with no `atmMap.view`, `GET /points|/zones|/context` → 403;
   - with no `atmZone.manage`, `PUT /zones` → 403;
   - with no `atmMachine.locate`, every `/locations/*` and `/machines/*` route → 403;
   - with `atmMachine.locate` but no `atmMap.view`, the same routes → 403;
   - super-admin holds all three after boot (`seedAtm`).
2. **Read scope:**
   - an Alex `branch` viewer sees only Alex points and zones;
   - an Alex `department` viewer sees Alex only, while the same grant on `/atm/machines` widens — the
     contrast is asserted;
   - a **delegated department copy in Tanta** reads all of Tanta's points, and cannot place a pin
     there (403);
   - an `own` viewer gets `points: []` and `branches: []`;
   - an organization viewer with `x-active-branch: Tanta` sees Tanta only, and `GET /context` says
     `organizationWide: false`;
   - `?branchId=<Tanta>` for the Alex viewer → 400 `OUT_OF_REACH`; for the organization viewer it
     narrows;
   - archived machines are hidden by default, shown with `status=archived`; deleted machines never
     appear;
   - the points DTO carries only its allowlisted fields: no `sourceText`, `seenText`, `pinText`,
     `manualText`, `moveReason` or `shortLink`.
3. **Context:** a branch user; an organization user with a top bar (`editBranchId` = that branch); a
   placed organization user without a top bar (`editBranchId: null`, `editBlocked: 'chooseBranch'`);
   an `own` user.
4. **Zone save:**
   - first save `revision: 0` with 2 creates → revision 1, `order` as sent, 2 `create` audits with
     `entityType: 'mapZone'` carrying their final `order`;
   - an update (name + points) of zone A + a delete of zone B + a move of zone D above zone C, in one
     request → revision 2, one `delete` audit for B, and one `update` audit for each zone whose stored
     `order` changed (A's audit also carries its name and point diffs). The deleted zone is gone from
     `GET`;
   - revision 1 again → 409 `ATM_MAP_ZONES_STALE` and the database is unchanged;
   - **two concurrent saves** with the same revision → exactly one 200 and one 409;
   - a bow-tie, 2 points, 501 points, lat 91 and an area < 100 m² → 400 with field paths;
   - 20,001 points in one save → 400 `TOO_MANY_POINTS_IN_SAVE`; a save that would take the branch
     above 20,000 → 400 `TOO_MANY_POINTS_IN_BRANCH`;
   - duplicate names, including "  قطاع  أ " vs "قطاع أ" → 400 `DUPLICATE_NAME`;
   - a swap of two names in one save → 200;
   - an id from another branch → 400 `UNKNOWN_ZONE`; an `order` missing an id → 400 `ORDER_MISMATCH`;
   - `body.branchId ≠` the resolved branch → 400 `BRANCH_MISMATCH`;
   - an organization editor with **no home and no top-bar branch** in a multi-branch company → 422;
   - case A: an organization editor placed in Alex with `x-active-branch` = Tanta saves under Tanta;
   - an Alex `branch` editor saving with `x-active-branch` = Tanta still files under Alex (the
     switcher only narrows) → `BRANCH_MISMATCH` when the body says Tanta;
   - an editor whose `atmZone.manage` is department-scoped → 403;
   - `GET /zones?branchId=<a branch with no set>` → `revision: 0`, `zones: []`;
   - a 1.1 MB body → not 2xx, and nothing is written (the platform's answer is GM-21's; the test does
     not pin 500);
   - the 31st save in a minute by one user → 429.
5. **Sync:** fixtures are open entries with synthetic AP/AV for: URL coordinates, a full code, a
   short code in a branch with located pins, a short code in an empty branch, a short link, another
   link, a viewport-only URL, unreadable text, empty cells, a machine without an open entry, a
   machine whose entries are all ended, and an exempt pair with differing texts.
   - Assert each document's status, source, reason and warnings, and `needsReview` for the short code
     and the viewport.
   - A second sync → `changed: 0`, and `lastSyncAt` is the second sync's time.
   - Exactly **one** run audit row `atmMapLocationSync`, listing every changed machine id.
   - A pinned machine whose pin the sync replaces also gets its own `machineLocation` `update` audit.
   - **Version guard:** a pin placed between the sync's load and its write (a test hook between steps
     2 and 4) survives, and the result has `conflicts: 1`.
   - **Error contract (routes 7 and 8):** a department-scoped `locate` → 403; an empty writable set
     with a branch named → 403; a `branchId` outside the read reach → 400 `OUT_OF_REACH`; a readable
     but not writable branch → 403.
   - The rows `openEntryLocationTexts` returns carry no `keys`, `receiptNotes`, `handoverNotes` or
     `safeCombination`.
6. **Precedence:**
   - a manual pin + sync with the same text → kept;
   - change AP on the entry (through the register service) + sync → re-derived;
   - change AP to `''` + sync → the pin is kept, `seenText` updated, `pinText` unchanged;
   - a re-receipt with the same text, then one sync → `pendingSync` = 0.
7. **Pins:**
   - `PUT` with `version: null` creates (audit `create`, `entityId = machineId`);
   - a stale version → 409; `version: null` when a document exists → 409;
   - a move of 1000.76 m without a reason → 400 `REQUIRED`, and 989.64 m without a reason → 200;
   - `mode: 'text'` with a short link → 400 `shortLink`; with an `expected` 5 m off → 409
     `ATM_MAP_PARSE_CHANGED`; a pasted short code confirmed → `needsReview: false`, `reviewedBy` set;
   - `approve` on a review pin → `needsReview: false`, `pinned: true`; `approve` again → 422;
   - `approve` with the version loaded before a sync moved the point → 409 `STALE_DOCUMENT`;
   - `approve` after the entry's AV changed without a sync → 409 `ATM_MAP_SOURCE_CHANGED`;
   - a key that does not reach the machine's branch → 403; a machine outside the map's read scope →
     404.
8. **Detail:** `sourceText` is visible with `atmRegister.view` over the branch and `null` without it.
   A caller who lacks `atmRegister.view` but is the entry's `createdBy` gets `sourceText: null`.
9. **Resolver:** with `setShortLinkDepsForTests`:
   - a resolved link → `registerShortLink` located;
   - a failure → `shortLinkFailed` with its failure code, and a second run does not select it again
     (one pass);
   - 25 pending → 20 attempted, `remaining: 5`;
   - one `atmMapLinkResolve` audit row, with no URL in its changes;
   - a call while the lease is held → `busy: true`, `attempted: 0`;
   - the link of an archived machine is never selected;
   - the 11th call in a minute by one user → 429.
10. **Summary:** the counts match the points within the summary scope (view ∩ locate-writable);
    `pendingSync` counts a machine created after the sync and an entry whose AV changed.
11. **Indexes** (the `fleet-indexes.spec.ts:1-7` trap): drop `ux_machine`, `ux_branch`,
    `ix_branch_order`, `ix_branch_status` and `ix_branch_link` first, then `migrateAtmIndexes()` →
    `built ≥ 5`, and all five are listed by `listIndexes`. A second run reports them `alreadyPresent`.
12. **Navigation:** `seed-navigation.spec.ts` and `auth-seed-login.spec.ts` (`:253` pattern) include
    the `/atm/map` row with `atmMap.view`.

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
  - `zonesWithEdge` finds the edge in either orientation;
  - `insertOnEdge` skips a near-duplicate;
  - `midpoints` hides edges < 40 px;
  - `wouldCrossWhileDrawing` refuses the 4th dot of a bow-tie and a back-track;
  - `round6` is applied to every point the reducer accepts;
  - **performance:** membership for 2,607 points × 200 zones of 50 vertices in under 200 ms.
- **`lib/zone-editor.spec.ts`:**
  - every transition in §8.6;
  - `FINISH_DRAW` refused below 3 points and for `TOO_SMALL`;
  - undo/redo across 101 gestures keeps 100;
  - a shared-vertex drag moves both zones, and Alt moves one;
  - `INSERT_VERTEX` on a shared edge inserts into both zones in one history step, linked;
  - a snap during a drag changes no other zone;
  - a double-click on a vertex deletes it (not below 3 points);
  - `SORT_AZ`: «قطاع 2» before «قطاع 10» in both UI locales, and ties keep their order;
  - `nextDefaultName` with «قطاع 1» and «قطاع 3» → «قطاع 2»;
  - `buildZoneSetSave`: only changed fields; reorder-only produces just `order`; a new zone gets a
    tempId; deletes are listed;
  - `dirtyCount` follows the mockup's formula: Sort A–Z on 12 zones → 1; one rename + a reorder → 1;
  - `duplicateNames` finds "  قطاع  أ " vs "قطاع أ";
  - `SAVED` clears history; `CONFLICT` keeps the draft.
- **`lib/map-labels.spec.ts`:** the label moves off a pin cluster at the centroid; hidden < 80 px or zoom
  < 9; the lower-listed label is dropped on collision.
- **`lib/map-cluster.spec.ts`:** grid groups at zoom 12; none at 15; identical points stack at any zoom;
  spiderfy radius.
- **`lib/map-colors.spec.ts`:** `suggestColor` skips used colours and then picks the least used;
  `needsCasing` true for the 5 light colours and false for indigo; `bankColor(null)` is grey.
- **`lib/map-filters.spec.ts`:** values ⇄ strings round trip; `status` default `active`;
  `zones=none,multi`; `pruneStale` removes zone ids not offered; a `branch` not in `context.branches`
  is replaced by the default; «كل الفروع» is replaced when `!organizationWide`; `mapFigures` follows
  §6.4's table.
- **`lib/map-count-text.spec.ts`:** 0, 1, 2, 3, 10, 11, 100, 101, 102, 103, 111 and 1003 in both
  locales.
- **`lib/map-shortcuts.spec.ts`:** `KeyN` maps on an Arabic layout (by `code`); nothing maps inside an
  `input`; nothing maps with `modalOpen`; ctrl+`KeyZ` with shift → redo.
- **`lib/zone-draft-storage.spec.ts`:** a storage that throws on read or write is survived and
  `saveDraft` returns `false`; an outdated revision is detected; a draft saved by user A is not
  offered to user B for the same branch.
- **`lib/useUnsavedGuard.spec.ts`:** the pure `interceptableHref(event, location)` intercepts a plain
  same-origin anchor click and leaves alone modifier clicks, middle clicks, `target="_blank"`,
  `download` and other origins.
- **`lib/map-scale.spec.ts`:** nice numbers and the m/km switch.
- **`lib/unlocated-view.spec.ts`:** chip counts hide zeros; every parse result maps to an existing
  i18n key; `resolveLoopShouldContinue` follows §8.10 (`attempted: 0`, `busy`, `rateLimited` and
  `unreachable` stop; `budget` continues).
- **`atm-map-i18n.spec.ts`:** every key in §8.12 resolves in `en` and `ar`; so do every palette name,
  every reason, every source, every warning note and every link failure (including `consentPage`).
- **`map-page.spec.tsx`** (`renderToStaticMarkup`, the `machines-page.spec.tsx` harness):
  - a viewer without `atmZone.manage` / `atmMachine.locate` gets no «تعديل القطاعات» and no
    «ماكينات بدون موقع», and the «بدون موقع» chip is not a link;
  - the points and zones queries are not enabled before `context` resolves, and a remembered `branch`
    outside `context.branches` never reaches a query key;
  - ZoneDetail shows «تعديل» only for a zone of `context.editBranchId`;
  - in edit mode the header has only the title;
  - the canvas renders its Suspense fallback;
  - the page has no subtitle.
- **`unlocated-page.spec.tsx`:** chips and cards render for a locate holder; «الموقع في السجل» is
  absent when `sourceVisible` is false; rows of a branch without `canLocate` are not listed; the link
  card has no stop and no retry button.
- **`atm-map-navigation.spec.ts`** (the `operations/operations-navigation.spec.ts` join, read as
  source): `routes.tsx` serves `/atm/map` (`atmMap.view`) and `/atm/map/unlocated` (`atmMap.view` +
  `atmMachine.locate`), and `ATM_SHORTCUTS` points at `/atm/map`.
- **Updated, existing:**
  - `atm-i18n.spec.ts` (the overview card through `ATM_SHORTCUTS`);
  - `shared/lib/remembered-filters-coverage.spec.ts` (§7.5);
  - `platform/realtime/realtime.spec.ts` (green with the §6.7 rows);
  - `system-admin/system-admin-i18n.spec.ts` (the two verbs);
  - the operations specs stay green with `BranchMapPicker` and `maps-link.ts` importing the promoted
    constants (same values).

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
| GM-1 | Can the production API host reach Google (`maps.app.goo.gl`, `www.google.com`) at all? How does Google answer a server request from that region: a consent interstitial (EU egress), a captcha, or a place page without coordinates? | The resolver handles a consent redirect by parsing `continue` only (§5.1); a consent page without a point is `consentPage`. A missing egress or a DNS outage stops the run as `unreachable` and leaves the links `pending` (DM-46), so it never marks them failed. Everything else fails into `shortLinkFailed` with a reason, and those machines go to the manual list. **Verify on deploy** (§10.2 step 5). |
| GM-2 | Do OSM tiles load in the production build under helmet's `no-referrer`? (The dev server sends no CSP or referrer headers, research `ecms-ui.md` §3.) | The new map sets `referrerPolicy: 'strict-origin-when-cross-origin'` (DM-28). `BranchMapPicker` is unchanged and keeps its current behaviour. Verify both screens on deploy. |
| GM-3 | Does the OSM tile service accept this traffic (usage policy, no SLA)? | A few office users is light use. The tile-failure banner covers outages. Any provider change is a CSP + `app-csp.spec.ts` change (`:17, 37-67`). |
| GM-4 | The research counts (877 / 18 / 163 / 713 / 26 / 5 / 805) come from the workbook snapshot, not production data. | The real numbers are whatever the first sync reports. |
| GM-5 | Workbook cells whose hyperlink target differs from their visible text: the import kept only the text (`read-register-workbook.ts:410`). Column AX (21 Google Maps URLs) is not imported (register EG-4). | Not recovered. Such machines land in the manual list. |
| GM-6 | Live updates for branch-scoped viewers (audit signals carry no `branchId`, `audit.service.ts:179`). | Organization-wide viewers get signals; branch-scoped viewers refetch. The zone-set 409 is the guard between editors. |
| GM-7 | The place names after 82 short Plus Codes cannot be geocoded offline. | Ignored. The reference comes from located machines (DM-34), and without one the reason is `shortPlusCodeNoReference`. |
| GM-8 | Branches whose machines spread over more than ±0.5° (Asyut, Tanta, Port Said; research `ux.md` §6) may recover a short code into the wrong 1° cell. A recovered point always lies within ±0.5° of its reference (§4.1), so a wrong cell cannot be seen from the distance. | Every short-code pin needs review. `weakReference` marks a basis of fewer than 3 pins or one spread over more than 0.4° (DM-34). A person approves or corrects it. |
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
| GM-20 | D-M6 cites `atm-context.ts` as the pattern, and its `currentBranchId` files an organization-wide caller who is placed in a branch under the home branch, whatever the top bar says (`shared/types/index.ts:295-303`). Reads, however, narrow to the top bar (`:230-232`). | Zones follow D-M6's wording: the top-bar branch, or the caller's only branch (`resolveZoneEditBranch`, §6.2). A placed organization-wide editor therefore edits the top-bar branch, and with «كل الفروع» is asked to choose one. **Owner to confirm.** |
| GM-21 | A request body above 1 MB is refused by `express.json` with `entity.too.large`, which the platform's `errorHandler` answers as 500 and reports to Sentry (`error-handler.ts:31-69`); nothing maps it to 413. | Platform behaviour, not changed by this feature. The point caps keep every valid save near 700 KB, and the web refuses to send more than 900 KB (§6.6). A platform-wide 413 mapping is a separate decision. |
| GM-22 | The owner's approved answer to Q8 was «قيد التشغيل افتراضيًا، والباقي من الفلتر.»: the other register statuses in the filter. A pending entry has no machine, and «تم التسليم» is not the only way a machine is archived (DM-16). | v1 offers «قيد التشغيل / مؤرشفة / الكل». **Shown to the owner**: «بدون تاريخ بدء» cannot be shown, and «تم التسليم» became «مؤرشفة». |
| GM-23 | An active machine whose register entries are all `ended` (no open entry). | `noEntry`. The last ended entry's text is not used, because it describes a period that is over. **Question for the owner:** should it be? |
| GM-24 | Drawing a NEW zone needs a pointer (clicking points on the map). | Editing an existing zone's vertices works from the keyboard (DM-41); the zone list, search and popups are keyboard-operable (§8.11). A keyboard drawing mode is not built. |

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
     grants never write (§7.1). Every locate holder also needs `atmMap.view`.
   - **Warning:** a department copy delegated in a branch (ADR-032) reads the **whole** branch on the
     map, not only that department (§7.1).
   - Holders of `atmMachine.locate` who should see the raw register text also need `atmRegister.view`.
3. **Run the sync.** On «ماكينات بدون موقع» → «بدء المزامنة», once per branch, or once organization-wide
   with no top-bar branch. Check the toast counts against the research figures (GM-4).
4. **Review the short-code pins** («يحتاج إلى مراجعة»): approve or correct them.
5. **Verify Google egress (GM-1).** Run «بدء التحويل» once and look at the first call's result.
   - `unreachable` (DNS or connection) means the host has no egress to Google. The links stay
     pending. Fix the egress and start again.
   - `rateLimited` means Google asked to slow down. Wait and start again.
   - Failures with `hostNotAllowed` or `consentPage` describe what Google answered, and those links go
     to the manual list. The resolver logs only `{ host, status, failure }` (§5.1).
   - Once calls resolve links, let it run until `remaining = 0`. There is no retry of failed links
     (DM-46); they are placed by hand. If the idle logout ends the session (about 36 calls, §8.10),
     sign in and press «بدء التحويل» again.
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
  - `map.service.ts`, `zone.service.ts`, `location.service.ts` (+ `location.service.spec.ts`)
  - `map.controller.ts`, `map.routes.ts`
- `apps/api/tests/integration/atm-map.spec.ts`

**Modified files:**
- `packages/contracts/src/index.ts` (2 exports)
- `packages/contracts/src/errors/index.ts` (4 codes: `ATM_MAP_ZONES_STALE`, `ATM_MAP_SOURCE_CHANGED`,
  `ATM_MAP_PARSE_CHANGED`, `ATM_MAP_NOT_UNDER_REVIEW`)
- `packages/contracts/src/platform/audit.ts` (2 verbs)
- `apps/api/src/modules/atm/atm.module.ts` (§7.1)
- `apps/api/src/modules/atm/atm.module.spec.ts` (§7.2)
- `apps/api/src/modules/atm/atm-indexes.ts` (§3.4) and `atm-indexes.spec.ts` (§9.2)
- `apps/api/src/platform/realtime/realtime-registry.ts` (§6.7)
- `apps/api/src/seed-navigation.ts` (§7.3) and `seed-navigation.spec.ts` (§9.3 #12)
- `apps/api/tests/integration/auth-seed-login.spec.ts` (§9.3 #12)

**Not touched:** `machine.*`, `register*`, `infrastructure/http/outbound.ts` (the resolver checks hosts
and DNS itself and passes `lookup`, §5.1), `infrastructure/http/error-handler.ts` (GM-21), `app.ts` (no
CSP or body-limit change), `atm.seed.ts`.

### WP-M2 — web (after WP-M1's contracts build)

**New files:**
- `apps/web/src/shared/lib/osm-tiles.ts` and `apps/web/src/shared/lib/google-maps-url.ts` (promoted,
  DM-28, §8.5)
- `apps/web/src/modules/atm/api/map-api.ts`, `api/map-queries.ts`
- `pages/MachineMapPage.tsx`, `pages/UnlocatedMachinesPage.tsx`
- `components/map/*` (§8.8)
- `lib/*` (§8.5, including `lib/useUnsavedGuard.ts`) and their specs
- `atm-map-i18n.spec.ts`, `map-page.spec.tsx`, `unlocated-page.spec.tsx`, `atm-map-navigation.spec.ts`

**Modified files:**
- `routes.tsx` (§8.1)
- `pages/AtmOverviewPage.tsx` (§7.4)
- `platform/localization/i18n.ts` (§8.12)
- `platform/realtime/invalidation-registry.ts` (§6.7)
- `shared/lib/remembered-filters-coverage.spec.ts` (§7.5)
- the module CSS for `.atm-map-faded`
- `scripts/check-formal-arabic.mjs` (`FORMAL` += `'بينهما'`, DM-43)
- `operations/components/BranchMapPicker.tsx` (imports `OSM_TILE_URL` / `OSM_ATTRIBUTION`; same values,
  no behaviour change)
- `operations/lib/maps-link.ts` (`mapsUrl` = the promoted `googleMapsUrl`; same output, callers
  unchanged)

**Not touched:** `shared/ui/toast/*`, `platform/layout/Sidebar.tsx` (the guard listens on `document`,
§8.7).

---

## Review log

Three critics (security, data, UI) challenged revision 1. Each finding was checked against the code
before it was applied. "Applied" means the spec now says what the finding asked for. "Partly" means the
verified part was applied and the rest was decided otherwise, with the reason given. No owner decision
(D-M1…D-M8) was changed.

### Security

| # | Outcome | Reason (one line) |
|---|---|---|
| S-1 | applied | `currentBranchId` puts home before the top bar (`types/index.ts:295-303`) while reads narrow to it (`:230-232`); `resolveZoneEditBranch` (§6.2, DM-12), `editBlocked`, cases A/B tested; GM-20. |
| S-2 | applied | Batch writes now filter `{ _id, __v }` + `$inc`, upsert with `$setOnInsert`, count `conflicts`; the claim does not bump `__v` (§6.5). |
| S-3 | applied | `scopeSelector` falls back to `own` = `createdBy` (`types/index.ts:222`; `register.repository.ts:21-25`); `hasPermission` checked first (§6.5 Detail). |
| S-4 | applied | One projected helper `openEntryLocationTexts` for summary, sync, place and approve (§4.3); K/S fields never loaded. |
| S-5 | partly | Per-link claim, cleared claims, lease, `busy`, 429/503 stop, rate limits and active-only selection applied (§5); `retryFailed` was removed instead of fixed (UI-7, DM-46). |
| S-6 | partly | The leak is real (`outbound.ts:232-233, 313`), but after S-8 the resolver pre-checks hosts and DNS, so `outboundFetch` can never refuse its calls; `outbound.ts` stays untouched; never-log-errors rule and logger-spy test added. |
| S-7 | applied | DNS raced against the hop signal, 12 s per-link deadline, budget before every hop, worst case 52 s < 60 s claim (§5.1). |
| S-8 | applied | The resolver resolves DNS itself (`ENOTFOUND`/`EAI_AGAIN` → `network`, private → `hostNotAllowed`), passes `lookup`; `consentPage` failure added. |
| S-9 | applied | `Location` coordinates read only on Google Maps hosts; exact `/maps` path rule; 4096-char cap; tests (§4.2, §5.1). |
| S-10 | partly | Verified: body-parser's error becomes 500 (`error-handler.ts:53-69`); the 413 claims were removed and the web 900 KB guard added, but the platform error handler is not changed by this feature (GM-21). |
| S-11 | applied | Branch and per-save point caps, `order` union, bbox prefilter, 30/min save limit, 20,001-point tests (DM-37, §6.1, §6.3). |
| S-12 | applied | Zone sets are read before zones; the PUT response is read inside the transaction (§6.4, §6.5). |
| S-13 | applied | Every zone whose `order` changes gets an `update` audit; audits are built inside the callback and recorded after commit; test 3 fixed. |
| S-14 | applied | All changed ids (≤ 5000) in the run row, plus a per-machine audit for every replaced pinned pin (DM-15, §6.5). |
| S-15 | partly | All locate routes also need `atmMap.view`; detail 404/403 rule; the summary scope is view ∩ locate-writable branches (not a plain `$and` of both read scopes), so «n من m» matches a list in which every row can be acted on. |
| S-16 | applied | `MovePinBar` fetches the detail for `version` and keeps the dragged point on 409 (§8.8). |
| S-17 | applied | `$and` composition, `NEVER_MATCH` for a non-organization `{}`, `writableBranches` returns `'all'` only for organization (§6.2). |
| S-18 | applied | `organizationWide` from `scopeSelector`; context loads first and a stale `branch` is pruned before queries (§6.4, §8.3). |
| S-19 | applied | Verified at `org-scope-match.ts:93-98`; §7.1 table, DM-10, rollout step 2 and an integration case. |
| S-20 | applied | 403 for an empty writable set or a readable-but-not-writable branch, 400 `OUT_OF_REACH` outside the read reach (§6.3); tested for routes 7 and 8. |
| S-21 | partly | The check is applied (DM-45), but as 409 `ATM_MAP_SOURCE_CHANGED` compared with `seenText` (the data critic's D-17 form): staleness answers 409 in this API. |
| S-22 | applied | Draft key `ecms.atmMap.zoneDraft.<userId>.<branchId>` (§8.5). |

### Data

| # | Outcome | Reason (one line) |
|---|---|---|
| D-1 | applied | `maps-link.ts:47-56` calls the centre "never the first choice"; pin vs viewport, rank 5 `viewportOnly` review pin, no `@` on `/dir/` (§4.2, §4.3, DM-44). |
| D-2 | applied | `pinText` (place/approve only) and `seenText` (every sync) split; row 5 keeps `pinText`, so the resolved link later replaces the pin (DM-2, §3.3, §4.3). |
| D-3 | applied | Same fix as S-2; the counter is named `conflicts` rather than `skippedConcurrent`. |
| D-4 | applied | `seenEntryIds`/`seenText` always derived and compared; conflicting entries store ids and `seenText: null`; test added. |
| D-5 | applied | `updateMany` of `derivedAt` for every evaluated machine after the bulk write (§6.5 step 5); test added. |
| D-6 | applied | `weakReference` replaces `farFromReference`; strict pool; post-pass-1 state; one `referenceFor`; even-count median; recovery-window table (DM-34, §4.1). |
| D-7 | applied | Re-checked here: the float form fails on cell edges (`7GJR6WGF+H2` vs `+H3`); the integer form agrees with exact fractions on 200,000 points; vectors added. |
| D-8 | applied | `WG2H26VP+Q7` moved to "valid, neither full nor short"; padding rules, padded-never-short, <10-digit full = `unreadable`; grid encoding specified and vectors checked. |
| D-9 | applied | Literal `+` → space before percent-decoding; `isFull`/`isShort` classification; full code beats viewport; short code uses the URL's viewport (basis `'url'`). |
| D-10 | applied | Whole-value anchored pair for `q`/`query`/`destination`/`daddr`, exact path pairs (§4.2). |
| D-11 | applied | All `!3d!4d` pairs collected; > 50 m apart → `ambiguousUrl` review. |
| D-12 | applied | Same as S-9. |
| D-13 | applied | Per-link claim, cleared claims, `remaining` ignores this run's claims; the `retryFailed` part is moot (UI-7). |
| D-14 | applied | `shortLinkUrl` only when the winner ranks 4 or worse (or is the link); `shortLink: null` when none; place/approve clear it, so pinned documents leave the counts. |
| D-15 | applied | Candidates > 1 km apart → `sourcesDisagree` review, winner kept (DM-44). |
| D-16 | applied | Field-by-field rule, all ids in `seenEntryIds`, common `bankCode` or null; ended-only machines are `noEntry`, recorded as GM-23 for the owner. |
| D-17 | applied | Approve needs current text = `seenText` (409 `ATM_MAP_SOURCE_CHANGED`); replacement clears provenance; the popup shows the approver (DM-20). |
| D-18 | applied | Adjacent collinear overlap, non-adjacent touch and pinches count; same rules for `wouldCrossWhileDrawing`. |
| D-19 | applied | Edge-midpoint and equal-vertex-set tests added (plus the UI critic's centroid test, guarded against concave false positives). |
| D-20 | applied | Containment and intersection tests in the Mercator plane; `round6` in the reducer (DM-48). |
| D-21 | applied | A figure-formula table (§6.4); DM-39 reworded to the selected branch; `skippedArchived` dropped. |
| D-22 | applied | `Intl.Collator('ar', { numeric: true, sensitivity: 'base' })`, stable; test «قطاع 2» < «قطاع 10». |
| D-23 | applied | `order` written whenever stored ≠ final index (§6.5). |
| D-24 | applied | Verified the autoIndex trap (`mongo.ts:10`, `fleet-indexes.spec.ts:1-7`); drop-then-migrate test and an `atmIndexedModels()` unit check. |
| D-25 | applied | Rule `n % 100` in 3–10 → «ماكينات», otherwise «ماكينة» above 2 (DM-21); tests for 101, 103, 111, 1003. |
| D-26 | partly | DMS and scheme-less rules applied; the token is cut at the first non-ASCII character only for short-link hosts, because a copied place URL may hold an unencoded name (the workbook was not available here to count it). |
| D-27 | applied | `expected` in text mode, 409 `ATM_MAP_PARSE_CHANGED` beyond 1 m (DM-45). |

### UI

| # | Outcome | Reason (one line) |
|---|---|---|
| U-1 | applied | Same as S-3. |
| U-2 | applied | Same as S-2; the integration test changes `__v` between load and write through a test hook. |
| U-3 | applied | 413 claims removed; total-points cap `TOO_MANY_POINTS_IN_SAVE` in the schema and the client (§6.1, §6.6). |
| U-4 | partly | `editBlocked` wiring, ZoneDetail «تعديل» only for the edit branch, and the 422 fixture applied; the "edit the home branch" direction was rejected for D-M6's "top-bar branch" (S-1); GM-20 records it for the owner. |
| U-5 | applied | Verified (`leaflet.css:116-117, 252-255`; `leaflet-src.js:12919-12931`): one shared canvas for zones and dots, labels non-interactive, edit-mode handles for the selected zone only (DM-27, §8.4). |
| U-6 | applied | Verified the census rules (`remembered-filters-coverage.spec.ts:311, 328, 367, 378`); pages declare and read their params; S5 `['reasons']` with `['q', 'branch']` excluded (§7.5). |
| U-7 | applied | D-M4 says "once" and the mockup's `convert()` has no stop or retry; `retryFailed`, the retry and stop buttons and their keys removed (DM-46). |
| U-8 | applied | Mockup `mids.down` inserts into every zone with the edge; `INSERT_VERTEX` does the same; the neighbour edge-snap line deleted. |
| U-9 | applied | Midpoint/centroid/equal-ring overlap tests and the adjacent back-track rule; the centroid test is guarded for concave rings. |
| U-10 | applied | Verified Leaflet's focus and arrow handling (`leaflet-src.js:13998-14009, 14056-14058`); keyboard disabled in edit mode; `shortcutFor(…, { modalOpen })`. |
| U-11 | applied | S5 branch, queries, row actions, «تصحيح», the mockup's approve toast and the two `links.done*` texts (§8.3, §8.8). |
| U-12 | applied | Header title only, partial draw-panel replacement, amber border and label, button rows, double-click delete, disabled discard, lock title, mockup dirty formula (DM-23). |
| U-13 | applied | Verified `i18n.ts:16480` reads «مؤرشفة في قائمة التشغيل»; DM-16 recorded as GAP GM-22; `status.archived` marked new. |
| U-14 | applied | `save.error.*` keys, client-side DM-8 check, smallest-unused default name (DM-22), `BRANCH_MISMATCH` → reload. |
| U-15 | applied | Same as S-18; queries enabled after context, `pruneStale` handles `branch` first, test added. |
| U-16 | applied | `module-structure.md:120-122` forbids copying across modules; tile constants and the Maps URL promoted to `shared/lib`, operations files import the same values. |
| U-17 | applied | Bounding-box prefilter, per-gesture recompute per frame, viewport-only labels, gesture-end `aria-live`, a 200 ms budget test (§8.4). |
| U-18 | applied | Verified sidebar rows are `NavLink` anchors (`Sidebar.tsx:17, 727`); capture-phase anchor guard, per-user draft, confirmed leave clears it, no "kept" clause after a storage failure. |
| U-19 | applied | Verified `env.ts:145` and `idle-session.ts:165-183`; §8.10 and rollout step 5 explain resuming after a 401. |
| U-20 | applied | Cluster label and keyboard, radiogroup swatches, pin arrow keys, focus return; GAP GM-24 for pointer-only drawing. |
| U-21 | partly | The rule is now stated, but with the data critic's boundary (`n % 100` in 3–10), so 103 → «103 ماكينات», not «103 ماكينة» as "many = n ≥ 11" would give. |
| U-22 | applied | §8.13 lists the pill, the tag, the caption, `prefix: false`, the legend, the three ZoneDetail columns and «آخر تحريك للموقع». |
| U-23 | applied | A pasted short code confirmed by a person sets `reviewedBy/At` (DM-4, §6.5). |
| U-24 | applied | The 403/400 contract is defined; context cases, DTO allowlist, revision-0 read, nav rows and a web nav↔route join test added (§9.3, §9.4). |

## Implementation notes

- §4.1/§4.2 — a short Plus Code with nothing after `+` (`26VP+`) is `unreadable` — its recovered code has fewer than 10 digits, the "Derivation use" floor.
- §4.3 row 3 — a pinned document whose text equals `pinText` again also drops a link that row 5 queued meanwhile (`shortLink: null`) — keeps §3.3's invariant, so a link nobody needs is not fetched.
- §5.1 — the 5 s/12 s deadlines are `setTimeout`-backed abort signals combined with `AbortSignal.any`, not `AbortSignal.timeout` — the test clock cannot advance `AbortSignal.timeout`, and §9.2 pins the 5 s DNS timeout under fake timers.
- §5.1 — every hop URL (not only the first) must be https with no userinfo and no port, else `hostNotAllowed` before any request — otherwise `outboundFetch` itself would refuse a credentialed URL and log it.
- §5.3 — `resolveShortLink(url, deps, { budgetEndsAt })` takes the run's budget so it is checked before every hop; the per-call loop (20 links, 300 ms pause, claim → resolve → store, release on a stop) is `runShortLinkBatch(items, io, deps)`, with the claim/store/release queries injected by the service, which keeps the lease — so the batch rules are unit-testable without a database.
- §6.1 — the `SaveAtmMapZoneSetSchema` refinements carry their code (`TOO_MANY_POINTS_IN_SAVE`, `DUPLICATE_TEMP_ID`, `DUPLICATE_ID`, `UPDATED_AND_DELETED`, `NO_FIELDS`) in the issue's `message` and `params.code` — a Zod custom issue's own code is always `custom`, which `validate.ts:19` turns into the detail code `CUSTOM`.
- §6.1 — `ATM_MAP_ZONE_MIN_POINTS`/`ATM_MAP_ZONE_MAX_POINTS` are defined in `atm-map-geometry.ts` (exported from the index as before) — `zoneGeometryIssues` needs them and `atm-map.ts` imports `round6` from there; this avoids an import cycle.
- §6.1 — `project` clamps the latitude to Leaflet's ±85.0511287798° — the Mercator y of ±90° is infinite, and Leaflet clamps the same way.
- §6.1 — `zoneGeometryIssues` judges `SELF_INTERSECTION` and `TOO_SMALL` on the ring with consecutive duplicates removed, and skips `TOO_SMALL` on a self-intersecting ring — a doubled click is reported once (`DUPLICATE_POINT`), and the shoelace area of a crossing ring means nothing.
