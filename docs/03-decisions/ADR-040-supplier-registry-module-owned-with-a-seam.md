# ADR-040: The supplier registry is module-owned now, with a seam for IT and Fleet later

**Status:** Accepted · **Date:** 2026-11-24 (the owner adopted every open decision's recommended
default, so OD-01 is C: module-owned now, a seam later; design §16.12) · **Relates to:**
[Administrative Affairs design](../12-planning/administration-module-design.md) (four files;
section numbers run across them) §2.3.6, §15.3.5 a, §16.5 (OD-01), §20 and RK-18;
[IT design](../12-planning/it-module-design.md) §2.9 and §16 P4;
[ADR-031](ADR-031-org-units-defined-once-declared-per-branch.md) (operator-run migrations)

The design's sections are in its four files: §0–§3 in
[`administration-module-design.md`](../12-planning/administration-module-design.md), §4–§7 in
[`administration-module-design-flows.md`](../12-planning/administration-module-design-flows.md),
§8–§14 in
[`administration-module-design-integration.md`](../12-planning/administration-module-design-integration.md)
and §15–§22 in
[`administration-module-decisions-and-phases.md`](../12-planning/administration-module-decisions-and-phases.md).

## Context

The owner's purchasing cycle runs «Purchase Request → Approval → RFQ/Quotation → Supplier
Selection → Purchase Order → …» (design §0). Procurement therefore needs a register of the
suppliers it selects from. It ships in P1b.1, the suppliers pull request of the design's Phase 1
(design §19.1; `administration_suppliers`, design §2.3.6).

IT and Fleet already keep lists of outside parties:

- **IT vendors.** `it_vendors` holds a plain-string name, an optional code, phone, email, address
  and free-text services, embedded contacts and an active flag, with one live row per name
  (`apps/api/src/modules/it/vendors/vendor.model.ts:14-23, 50-53`).
  Its header says it is "IT-owned until a Procurement module owns the concept" (`:1-3`). Assets,
  licences and maintenance orders check a vendor id against it
  (`apps/api/src/modules/it/assets/asset.service.ts:117-122`,
  `apps/api/src/modules/it/licenses/license.service.ts:100-104`,
  `apps/api/src/modules/it/maintenance/order.service.ts:99-102`). It has its own menu row,
  «موردو تقنية المعلومات» (`apps/api/src/seed-navigation.ts:1007-1013`).
- **Fleet workshops.** A workshop is one kind of Fleet's catalog (`packages/contracts/src/modules/fleet.ts:55-56`):
  a `{ar, en}` name with no code, phone or contacts, one live row per raw Arabic name
  (`apps/api/src/modules/fleet/catalogs/catalog-item.model.ts:18-20, 44, 64-67`). A maintenance
  visit requires a `workshopId` (`apps/api/src/modules/fleet/maintenance/maintenance.model.ts:15, 50`),
  checked at `apps/api/src/modules/fleet/maintenance/maintenance.service.ts:271, 431`. About 1,800
  legacy visits were imported with one (`apps/api/src/modules/fleet/go-live/maintenance.ts:1-2`).
  137 of them name a placeholder row, «غير محدد» (Unspecified), that the import added because the
  book named no workshop (`apps/api/src/modules/fleet/go-live/maintenance-import.ts:25-27, 228-229`);
  it is a placeholder, not a workshop. Fleet's boot seed also writes workshop rows. On every boot
  it creates any of the house vocabulary's twelve workshops that has no live row
  (`apps/api/src/modules/fleet/fleet.seed.ts:127-148`;
  `apps/api/src/modules/fleet/go-live/vocabulary.ts:52-62`;
  `apps/api/src/modules/fleet/go-live/vocabulary-names.ts:29-42, 240`), and its lookup reads live
  rows only (`apps/api/src/modules/fleet/catalogs/catalog-item.repository.ts:11-19`). So a
  soft-deleted workshop row from that list comes back at the next boot, as a new row with a new id.
- **Other parties Fleet deals with.** Insurers are another catalog kind, `insuranceCompany`
  (`fleet.ts:68`), which a vehicle may name (`insuranceCompanyId`, nullable; `fleet.ts:363-364`),
  as may a dealership invoice (`apps/api/src/modules/fleet/dealership/dealership.model.ts:34, 62`).
  The two fuel companies are a code constant, `FLEET_FUEL_CARD_COMPANIES` (`fleet.ts:3636-3637`).
  The traffic authority has no record of its own; Fleet's licensing-expense memo records what
  licences cost (`fleet.ts:5274-5280`).
- **Fleet's car suppliers.** Fleet's vehicle supply contracts «عقود توريد السيارات» name their
  supplier as free text, with no id (`apps/api/src/modules/fleet/vehicle-contracts/vehicle-contract.model.ts:65, 118`).
  Their «المورد» filter lists the distinct names
  (`apps/api/src/modules/fleet/vehicle-contracts/vehicle-contract.repository.ts:174-180`;
  `vehicle-contract.routes.ts:51-52`).

The design counts the risk of yet another list as RK-18.

A business module never imports another one (`docs/01-business/module-hierarchy.md:28`). The
Administrative Affairs module holds that rule by a source scan
(`apps/api/src/modules/administration/administration-isolation.spec.ts:1-9`). So IT and Fleet
cannot read the module's collection directly. The platform already has a way round this. In the
employee directory, the module that owns the data registers a closure at load, and any other
module reads it through the platform; neither imports the other
(`apps/api/src/platform/directory/index.ts:1-5`).

IT's design expected this. Its §2.9 says that if Procurement arrives, it takes ownership of
vendors and IT re-points (`docs/12-planning/it-module-design.md:686-690`). Its §16 P4, the
external-party registry, plans to merge vendor and workshop rows into a platform registry,
re-point `workshopId` and `vendorId`, and keep the old endpoints through a deprecation window, in
two to three slices. Its trigger is "Procurement module design"
(`docs/12-planning/it-module-design.md:1510`). The Administrative Affairs design is that design, so
the trigger has fired (design §18.1 A7, §20).

OD-01 asked who owns the list, whether IT vendors and Fleet workshops move into it now, and
whether other outside parties belong in it. Its options were A (module-owned; IT and Fleet left
alone), B (a platform registry now, with a staged migration) and C (module-owned now, a platform
lookup seam later, a migration only on an owner GO). It had two sub-questions. Do insurers, fuel
companies and the traffic authority join? Option (i): no, they stay where Fleet keeps them. Do
Fleet's free-text car suppliers join? Option (i): no, they stay text until a merge stage. It
recommended C, and (i) for both. On 2026-11-24 the owner took every recommended default as the
working answer: «بص اعمل انت الـ Recommendations من عندك دلوقتى وبعدين نبقى نعدل» (design
§16.12).

## Decision

1. **The registry lives in Administrative Affairs now.** It is `administration_suppliers`, owned by
   the `procurement/suppliers` feature, and ships in P1b.1 (design §2.2, §2.3.6). Its fields and
   its status are OD-11 and OD-12, not this ADR. Its permission keys carry the module's prefix
   (`administrationSupplier.*`), so a bare `supplier` stays free for a platform registry (design
   §6.1).
2. **IT and Fleet are untouched now.** `it_vendors`, `/it/vendors`, IT's vendor checks, Fleet's
   workshop rows and `workshopId` stay as they are. Phase 1 copies, moves and re-points none of
   their rows, and no data migrates (design §15.3, §19.9; D-17, the design's rule that Phase 1
   changes no existing data).
3. **Later, other modules read the registry through a platform seam** (design §15.2.2, PC-3, the
   planned supplier lookup seam). It follows the directory pattern: Administrative Affairs
   registers a lookup at load, and IT and Fleet read through `platform/`. No module imports
   another. The seam's answers, including what it returns when Administrative Affairs has not
   registered, are decided with its first consumer. The directory made that choice one lookup at
   a time: with no HR registered, a lookup answers `null` and a leave read answers `false`
   (`apps/api/src/platform/directory/index.ts:7-11`). The seam may ship before any rows merge
   (PC-3).
4. **IT vendors and Fleet workshops join only on an owner GO. IT and Fleet switch in their own
   slices, and an operator command moves the rows. A row with no duplicate keeps its ObjectId.**
   The staged path (design §15.3.5 a):
   - **IT and Fleet switch in their own slices.** Each moves its checks and pickers to the seam.
     `/it/vendors` keeps working through a deprecation window.
   - **An operator command moves the rows.** It follows ADR-031's discipline, as
     `migrate:org-catalog` does (`apps/api/src/migrate-org-catalog.cli.ts:1-50`): a dry run by
     default that prints the whole plan; `--write` applies exactly that plan; it refuses rather
     than half-applies; it never runs at boot.
   - **A row with no duplicate keeps its `_id`.** So the stored references resolve unchanged:
     `it_assets.purchase.vendorId` and `it_assets.warranty.vendorId`
     (`apps/api/src/modules/it/assets/asset.model.ts:17, 22`), `it_licenses.purchase.vendorId`
     (`apps/api/src/modules/it/licenses/license.model.ts:13`), `it_maintenance_orders.vendorId`
     (`apps/api/src/modules/it/maintenance/order.model.ts:32`) and
     `fleet_maintenance_visits.workshopId`. So do past event payloads
     (`packages/contracts/src/modules/it.ts:2467-2472`; `fleet.ts:2924-2931`). Audit rows and
     payloads are never edited.
   - **Near-duplicates merge only where a person names them** (`--merge LOSER=WINNER`). The
     command re-points every row that names the loser. The loser stays, soft-deleted, as a
     tombstone that names its winner, so old ids in audit rows and payloads still resolve.
   - **The shapes are mapped, not assumed.** An IT vendor has a string name, contacts, an
     address, free-text services and an active flag; a workshop has an `{ar, en}` name and no
     code, phone or contacts; a supplier is unique by its folded Arabic name (design §2.3.6).
   - **The old rows retire last,** only after IT and Fleet read through the seam. Only the
     operator command re-points. No module writes another module's collection.
   - **The owner approves the run.** The owner approves the production dry run's output before
     `--write` (design §15.3.7, class 3), under the owner's rule «لا تعمل destructive operation أو
     production migration بدون موافقتي الصريحة» (design §0, D-17).

   This departs from IT's plan in two places. The target is `administration_suppliers` behind the
   seam, not a platform registry. And a row with no duplicate keeps its id instead of being
   re-pointed.
5. **Insurers, fuel companies and the traffic authority stay where Fleet keeps them** (OD-01
   (i)). A later merge stage may bring them in.
6. **Fleet's car suppliers stay free text** (OD-01 (i)) until a merge stage. They have no id, so
   they cannot move by id. Joining them would take a name-to-supplier list that a person writes,
   read by the operator command, and a Fleet slice that stores the id instead (OD-01 (ii), design
   §15.3.5 a).
7. **What starts the next stage.** The second stage of C is the seam, IT and Fleet switching to
   it, and the merge. It starts only when the owner gives a GO for it (OD-01 C; IT design §16:
   "each item starts only on an explicit owner GO"). That stage is then designed, and a new ADR
   records it: the seam's contract; the merge plan, including what happens to the «غير محدد»
   placeholder; the tombstone's field; and how Fleet's boot vocabulary seed stops re-creating
   retired workshop rows. That ADR supersedes the parts of this one it changes (at least
   decisions 3 and 4). So does any later change to OD-01's answer (design §16.12), for the
   decisions it changes: B, or (ii) for the other parties or for Fleet's car suppliers.

## Alternatives considered

- **A: module-owned, with IT and Fleet left alone for good.** It costs as little as C now. But it
  plans no seam and no merge, so IT's list, Fleet's workshops and the new registry would stay three
  copies of one concept. A person who holds both `itVendor.view` and `administrationSupplier.view`
  would keep seeing two supplier rows in the menu (`apps/api/src/seed-navigation.ts:1007-1013`;
  design §13.3). RK-18 would have no answer.
- **B: a platform registry now, with a staged migration.** It is IT's own plan (§16 P4). But it is
  the large option: a platform service and a platform ADR now, then the migration, and it delays
  P1b, Phase 1's supplier work (OD-01). It would also settle the registry's shape before
  Procurement has used it. IT's design warns against exactly that: "extracting earlier buys
  nothing and guesses at its shape" (`docs/12-planning/it-module-design.md:1510`). Under B, the
  module collection planned for Phase 1 would give way to that service (design §22, conditional
  revisions).
- **(ii) for the other parties: insurers, fuel companies and the traffic authority join the list
  now.** They supply no goods to the stores, and Fleet's references to them would have to
  re-point, which is an operator migration under D-17 (OD-01). It costs more than (i), M against
  S. A later merge stage can still bring them in.
- **(ii) for Fleet's car suppliers: the merge maps each name to a registered supplier, and Fleet
  stores the id.** It costs more than (i), M against S: the name-to-supplier list that a person
  writes, the operator step and the Fleet slice of decision 6 (OD-01, design §15.3.5 a). Under
  (i) that work waits for a merge stage.

## Consequences

- P1b.1 can start once this ADR is merged (design §19.1, §20). Phase 1 writes no IT or Fleet row.
- Until the second stage, there are two supplier lists in the menu: IT's «موردو تقنية المعلومات»
  and Administrative Affairs' suppliers (design §13.3). A supplier that IT and Procurement both
  deal with can appear in both, as two unrelated rows.
- Fleet's car suppliers remain a fourth list, as free text, beside IT's vendors, Fleet's workshops
  and the new registry, until a merge stage (RK-18).
- IT's design §16 P4 and §17 carry a dated note that its trigger has fired and that `it_vendors`
  stays IT's until a merge stage (design §21).
- A later merge rewrites no stored id for a row that has no duplicate. Only the references to a
  merged near-duplicate are re-pointed, by the operator command, and the near-duplicate stays as a
  tombstone.
- A pull request that makes IT or Fleet read the registry, merges rows into it, or brings in
  insurers, fuel companies, the traffic authority or Fleet's car suppliers needs the new ADR that
  supersedes this one in part.
