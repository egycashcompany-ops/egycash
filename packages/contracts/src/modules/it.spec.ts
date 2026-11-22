// The IT contract guards that carry business rules — the ones a careless caller would violate
// first: status is not writable (FR-2), the code is not writable (FR-1), warranty dates are
// ordered, and the label batch is bounded.
//
// IT-3 adds the help desk's own set, and they are the same KIND of guard: everything the server
// owns (the ticket code, the status, the SLA snapshot, the requester) must be unwritable, and the
// two cross-field rules (a hold needs a reason, a resolution target cannot undercut a response
// target) must fail in the schema rather than deep in a service.
//
// IT-4 adds maintenance and the store, and the guards there are the same shape: the order code, its
// status, its timestamps and `assetStatusBefore` are server facts; `kind` is not a caller's choice;
// and `onHandQty` is not a field at all — stock moves only through the ledger (ADR-024).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AssignItTicketSchema,
  CreateItLicenseSchema,
  CreateItSoftwareInstallationSchema,
  CreateItSoftwareProductSchema,
  ListItLicensesQuerySchema,
  ListItSoftwareInstallationsQuerySchema,
  RemoveItSoftwareInstallationSchema,
  UpdateItLicenseSchema,
  UpdateItSoftwareInstallationSchema,
  UpdateItSoftwareProductSchema,
  CancelItMaintenanceOrderSchema,
  CompleteItMaintenanceOrderSchema,
  CreateItMaintenanceOrderSchema,
  CreateItMaintenancePlanSchema,
  CreateItSparePartSchema,
  ListItMaintenanceOrdersQuerySchema,
  ListItSparePartMovementsQuerySchema,
  ListItSparePartsQuerySchema,
  ReceiveItSparePartSchema,
  UpdateItMaintenanceOrderSchema,
  UpdateItMaintenancePlanSchema,
  UpdateItSparePartSchema,
  CancelItTicketSchema,
  ChangeItTicketStatusSchema,
  CloseItTicketSchema,
  CreateItAssetSchema,
  CreateItCatalogItemSchema,
  CreateItTicketCommentSchema,
  CreateItTicketPrioritySchema,
  CreateItTicketSchema,
  ItAssetLabelsSchema,
  ItAssetWarrantySchema,
  ListItTicketsQuerySchema,
  ListItAssetsQuerySchema,
  ListItAssetNamesQuerySchema,
  ListItAssignmentsQuerySchema,
  ItDashboardQuerySchema,
  ListItPeopleQuerySchema,
  ListItTechniciansQuerySchema,
  ReopenItTicketSchema,
  ResolveItTicketSchema,
  UpdateItAssetSchema,
  UpdateItTicketPrioritySchema,
  UpdateItTicketSchema,
  HandOverItAssetsSchema,
  IT_HAND_OVER_MAX_LINES,
  formatCustodyReceiptNumber,
  PreviewItCustodyReceiptSchema,
  CreateItVehicleCheckSchema,
  IT_VEHICLE_CHECK_ITEMS,
  IT_VEHICLE_CHECK_NOTES_MAX,
  ItVehicleCheckPhotoFieldsSchema,
  vehicleCheckNeedsNotes,
  IT_VEHICLE_CHECK_OVERDUE_DAYS,
  ItVehicleCheckDashboardQuerySchema,
  ItVehicleCheckPhotoParamSchema,
  ListItVehicleChecksQuerySchema,
  IT_PRINTER_COUNTER_MAX,
  IssueItConsumablesSchema,
  SetItConsumableInstalledOnSchema,
  UpdateItCatalogItemSchema,
  AssignItAssetSchema,
  CreateItLocationSchema,
  IT_ASSET_HOLDER_KINDS,
  ItAssetAssignedPayloadV1,
  ItAssetReturnedPayloadV1,
  ItAssetTransferredPayloadV1,
  ItCustodianDepartmentInputSchema,
  ItLocationOptionsQuerySchema,
  ListItConsumableMovementsQuerySchema,
  ListItLocationsQuerySchema,
  TransferItAssetSchema,
  UpdateItLocationSchema,
  type ItCustodyReceiptDocumentDto,
  type ItMobileLineReceiptDocumentDto,
} from './it.js';
import { ErrorCodes } from '../errors/index.js';

const oid = (n: number): string => n.toString(16).padStart(24, '0');

describe('it contracts', () => {
  it('rejects a client-supplied assetCode and status on create — both are server facts', () => {
    const base = { name: 'ThinkPad T14', categoryId: oid(1), branchId: oid(2) };
    expect(CreateItAssetSchema.safeParse(base).success).toBe(true);
    expect(CreateItAssetSchema.safeParse({ ...base, assetCode: 'AST-99999' }).success).toBe(false);
    expect(CreateItAssetSchema.safeParse({ ...base, status: 'assigned' }).success).toBe(false);
  });

  it('rejects status on update too — FR-2 has no back door', () => {
    expect(UpdateItAssetSchema.safeParse({ version: 0, status: 'disposed' }).success).toBe(false);
    expect(UpdateItAssetSchema.safeParse({ version: 0, name: 'renamed' }).success).toBe(true);
  });

  it('orders warranty dates', () => {
    const ok = { start: '2026-01-01', end: '2027-01-01' };
    expect(ItAssetWarrantySchema.safeParse(ok).success).toBe(true);
    const flipped = { start: '2027-01-01', end: '2026-01-01' };
    expect(ItAssetWarrantySchema.safeParse(flipped).success).toBe(false);
  });

  it('bounds the label batch (1..100)', () => {
    expect(ItAssetLabelsSchema.safeParse({ assetIds: [] }).success).toBe(false);
    expect(ItAssetLabelsSchema.safeParse({ assetIds: [oid(1)] }).success).toBe(true);
    const over = Array.from({ length: 101 }, (_, i) => oid(i + 1));
    expect(ItAssetLabelsSchema.safeParse({ assetIds: over }).success).toBe(false);
  });

  it('accepts only the two declared catalog kinds', () => {
    const name = { ar: 'حواسيب', en: 'Computers' };
    expect(CreateItCatalogItemSchema.safeParse({ kind: 'assetCategory', name }).success).toBe(true);
    expect(CreateItCatalogItemSchema.safeParse({ kind: 'sparePart', name }).success).toBe(false);
  });
});

describe('it help-desk contracts (IT-3)', () => {
  const ticket = {
    title: 'Printer jams',
    description: 'It jams on every second page.',
    categoryId: oid(1),
    priorityId: oid(2),
  };

  it('accepts a real ticket, with the optional asset link', () => {
    expect(CreateItTicketSchema.safeParse(ticket).success).toBe(true);
    expect(CreateItTicketSchema.safeParse({ ...ticket, assetId: oid(3) }).success).toBe(true);
  });

  // Everything the SERVER owns must be unwritable. A client that could name a requester could open
  // a ticket as someone else; one that could set a status could skip the state machine entirely;
  // one that could set the SLA could promise itself a window it was never given.
  it('refuses every server-owned field on create', () => {
    for (const injected of [
      { ticketCode: 'TKT-00001' },
      { status: 'resolved' },
      { requesterUserId: oid(9) },
      { sla: { policy: { responseMinutes: 1, resolutionMinutes: 1 } } },
      { assignedTechnicianUserId: oid(9) },
      { reopenCount: 0 },
    ]) {
      const key = Object.keys(injected)[0] ?? '';
      expect(
        CreateItTicketSchema.safeParse({ ...ticket, ...injected }).success,
        `${key} must not be writable`,
      ).toBe(false);
    }
  });

  it('refuses status on update too — the state machine has no back door', () => {
    expect(UpdateItTicketSchema.safeParse({ version: 0, title: 'renamed' }).success).toBe(true);
    expect(UpdateItTicketSchema.safeParse({ version: 0, status: 'closed' }).success).toBe(false);
    // Unlinking an asset is a legitimate edit, so `null` is allowed where the field is nullable.
    expect(UpdateItTicketSchema.safeParse({ version: 0, assetId: null }).success).toBe(true);
    // …but an edit must always carry the version it read, or a concurrent write wins silently.
    expect(UpdateItTicketSchema.safeParse({ title: 'renamed' }).success).toBe(false);
  });

  // §4.4 — a pause has to be explainable later, so the reason is required for `onHold` and only
  // for `onHold`. A field-local rule cannot express that; the cross-field refinement can.
  it('requires a reason to put a ticket on hold, and only then', () => {
    expect(ChangeItTicketStatusSchema.safeParse({ to: 'onHold' }).success).toBe(false);
    expect(ChangeItTicketStatusSchema.safeParse({ to: 'onHold', reason: '   ' }).success).toBe(
      false,
    );
    expect(
      ChangeItTicketStatusSchema.safeParse({ to: 'onHold', reason: 'waiting for the vendor' })
        .success,
    ).toBe(true);
    expect(ChangeItTicketStatusSchema.safeParse({ to: 'inProgress' }).success).toBe(true);
  });

  // The generic endpoint moves the ticket only between the two states that carry no extra fact.
  // resolve/close/reopen/cancel each need a different one, so each has its own schema.
  it('confines the generic transition to inProgress and onHold', () => {
    for (const to of ['resolved', 'closed', 'cancelled', 'open']) {
      expect(
        ChangeItTicketStatusSchema.safeParse({ to, reason: 'because' }).success,
        `${to} must not be reachable through the generic transition`,
      ).toBe(false);
    }
  });

  it('demands the fact each named transition exists to carry', () => {
    expect(ResolveItTicketSchema.safeParse({}).success).toBe(false);
    expect(ResolveItTicketSchema.safeParse({ summary: 'replaced the roller' }).success).toBe(true);
    expect(ReopenItTicketSchema.safeParse({}).success).toBe(false);
    expect(ReopenItTicketSchema.safeParse({ reason: 'it jammed again' }).success).toBe(true);
    expect(CancelItTicketSchema.safeParse({}).success).toBe(false);
    expect(CancelItTicketSchema.safeParse({ reason: 'opened by mistake' }).success).toBe(true);
    // Closing is the one that carries an OPTIONAL note: a resolved ticket closing cleanly needs
    // nothing said about it.
    expect(CloseItTicketSchema.safeParse({}).success).toBe(true);
    expect(AssignItTicketSchema.safeParse({ technicianUserId: oid(4) }).success).toBe(true);
    expect(AssignItTicketSchema.safeParse({}).success).toBe(false);
  });

  // FR-7's safe default. `public` is what the requester can see, so an internal note is always a
  // conscious choice rather than the accident of a missing field.
  it('defaults a comment to public', () => {
    const parsed = CreateItTicketCommentSchema.safeParse({ body: 'looking into it' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.visibility).toBe('public');
    expect(
      CreateItTicketCommentSchema.safeParse({ body: 'vendor RMA pending', visibility: 'internal' })
        .success,
    ).toBe(true);
    expect(CreateItTicketCommentSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(CreateItTicketCommentSchema.safeParse({ body: 'x', visibility: 'secret' }).success).toBe(
      false,
    );
  });

  // A resolution target shorter than the response target is a policy that promises to finish
  // before it starts. Checked on create, and on update against the MERGED values — which the
  // service does, because a field-local rule cannot see the half it was not given.
  it('refuses an SLA policy that resolves faster than it responds', () => {
    const name = { ar: 'عاجل', en: 'Urgent' };
    expect(
      CreateItTicketPrioritySchema.safeParse({
        name,
        rank: 0,
        responseMinutes: 30,
        resolutionMinutes: 240,
      }).success,
    ).toBe(true);
    expect(
      CreateItTicketPrioritySchema.safeParse({
        name,
        rank: 0,
        responseMinutes: 240,
        resolutionMinutes: 30,
      }).success,
    ).toBe(false);
    // Zero and negative windows are not policies.
    expect(
      CreateItTicketPrioritySchema.safeParse({
        name,
        rank: 0,
        responseMinutes: 0,
        resolutionMinutes: 30,
      }).success,
    ).toBe(false);
    // The UPDATE schema deliberately does NOT carry the pair rule — a partial edit may legitimately
    // send one target alone, and the service checks the merged pair.
    expect(
      UpdateItTicketPrioritySchema.safeParse({ version: 0, responseMinutes: 30 }).success,
    ).toBe(true);
  });

  it('declares the queue filters the help-desk screens send, and refuses anything else', () => {
    const parsed = ListItTicketsQuerySchema.safeParse({
      search: 'printer',
      status: 'open',
      mine: 'true',
      breached: 'false',
      active: 'true',
      categoryId: oid(1),
      priorityId: oid(2),
    });
    expect(parsed.success).toBe(true);
    // The three booleans arrive as query STRINGS and must come out as booleans.
    expect(parsed.success && parsed.data.mine).toBe(true);
    expect(parsed.success && parsed.data.breached).toBe(false);
    expect(ListItTicketsQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(ListItTicketsQuerySchema.safeParse({ requester: oid(1) }).success).toBe(false);
  });

  // A person's tickets — the requester filter and the history page — name them by LOGIN, and
  // the id is validated like every other one.
  it('filters by requester login, and only by a well-formed one', () => {
    expect(ListItTicketsQuerySchema.safeParse({ requesterUserId: oid(1) }).success).toBe(true);
    expect(ListItTicketsQuerySchema.safeParse({ requesterUserId: 'me' }).success).toBe(false);
  });
});

// ── IT-4: maintenance and the store ─────────────────────────────────────────

describe('it maintenance contracts', () => {
  const oid = (n: number) => String(n).padStart(24, '0');

  it("keeps the order code, status, timestamps and kind out of a caller's hands", () => {
    expect(CreateItMaintenanceOrderSchema.safeParse({ assetId: oid(1) }).success).toBe(true);
    for (const extra of [
      { orderCode: 'MO-00001' },
      { status: 'completed' },
      { kind: 'preventive' },
      { startedAt: new Date().toISOString() },
      { completedAt: new Date().toISOString() },
      { assetStatusBefore: 'assigned' },
      { cost: 100 },
      { planId: oid(2) },
    ]) {
      expect(
        CreateItMaintenanceOrderSchema.safeParse({ assetId: oid(1), ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('lets an update touch the planning fields and nothing the server owns', () => {
    expect(UpdateItMaintenanceOrderSchema.safeParse({ version: 0, summary: 'later' }).success).toBe(
      true,
    );
    expect(UpdateItMaintenanceOrderSchema.safeParse({ version: 0, vendorId: null }).success).toBe(
      true,
    );
    // No version = no optimistic check; the platform never allows that on an update.
    expect(UpdateItMaintenanceOrderSchema.safeParse({ summary: 'x' }).success).toBe(false);
    expect(UpdateItMaintenanceOrderSchema.safeParse({ version: 0, status: 'open' }).success).toBe(
      false,
    );
    expect(UpdateItMaintenanceOrderSchema.safeParse({ version: 0, cost: 5 }).success).toBe(false);
  });

  it('requires a summary to complete and a reason to cancel', () => {
    expect(CompleteItMaintenanceOrderSchema.safeParse({ summary: 'Fan replaced' }).success).toBe(
      true,
    );
    expect(CompleteItMaintenanceOrderSchema.safeParse({}).success).toBe(false);
    expect(CompleteItMaintenanceOrderSchema.safeParse({ summary: '  ' }).success).toBe(false);
    expect(CancelItMaintenanceOrderSchema.safeParse({ reason: 'Parts unavailable' }).success).toBe(
      true,
    );
    expect(CancelItMaintenanceOrderSchema.safeParse({}).success).toBe(false);
  });

  // FR-9: a part usage is a POSITIVE whole number. A negative one would be a receipt smuggled in
  // through the completion path, and the ledger would stop being able to say what a repair used.
  it('accepts only positive whole part quantities on a completion', () => {
    const base = { summary: 'Done' };
    expect(
      CompleteItMaintenanceOrderSchema.safeParse({
        ...base,
        parts: [{ partId: oid(1), qty: 2 }],
      }).success,
    ).toBe(true);
    for (const qty of [0, -1, 1.5]) {
      expect(
        CompleteItMaintenanceOrderSchema.safeParse({ ...base, parts: [{ partId: oid(1), qty }] })
          .success,
        String(qty),
      ).toBe(false);
    }
  });

  it("keeps a plan's clock and its active flag off the write schemas", () => {
    expect(
      CreateItMaintenancePlanSchema.safeParse({ assetId: oid(1), name: 'Q', intervalDays: 90 })
        .success,
    ).toBe(true);
    // An interval of zero days is a schedule that never advances.
    expect(
      CreateItMaintenancePlanSchema.safeParse({ assetId: oid(1), name: 'Q', intervalDays: 0 })
        .success,
    ).toBe(false);
    for (const extra of [{ active: true }, { lastCompletedAt: new Date().toISOString() }]) {
      expect(
        CreateItMaintenancePlanSchema.safeParse({
          assetId: oid(1),
          name: 'Q',
          intervalDays: 90,
          ...extra,
        }).success,
        JSON.stringify(extra),
      ).toBe(false);
      expect(
        UpdateItMaintenancePlanSchema.safeParse({ version: 0, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
    // `assetId` is fixed at creation: re-parenting a schedule would rewrite another asset's history.
    expect(UpdateItMaintenancePlanSchema.safeParse({ version: 0, assetId: oid(2) }).success).toBe(
      false,
    );
  });

  it('never lets on-hand stock be set as a field (ADR-024)', () => {
    expect(
      CreateItSparePartSchema.safeParse({ partCode: 'SP-1', name: 'RAM', unit: 'pc' }).success,
    ).toBe(true);
    expect(
      CreateItSparePartSchema.safeParse({
        partCode: 'SP-1',
        name: 'RAM',
        unit: 'pc',
        onHandQty: 5,
      }).success,
    ).toBe(false);
    expect(UpdateItSparePartSchema.safeParse({ version: 0, onHandQty: 5 }).success).toBe(false);
    // The code is the shelf label and is not editable once movements point at it.
    expect(UpdateItSparePartSchema.safeParse({ version: 0, partCode: 'SP-2' }).success).toBe(false);
    expect(UpdateItSparePartSchema.safeParse({ version: 0, minQty: null }).success).toBe(true);
  });

  it('makes a receipt a positive whole quantity, never a disguised consumption', () => {
    expect(ReceiveItSparePartSchema.safeParse({ qty: 10 }).success).toBe(true);
    for (const qty of [0, -3, 2.5]) {
      expect(ReceiveItSparePartSchema.safeParse({ qty }).success, String(qty)).toBe(false);
    }
  });

  it('declares the filters the maintenance and store screens send, and refuses anything else', () => {
    const orders = ListItMaintenanceOrdersQuerySchema.safeParse({
      status: 'inProgress',
      kind: 'corrective',
      active: 'true',
      assetId: oid(1),
    });
    expect(orders.success).toBe(true);
    expect(orders.success && orders.data.active).toBe(true);
    expect(ListItMaintenanceOrdersQuerySchema.safeParse({ status: 'archived' }).success).toBe(
      false,
    );

    const parts = ListItSparePartsQuerySchema.safeParse({ belowMin: 'true', search: 'ram' });
    expect(parts.success).toBe(true);
    expect(parts.success && parts.data.belowMin).toBe(true);
    expect(ListItSparePartsQuerySchema.safeParse({ onHandQty: 1 }).success).toBe(false);

    expect(
      ListItSparePartMovementsQuerySchema.safeParse({ direction: 'out', orderId: oid(1) }).success,
    ).toBe(true);
    expect(ListItSparePartMovementsQuerySchema.safeParse({ direction: 'sideways' }).success).toBe(
      false,
    );
  });
});

// ── IT-5: software, installations and licences ──────────────────────────────

describe('it software and licence contracts', () => {
  const oid = (n: number) => String(n).padStart(24, '0');

  it('keeps every derived licence number off the write schemas (FR-10, §6)', () => {
    expect(CreateItLicenseSchema.safeParse({ productId: oid(1) }).success).toBe(true);
    for (const extra of [{ seatsUsed: 3 }, { state: 'active' }]) {
      expect(
        CreateItLicenseSchema.safeParse({ productId: oid(1), ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
      expect(
        UpdateItLicenseSchema.safeParse({ version: 0, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  // Both nulls carry meaning: absent seats is UNLIMITED and absent expiry is PERPETUAL. A
  // zero-seat licence is one nobody may use, which is not a licence.
  it('reads absent seats and expiry as unlimited and perpetual, and refuses zero seats', () => {
    expect(CreateItLicenseSchema.safeParse({ productId: oid(1), seats: 1 }).success).toBe(true);
    expect(CreateItLicenseSchema.safeParse({ productId: oid(1), seats: 0 }).success).toBe(false);
    expect(CreateItLicenseSchema.safeParse({ productId: oid(1), seats: -1 }).success).toBe(false);
    expect(CreateItLicenseSchema.safeParse({ productId: oid(1), seats: 1.5 }).success).toBe(false);
    // Update CAN clear them back to those meanings, which is what nullable is for here.
    expect(UpdateItLicenseSchema.safeParse({ version: 0, seats: null }).success).toBe(true);
    expect(UpdateItLicenseSchema.safeParse({ version: 0, expiresAt: null }).success).toBe(true);
  });

  // Re-pointing a licence would move every seat it has already issued to a product those
  // installations never used.
  it('fixes a licence to its product', () => {
    expect(UpdateItLicenseSchema.safeParse({ version: 0, productId: oid(2) }).success).toBe(false);
  });

  it('keeps a product name a single field, and refuses stock-style extras', () => {
    expect(CreateItSoftwareProductSchema.safeParse({ name: 'Microsoft Office' }).success).toBe(
      true,
    );
    expect(
      CreateItSoftwareProductSchema.safeParse({ name: 'Office', publisher: 'Microsoft' }).success,
    ).toBe(true);
    // A LocalizedString would be the catalog-item shape; a product name is a proper noun.
    expect(
      CreateItSoftwareProductSchema.safeParse({ name: { ar: 'أوفيس', en: 'Office' } }).success,
    ).toBe(false);
    expect(CreateItSoftwareProductSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(CreateItSoftwareProductSchema.safeParse({ name: 'Office', active: true }).success).toBe(
      false,
    );
    expect(UpdateItSoftwareProductSchema.safeParse({ version: 0, active: false }).success).toBe(
      true,
    );
  });

  /**
   * The collision that would corrupt data silently: `version` is the platform's optimistic lock on
   * every DTO, and the software's own version string is `softwareVersion`. A generic client that
   * assumed `version` was the lock would otherwise send a version STRING as a concurrency number.
   */
  it('separates the optimistic-lock version from the software version', () => {
    expect(
      CreateItSoftwareInstallationSchema.safeParse({
        assetId: oid(1),
        productId: oid(2),
        softwareVersion: '2021 LTSC',
      }).success,
    ).toBe(true);
    expect(
      CreateItSoftwareInstallationSchema.safeParse({
        assetId: oid(1),
        productId: oid(2),
        version: '2021',
      }).success,
    ).toBe(false);
    const update = UpdateItSoftwareInstallationSchema.safeParse({
      version: 3,
      softwareVersion: '2024',
    });
    expect(update.success).toBe(true);
    expect(update.success && typeof update.data.version).toBe('number');
  });

  // The pair is what the partial unique index is built on, and `removedAt` belongs to the named
  // remove action — not to a PATCH that could un-remove a finished record.
  it('fixes an installation to its asset and product, and keeps removedAt off the update', () => {
    for (const extra of [{ assetId: oid(1) }, { productId: oid(2) }, { removedAt: null }]) {
      expect(
        UpdateItSoftwareInstallationSchema.safeParse({ version: 0, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
    expect(RemoveItSoftwareInstallationSchema.safeParse({}).success).toBe(true);
    expect(RemoveItSoftwareInstallationSchema.safeParse({ note: 'decommissioned' }).success).toBe(
      true,
    );
  });

  it('declares the filters the software and licence screens send, and refuses anything else', () => {
    const licences = ListItLicensesQuerySchema.safeParse({
      state: 'expiringSoon',
      overSeats: 'true',
      productId: oid(1),
    });
    expect(licences.success).toBe(true);
    expect(licences.success && licences.data.overSeats).toBe(true);
    expect(ListItLicensesQuerySchema.safeParse({ state: 'lapsed' }).success).toBe(false);
    expect(ListItLicensesQuerySchema.safeParse({ seatsUsed: 3 }).success).toBe(false);

    const installs = ListItSoftwareInstallationsQuerySchema.safeParse({
      assetId: oid(1),
      active: 'false',
    });
    expect(installs.success).toBe(true);
    expect(installs.success && installs.data.active).toBe(false);
    expect(ListItSoftwareInstallationsQuerySchema.safeParse({ removedAt: null }).success).toBe(
      false,
    );
  });
});

// ── People: the employees IT names ──────────────────────────────────────────
//
// «اعمل شاشه فيها كل المواظفيين اللى مشيوا واللى موجودين ... لكن فى حاله اضافه اى حاجه لازم يكون
// المواظفيين يكونوا موجودين».

describe('it people contracts', () => {
  const oid = (n: number) => String(n).padStart(24, '0');

  it('lists everybody by default — a register and a search both mean leavers too', () => {
    const parsed = ListItPeopleQuerySchema.safeParse({});
    expect(parsed.success && parsed.data.status).toBe('all');
    // By name, A→Z: the order a person is looked for in, not the order they were filed in.
    expect(parsed.success && parsed.data.sortBy).toBe('name');
    expect(parsed.success && parsed.data.sortDir).toBe('asc');
  });

  it('narrows to the employed for a hand-over, to leavers for the register filter', () => {
    for (const status of ['employed', 'exited', 'all']) {
      expect(ListItPeopleQuerySchema.safeParse({ status }).success, status).toBe(true);
    }
    expect(ListItPeopleQuerySchema.safeParse({ status: 'onLeave' }).success).toBe(false);
    expect(ListItPeopleQuerySchema.safeParse({ sortBy: 'salary' }).success).toBe(false);
    expect(ListItPeopleQuerySchema.safeParse({ departmentId: oid(1) }).success).toBe(false);
  });

  it('offers technicians who work here today unless a filter asks for everyone', () => {
    const parsed = ListItTechniciansQuerySchema.safeParse({});
    expect(parsed.success && parsed.data.status).toBe('employed');
    expect(ListItTechniciansQuerySchema.safeParse({ status: 'all' }).success).toBe(true);
    // There is no «only the ones who left» list of people to assign work to.
    expect(ListItTechniciansQuerySchema.safeParse({ status: 'exited' }).success).toBe(false);
  });

  it('filters the asset register by the person holding an asset now', () => {
    expect(ListItAssetsQuerySchema.safeParse({ holderEmployeeId: oid(1) }).success).toBe(true);
    expect(ListItAssetsQuerySchema.safeParse({ holderEmployeeId: 'x' }).success).toBe(false);
  });
});

// «وعايز الأتنين دول يبقوا Multiselect» — the category and the name filters of the asset and custody
// registers take several answers; a name is free text and may hold a comma.
describe('it register filters — several categories, several names', () => {
  const oid = (n: number) => String(n).padStart(24, '0');

  it('reads several categories, and still a single one — every link written before', () => {
    const many = ListItAssetsQuerySchema.parse({ categoryId: `${oid(1)},${oid(2)}` });
    expect(many.categoryId).toEqual([oid(1), oid(2)]);
    expect(ListItAssetsQuerySchema.parse({ categoryId: oid(3) }).categoryId).toEqual([oid(3)]);
    expect(ListItAssetsQuerySchema.parse({}).categoryId).toBeUndefined();
    expect(ListItAssetsQuerySchema.safeParse({ categoryId: `${oid(1)},x` }).success).toBe(false);
    expect(
      ListItAssignmentsQuerySchema.parse({ categoryId: `${oid(1)},${oid(2)}` }).categoryId,
    ).toEqual([oid(1), oid(2)]);
    expect(ListItAssetNamesQuerySchema.parse({ categoryId: oid(4) }).categoryId).toEqual([oid(4)]);
    expect(ListItAssetNamesQuerySchema.parse({}).categoryId).toBeUndefined();
  });

  it('reads several names, a comma inside a name kept whole by its escape', () => {
    const parsed = ListItAssetsQuerySchema.parse({
      name: 'Lenovo ThinkCentre neo 50a 24,شاشة 24\\, Dell',
    });
    expect(parsed.name).toEqual(['Lenovo ThinkCentre neo 50a 24', 'شاشة 24, Dell']);
    expect(ListItAssetsQuerySchema.parse({ name: 'Dell E2423H' }).name).toEqual(['Dell E2423H']);
    expect(ListItAssetsQuerySchema.parse({ name: '' }).name).toBeUndefined();
    expect(
      ListItAssignmentsQuerySchema.parse({ assetName: 'Dell E2423H,HP 85A' }).assetName,
    ).toEqual(['Dell E2423H', 'HP 85A']);
  });

  it('keeps the custody register\u2019s text search beside the names', () => {
    const parsed = ListItAssignmentsQuerySchema.parse({
      search: 'PF5KX8ZT',
      assetName: 'Dell E2423H',
    });
    expect(parsed).toMatchObject({ search: 'PF5KX8ZT', assetName: ['Dell E2423H'] });
  });

  it('refuses an unknown key on the names endpoint', () => {
    expect(ListItAssetNamesQuerySchema.safeParse({ search: 'Dell' }).success).toBe(false);
  });
});

// FR-18 — the custody receipt: one employee, one or more assets, one paper.
describe('it custody receipt contracts', () => {
  const line = (n: number) => ({ assetId: oid(n), conditionOnIssue: 'N', notes: 'Mouse&KeyBord' });

  it('a hand-over names the employee and lists at least one asset', () => {
    expect(HandOverItAssetsSchema.safeParse({ employeeId: oid(1), lines: [line(2)] }).success).toBe(
      true,
    );
    expect(HandOverItAssetsSchema.safeParse({ employeeId: oid(1), lines: [] }).success).toBe(false);
    expect(HandOverItAssetsSchema.safeParse({ lines: [line(2)] }).success).toBe(false);
  });

  it('lists an asset once per paper, and no more lines than a page holds', () => {
    const twice = HandOverItAssetsSchema.safeParse({
      employeeId: oid(1),
      lines: [line(2), { assetId: oid(2) }],
    });
    expect(twice.success).toBe(false);
    const many = Array.from({ length: IT_HAND_OVER_MAX_LINES + 1 }, (_, i) => line(i + 10));
    expect(HandOverItAssetsSchema.safeParse({ employeeId: oid(1), lines: many }).success).toBe(
      false,
    );
  });

  it('refuses an expected return before the hand-over, and a field it does not know', () => {
    expect(
      HandOverItAssetsSchema.safeParse({
        employeeId: oid(1),
        lines: [line(2)],
        assignedAt: '2026-10-04T10:00:00.000Z',
        expectedReturnAt: '2026-10-01T10:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      HandOverItAssetsSchema.safeParse({ employeeId: oid(1), lines: [line(2)], kind: 'handOver' })
        .success,
    ).toBe(false);
  });

  it('a hand-over may name the number its paper was printed with; a preview may not — it takes one', () => {
    expect(
      HandOverItAssetsSchema.safeParse({ employeeId: oid(1), lines: [line(2)], formNumber: 7 })
        .success,
    ).toBe(true);
    expect(
      HandOverItAssetsSchema.safeParse({ employeeId: oid(1), lines: [line(2)], formNumber: 0 })
        .success,
    ).toBe(false);
    expect(
      PreviewItCustodyReceiptSchema.safeParse({
        employeeId: oid(1),
        lines: [line(2)],
        formNumber: 7,
      }).success,
    ).toBe(false);
    expect(formatCustodyReceiptNumber(1)).toBe('EGYCASH-IT-F-14-0001');
  });

  it('a preview defaults to a hand-over; a transfer’s paper carries exactly one asset', () => {
    const parsed = PreviewItCustodyReceiptSchema.parse({ employeeId: oid(1), lines: [line(2)] });
    expect(parsed.kind).toBe('handOver');
    expect(
      PreviewItCustodyReceiptSchema.safeParse({
        kind: 'transfer',
        employeeId: oid(1),
        lines: [line(2), line(3)],
      }).success,
    ).toBe(false);
  });
});

// «Dashboard بدل اللى موجود فيها … أقدر أفلتر بـالفئة.. من خلال Drop Down بـ Multiselection» — the
// home dashboard's filters, and the two list filters its «يحتاج متابعة» rows open.
describe('it dashboard contracts', () => {
  const oid = (n: number) => String(n).padStart(24, '0');

  it('takes several categories and one branch, both optional, and nothing else', () => {
    expect(ItDashboardQuerySchema.parse({})).toEqual({});
    const parsed = ItDashboardQuerySchema.parse({
      categoryId: `${oid(1)},${oid(2)}`,
      branchId: oid(3),
    });
    expect(parsed).toEqual({ categoryId: [oid(1), oid(2)], branchId: oid(3) });
    expect(ItDashboardQuerySchema.safeParse({ branchId: 'x' }).success).toBe(false);
    expect(ItDashboardQuerySchema.safeParse({ status: 'inStock' }).success).toBe(false);
  });

  it('opens the warranty row as a list: a window of days, bounded', () => {
    expect(
      ListItAssetsQuerySchema.parse({ warrantyEndsWithinDays: '30' }).warrantyEndsWithinDays,
    ).toBe(30);
    expect(ListItAssetsQuerySchema.safeParse({ warrantyEndsWithinDays: '0' }).success).toBe(false);
    expect(ListItAssetsQuerySchema.safeParse({ warrantyEndsWithinDays: '400' }).success).toBe(
      false,
    );
  });

  it('opens the leavers row as a list: the holder left, or did not', () => {
    expect(ListItAssignmentsQuerySchema.parse({ holderExited: 'true' }).holderExited).toBe(true);
    expect(ListItAssignmentsQuerySchema.parse({ holderExited: 'false' }).holderExited).toBe(false);
    expect(ListItAssignmentsQuerySchema.safeParse({ holderExited: 'maybe' }).success).toBe(false);
  });
});

// «فحص أجهزة السيارة» (FR-21, docs/12-planning/it-vehicle-checks-design.md §6.2): the car, the day
// and the request id are the only required fields; every answer is optional, and the day is the
// Cairo calendar day — never after today there.
describe('it vehicle check contracts', () => {
  const requestId = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  const base = { vehicleId: oid(7), checkDate: '2026-11-01', clientRequestId: requestId };

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 00:30 in Cairo on 2026-11-08 (UTC+2 in November): UTC is still on 2026-11-07. */
  const atHalfPastMidnightInCairo = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T22:30:00.000Z'));
  };

  it('lists the eleven devices in the owner’s order', () => {
    expect(IT_VEHICLE_CHECK_ITEMS).toEqual([
      'screen',
      'camera1',
      'camera2',
      'camera3',
      'camera4',
      'camera5',
      'camera6',
      'camera7',
      'camera8',
      'dvr',
      'radio',
    ]);
  });

  it('turns every missing item key into null — no answer is mandatory', () => {
    const allNull = Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((k) => [k, null]));
    expect(CreateItVehicleCheckSchema.parse(base).items).toEqual(allNull);
    expect(CreateItVehicleCheckSchema.parse({ ...base, items: {} }).items).toEqual(allNull);
    const parsed = CreateItVehicleCheckSchema.parse({
      ...base,
      items: { screen: 'works', camera3: 'notWorking', radio: null },
    });
    expect(parsed.items).toEqual({ ...allNull, screen: 'works', camera3: 'notWorking' });
    expect(parsed.notes).toBeUndefined();
  });

  it('refuses an unknown item key or answer, and any field the caller does not own', () => {
    expect(
      CreateItVehicleCheckSchema.safeParse({ ...base, items: { camera9: 'works' } }).success,
    ).toBe(false);
    expect(
      CreateItVehicleCheckSchema.safeParse({ ...base, items: { screen: 'broken' } }).success,
    ).toBe(false);
    expect(
      CreateItVehicleCheckSchema.safeParse({ ...base, items: { screen: 'missing' } }).success,
    ).toBe(false);
    expect(CreateItVehicleCheckSchema.safeParse({ ...base, vehicleCode: 'كورولا 1' }).success).toBe(
      false,
    );
    expect(CreateItVehicleCheckSchema.safeParse({ ...base, vehicleId: 'x' }).success).toBe(false);
  });

  // «كمان عايز الملاحظة إجبارى لو فى حاجة لا تعمل».
  it('asks for a note exactly when a device is «لا يعمل»', () => {
    expect(vehicleCheckNeedsNotes(undefined)).toBe(false);
    expect(vehicleCheckNeedsNotes({})).toBe(false);
    expect(vehicleCheckNeedsNotes({ screen: 'works', dvr: null })).toBe(false);
    expect(vehicleCheckNeedsNotes({ screen: 'works', camera7: 'notWorking' })).toBe(true);
  });

  it('trims the note and refuses one over 1000 characters', () => {
    const max = 'م'.repeat(IT_VEHICLE_CHECK_NOTES_MAX);
    expect(CreateItVehicleCheckSchema.parse({ ...base, notes: `  ${max}  ` }).notes).toBe(max);
    expect(CreateItVehicleCheckSchema.parse({ ...base, notes: '   ' }).notes).toBe('');
    expect(CreateItVehicleCheckSchema.safeParse({ ...base, notes: `${max}م` }).success).toBe(false);
  });

  it('refuses a request id, or a photo id, that is not a UUID', () => {
    const withoutId = { vehicleId: base.vehicleId, checkDate: base.checkDate };
    expect(CreateItVehicleCheckSchema.safeParse(withoutId).success).toBe(false);
    expect(
      CreateItVehicleCheckSchema.safeParse({ ...base, clientRequestId: 'not-a-uuid' }).success,
    ).toBe(false);
    expect(ItVehicleCheckPhotoFieldsSchema.safeParse({ clientPhotoId: requestId }).success).toBe(
      true,
    );
    expect(ItVehicleCheckPhotoFieldsSchema.safeParse({ clientPhotoId: '42' }).success).toBe(false);
  });

  it('refuses a day that is not a calendar day', () => {
    atHalfPastMidnightInCairo();
    expect(CreateItVehicleCheckSchema.safeParse({ ...base, checkDate: '2026-02-30' }).success).toBe(
      false,
    );
    expect(CreateItVehicleCheckSchema.safeParse({ ...base, checkDate: '2026-11-1' }).success).toBe(
      false,
    );
    expect(CreateItVehicleCheckSchema.safeParse({ ...base, checkDate: '2026-02-28' }).success).toBe(
      true,
    );
  });

  it('refuses tomorrow in Cairo, and takes today at 00:30 Cairo while UTC is still on yesterday', () => {
    atHalfPastMidnightInCairo();
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-11-07');
    expect(CreateItVehicleCheckSchema.safeParse({ ...base, checkDate: '2026-11-08' }).success).toBe(
      true,
    );
    expect(CreateItVehicleCheckSchema.safeParse({ ...base, checkDate: '2026-11-09' }).success).toBe(
      false,
    );
    expect(CreateItVehicleCheckSchema.safeParse({ ...base, checkDate: '2026-11-07' }).success).toBe(
      true,
    );
  });
});

// The dashboard over those reports — «تمام نفذا الـ Dashboard بتاعت الفحص» (2026-11-10): its window
// and branch, the reports list's filters, and one photo of one report.
describe('it vehicle checks dashboard contracts', () => {
  it('counts «لم تُفحص منذ ٧ أيام» over seven days', () => {
    expect(IT_VEHICLE_CHECK_OVERDUE_DAYS).toBe(7);
  });

  it('takes an optional window of calendar days and one branch, and nothing else', () => {
    expect(ItVehicleCheckDashboardQuerySchema.parse({})).toEqual({});
    expect(
      ItVehicleCheckDashboardQuerySchema.parse({
        from: '2026-11-04',
        to: '2026-11-10',
        branchId: oid(3),
      }),
    ).toEqual({ from: '2026-11-04', to: '2026-11-10', branchId: oid(3) });
    for (const query of [
      { from: '2026-02-30' },
      { to: '2026-11-1' },
      { branchId: 'x' },
      { vehicleId: oid(4) },
      { period: '7' },
    ]) {
      expect(ItVehicleCheckDashboardQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('refuses a window whose start is after its end, on `from`', () => {
    expect(
      ItVehicleCheckDashboardQuerySchema.safeParse({ from: '2026-11-10', to: '2026-11-10' })
        .success,
    ).toBe(true);
    const inverted = ItVehicleCheckDashboardQuerySchema.safeParse({
      from: '2026-11-11',
      to: '2026-11-10',
    });
    expect(inverted.success).toBe(false);
    expect(inverted.error?.issues[0]?.path).toEqual(['from']);
    // One end alone is never compared: the route fills the other.
    expect(ItVehicleCheckDashboardQuerySchema.safeParse({ from: '2099-01-01' }).success).toBe(true);
  });

  it('pages the reports list and reads every filter from the address bar', () => {
    expect(ListItVehicleChecksQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      sortDir: 'desc',
    });
    expect(
      ListItVehicleChecksQuerySchema.parse({
        page: '2',
        pageSize: '10',
        from: '2026-11-04',
        to: '2026-11-10',
        branchId: oid(1),
        vehicleId: oid(2),
        carCode: '  ١٥٠  ',
        faultsOnly: 'true',
        device: 'camera7',
      }),
    ).toEqual({
      page: 2,
      pageSize: 10,
      sortDir: 'desc',
      from: '2026-11-04',
      to: '2026-11-10',
      branchId: oid(1),
      vehicleId: oid(2),
      carCode: '١٥٠',
      faultsOnly: true,
      device: 'camera7',
    });
  });

  it('reads faultsOnly from the strings a URL carries, and nothing else', () => {
    expect(ListItVehicleChecksQuerySchema.parse({ faultsOnly: 'true' }).faultsOnly).toBe(true);
    expect(ListItVehicleChecksQuerySchema.parse({ faultsOnly: 'false' }).faultsOnly).toBe(false);
    for (const faultsOnly of ['yes', '1', '']) {
      expect(ListItVehicleChecksQuerySchema.safeParse({ faultsOnly }).success).toBe(false);
    }
  });

  it('takes a device only among the eleven', () => {
    for (const device of IT_VEHICLE_CHECK_ITEMS) {
      expect(ListItVehicleChecksQuerySchema.parse({ device }).device).toBe(device);
    }
    for (const device of ['camera9', 'horn', 'DVR', '']) {
      expect(ListItVehicleChecksQuerySchema.safeParse({ device }).success).toBe(false);
    }
  });

  it('refuses an unknown filter, a bad day or id, a car code over 50, and a page over 100', () => {
    for (const query of [
      { status: 'notWorking' },
      { from: '2026-02-30' },
      { vehicleId: 'x' },
      { branchId: '42' },
      { carCode: '1'.repeat(51) },
      { pageSize: '101' },
    ]) {
      expect(ListItVehicleChecksQuerySchema.safeParse(query).success).toBe(false);
    }
    expect(ListItVehicleChecksQuerySchema.safeParse({ carCode: '1'.repeat(50) }).success).toBe(
      true,
    );
  });

  it('names one photo by its report and its file, both ids, and nothing else', () => {
    expect(ItVehicleCheckPhotoParamSchema.parse({ id: oid(1), fileId: oid(2) })).toEqual({
      id: oid(1),
      fileId: oid(2),
    });
    for (const params of [
      { id: oid(1) },
      { id: oid(1), fileId: 'photo.jpg' },
      { id: 'x', fileId: oid(2) },
      { id: oid(1), fileId: oid(2), index: '0' },
    ]) {
      expect(ItVehicleCheckPhotoParamSchema.safeParse(params).success).toBe(false);
    }
  });
});

// «عداد الطابعة» (2026-11-19): what the contract can hold without seeing the item's type. Whether a
// line NEEDS a reading, and whether it is strictly above the printer's last one, are the server's
// rules (it reads the type and the timeline); the shape and the cross-field rules are here.
describe('it consumables: the printer counter', () => {
  const name = { ar: 'حبارات', en: 'Toners' };
  const issue = (lines: Record<string, unknown>[]) => ({ employeeId: oid(1), lines });
  const line = (n: number, extra: Record<string, unknown> = {}) => ({
    consumableId: oid(10 + n),
    qty: 1,
    ...extra,
  });
  const issueIssues = (lines: Record<string, unknown>[]) => {
    const parsed = IssueItConsumablesSchema.safeParse(issue(lines));
    return parsed.success ? [] : parsed.error.issues.map((i) => [i.path.join('.'), i.message]);
  };

  it('flags a type «يتطلب عداد الطباعة» — off by default, a consumableType only', () => {
    expect(
      CreateItCatalogItemSchema.parse({ kind: 'consumableType', name }).requiresCounterReading,
    ).toBe(false);
    expect(
      CreateItCatalogItemSchema.parse({
        kind: 'consumableType',
        name,
        requiresCounterReading: true,
      }).requiresCounterReading,
    ).toBe(true);
    for (const kind of ['assetCategory', 'ticketCategory']) {
      const refused = CreateItCatalogItemSchema.safeParse({
        kind,
        name,
        requiresCounterReading: true,
      });
      expect(refused.success).toBe(false);
      expect(refused.error?.issues[0]?.path).toEqual(['requiresCounterReading']);
      expect(
        CreateItCatalogItemSchema.safeParse({ kind, name, requiresCounterReading: false }).success,
      ).toBe(true);
    }
    expect(
      CreateItCatalogItemSchema.safeParse({
        kind: 'consumableType',
        name,
        requiresCounterReading: 1,
      }).success,
    ).toBe(false);
  });

  it('edits the flag, and leaves it untouched when it is not sent', () => {
    expect(UpdateItCatalogItemSchema.parse({ version: 0, requiresCounterReading: true })).toEqual({
      version: 0,
      requiresCounterReading: true,
    });
    expect(UpdateItCatalogItemSchema.parse({ version: 0 })).not.toHaveProperty(
      'requiresCounterReading',
    );
    expect(
      UpdateItCatalogItemSchema.safeParse({ version: 0, requiresCounterReading: null }).success,
    ).toBe(false);
  });

  it('takes a reading and a reset on an issue line, onto its printer', () => {
    const parsed = IssueItConsumablesSchema.parse(
      issue([line(1, { assetId: oid(2), counterReading: 15_230, counterReset: true })]),
    );
    expect(parsed.lines[0]).toEqual({
      consumableId: oid(11),
      qty: 1,
      reason: 'new',
      assetId: oid(2),
      counterReading: 15_230,
      counterReset: true,
    });
    // A line with no reading is what it always was — the server says whether its type needs one.
    expect(IssueItConsumablesSchema.parse(issue([line(1)])).lines[0]).toEqual({
      consumableId: oid(11),
      qty: 1,
      reason: 'new',
    });
    expect(issueIssues([line(1, { assetId: oid(2), counterReading: 0 })])).toEqual([]);
  });

  it('bounds the reading: a whole number from 0 to the max', () => {
    for (const counterReading of [IT_PRINTER_COUNTER_MAX, 0, 1]) {
      expect(issueIssues([line(1, { assetId: oid(2), counterReading })])).toEqual([]);
    }
    for (const counterReading of [-1, 12.5, IT_PRINTER_COUNTER_MAX + 1, '15230', null]) {
      expect(issueIssues([line(1, { assetId: oid(2), counterReading })])).not.toEqual([]);
    }
    expect(
      issueIssues([line(1, { assetId: oid(2), counterReading: 5, counterReset: 'yes' })]),
    ).not.toEqual([]);
  });

  it('refuses a reset with no reading, and a reading with no printer', () => {
    expect(issueIssues([line(1, { assetId: oid(2), counterReset: true })])).toEqual([
      ['lines.0.counterReset', 'a reset names the reading it starts from'],
    ]);
    expect(issueIssues([line(1, { counterReading: 100 })])).toEqual([
      ['lines.0.assetId', 'a counter reading belongs to the printer the item is installed on'],
    ]);
    // `counterReset: false` says nothing, so it needs no reading.
    expect(issueIssues([line(1, { assetId: oid(2), counterReset: false })])).toEqual([]);
  });

  it('holds two lines on one printer to one reading — one memo, one display', () => {
    const p = oid(2);
    // The same reading and reset: two colours fitted at once.
    expect(
      issueIssues([
        line(1, { assetId: p, counterReading: 500 }),
        line(2, { assetId: p, counterReading: 500 }),
      ]),
    ).toEqual([]);
    expect(
      issueIssues([
        line(1, { assetId: p, counterReading: 500 }),
        line(2, { assetId: p, counterReading: 501 }),
        line(3, { assetId: p, counterReading: 500, counterReset: true }),
      ]),
    ).toEqual([
      ['lines.1.counterReading', 'two lines on one printer carry one counter reading'],
      ['lines.2.counterReading', 'two lines on one printer carry one counter reading'],
    ]);
    // Another printer, or a line on the same printer with no reading (a cable), is not compared.
    expect(
      issueIssues([
        line(1, { assetId: p, counterReading: 500 }),
        line(2, { assetId: oid(3), counterReading: 20 }),
        line(3, { assetId: p }),
      ]),
    ).toEqual([]);
  });

  it('carries the reading through «تعديل الجهاز», and never onto «بدون جهاز»', () => {
    expect(
      SetItConsumableInstalledOnSchema.parse({
        assetId: oid(2),
        counterReading: 900,
        counterReset: true,
        version: 3,
      }),
    ).toEqual({ assetId: oid(2), counterReading: 900, counterReset: true, version: 3 });
    expect(SetItConsumableInstalledOnSchema.parse({ assetId: null, version: 0 })).toEqual({
      assetId: null,
      version: 0,
    });
    const refused = (body: Record<string, unknown>) => {
      const parsed = SetItConsumableInstalledOnSchema.safeParse(body);
      return parsed.success ? [] : parsed.error.issues.map((i) => [i.path.join('.'), i.message]);
    };
    expect(refused({ assetId: null, counterReading: 900, version: 0 })).toEqual([
      ['counterReading', 'a counter reading belongs to a device; «بدون جهاز» takes none'],
    ]);
    expect(refused({ assetId: oid(2), counterReset: true, version: 0 })).toEqual([
      ['counterReset', 'a reset names the reading it starts from'],
    ]);
    expect(refused({ assetId: oid(2), counterReading: -1, version: 0 })).not.toEqual([]);
    expect(refused({ assetId: oid(2), counterReading: 9, version: 0, pages: 4 })).not.toEqual([]);
  });

  it('names the three refusals in the error catalog', () => {
    expect(ErrorCodes.IT_CONSUMABLE_COUNTER_REQUIRED).toBe('IT_CONSUMABLE_COUNTER_REQUIRED');
    expect(ErrorCodes.IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS).toBe(
      'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS',
    );
    expect(ErrorCodes.IT_CONSUMABLE_COUNTER_ABOVE_NEXT).toBe('IT_CONSUMABLE_COUNTER_ABOVE_NEXT');
  });
});

// «أعينها فى مكان بس تبقى على عهده الإدارة .. زى السيرفرات والكاميرات والسويتشات» (2026-11-19): a
// hand-over, an assignment, a transfer and an issue each name exactly ONE holder — an employee, or
// a department at a place signed for by its responsible person — and every body sent before still
// parses as it did.
describe('it department custody («في عهدة إدارة … — الموقع …»)', () => {
  const department = { departmentId: oid(41), locationId: oid(42), responsibleEmployeeId: oid(43) };
  const line = (n: number) => ({ assetId: oid(n) });
  const issuesOf = (parsed: {
    success: boolean;
    error?: { issues: { path: (string | number)[]; message: string }[] };
  }) =>
    parsed.success ? [] : (parsed.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]);
  const ONE_HOLDER = 'a hand-over names an employee or a department — exactly one';
  const without = (key: keyof typeof department) =>
    Object.fromEntries(Object.entries(department).filter(([k]) => k !== key));

  it('declares the two holder kinds', () => {
    expect(IT_ASSET_HOLDER_KINDS).toEqual(['employee', 'department']);
  });

  it('names a department by its three ids — the department, the place, the signer — and nothing else', () => {
    expect(ItCustodianDepartmentInputSchema.parse(department)).toEqual(department);
    for (const key of ['departmentId', 'locationId', 'responsibleEmployeeId'] as const) {
      expect(ItCustodianDepartmentInputSchema.safeParse(without(key)).success, key).toBe(false);
      expect(
        ItCustodianDepartmentInputSchema.safeParse({ ...department, [key]: 'x' }).success,
        key,
      ).toBe(false);
    }
    // The branch is the place's own — never sent beside it.
    expect(
      ItCustodianDepartmentInputSchema.safeParse({ ...department, branchId: oid(9) }).success,
    ).toBe(false);
  });

  it('hands over to an employee as before, or to a department — exactly one', () => {
    expect(
      issuesOf(HandOverItAssetsSchema.safeParse({ employeeId: oid(1), lines: [line(2)] })),
    ).toEqual([]);
    const toDepartment = HandOverItAssetsSchema.parse({ department, lines: [line(2), line(3)] });
    expect(toDepartment.department).toEqual(department);
    expect(toDepartment.employeeId).toBeUndefined();
    expect(
      issuesOf(
        HandOverItAssetsSchema.safeParse({ employeeId: oid(1), department, lines: [line(2)] }),
      ),
    ).toEqual([['employeeId', ONE_HOLDER]]);
    expect(issuesOf(HandOverItAssetsSchema.safeParse({ lines: [line(2)] }))).toEqual([
      ['employeeId', ONE_HOLDER],
    ]);
    // A department missing its signer is not a department holder.
    expect(
      HandOverItAssetsSchema.safeParse({
        department: without('responsibleEmployeeId'),
        lines: [line(2)],
      }).success,
    ).toBe(false);
  });

  it('previews a department paper, a transfer’s one-line paper too, under the same rule', () => {
    expect(
      PreviewItCustodyReceiptSchema.parse({ department, lines: [line(2)] }).department,
    ).toEqual(department);
    expect(
      issuesOf(
        PreviewItCustodyReceiptSchema.safeParse({ kind: 'transfer', department, lines: [line(2)] }),
      ),
    ).toEqual([]);
    expect(
      issuesOf(
        PreviewItCustodyReceiptSchema.safeParse({
          employeeId: oid(1),
          department,
          lines: [line(2)],
        }),
      ),
    ).toEqual([['employeeId', ONE_HOLDER]]);
    expect(issuesOf(PreviewItCustodyReceiptSchema.safeParse({ lines: [line(2)] }))).toEqual([
      ['employeeId', ONE_HOLDER],
    ]);
  });

  it('assigns one asset to an employee or a department — exactly one', () => {
    expect(issuesOf(AssignItAssetSchema.safeParse({ employeeId: oid(1) }))).toEqual([]);
    expect(AssignItAssetSchema.parse({ department }).department).toEqual(department);
    expect(issuesOf(AssignItAssetSchema.safeParse({ employeeId: oid(1), department }))).toEqual([
      ['employeeId', ONE_HOLDER],
    ]);
    expect(issuesOf(AssignItAssetSchema.safeParse({}))).toEqual([['employeeId', ONE_HOLDER]]);
  });

  it('transfers to a department, from one, or between places — never to two holders at once', () => {
    for (const body of [
      { toDepartment: department },
      { toDepartment: department, toBranchId: oid(5) },
      { toEmployeeId: oid(1) },
      { toBranchId: oid(5) },
    ]) {
      expect(issuesOf(TransferItAssetSchema.safeParse(body)), JSON.stringify(body)).toEqual([]);
    }
    expect(
      issuesOf(TransferItAssetSchema.safeParse({ toEmployeeId: oid(1), toDepartment: department })),
    ).toEqual([
      ['toEmployeeId', 'a transfer names one new holder — an employee or a department, not both'],
    ]);
    expect(issuesOf(TransferItAssetSchema.safeParse({ notes: 'x' }))).toEqual([
      [
        'toEmployeeId',
        'a transfer needs a new holder (employee or department), a new branch, or both',
      ],
    ]);
    expect(TransferItAssetSchema.safeParse({ toDepartment: without('locationId') }).success).toBe(
      false,
    );
  });

  it('issues consumables to an employee or a department — exactly one — the counter rules unchanged', () => {
    const consumable = { consumableId: oid(11), qty: 1 };
    const ONE_MEMO = 'a memo is issued to an employee or to a department — exactly one';
    expect(IssueItConsumablesSchema.parse({ department, lines: [consumable] }).department).toEqual(
      department,
    );
    expect(
      issuesOf(
        IssueItConsumablesSchema.safeParse({ employeeId: oid(1), department, lines: [consumable] }),
      ),
    ).toEqual([['employeeId', ONE_MEMO]]);
    expect(issuesOf(IssueItConsumablesSchema.safeParse({ lines: [consumable] }))).toEqual([
      ['employeeId', ONE_MEMO],
    ]);
    // A toner onto a department-held printer takes its reading like any other.
    expect(
      issuesOf(
        IssueItConsumablesSchema.safeParse({
          department,
          lines: [{ ...consumable, assetId: oid(2), counterReading: 1200 }],
        }),
      ),
    ).toEqual([]);
    expect(
      issuesOf(
        IssueItConsumablesSchema.safeParse({
          department,
          lines: [{ ...consumable, counterReading: 1200 }],
        }),
      ),
    ).toEqual([
      ['lines.0.assetId', 'a counter reading belongs to the printer the item is installed on'],
    ]);
  });

  it('filters the registers by holder kind, department, place and signer', () => {
    expect(
      ListItAssetsQuerySchema.parse({
        holderKind: 'department',
        holderDepartmentId: oid(41),
        locationId: oid(42),
      }),
    ).toMatchObject({ holderKind: 'department', holderDepartmentId: oid(41), locationId: oid(42) });
    expect(ListItAssetsQuerySchema.safeParse({ holderKind: 'vehicle' }).success).toBe(false);
    expect(ListItAssetsQuerySchema.safeParse({ locationId: 'x' }).success).toBe(false);

    expect(
      ListItAssignmentsQuerySchema.parse({
        holderKind: 'employee',
        departmentId: oid(41),
        locationId: oid(42),
        responsibleEmployeeId: oid(43),
      }),
    ).toMatchObject({
      holderKind: 'employee',
      departmentId: oid(41),
      locationId: oid(42),
      responsibleEmployeeId: oid(43),
    });
    expect(ListItAssignmentsQuerySchema.safeParse({ responsibleEmployeeId: 'x' }).success).toBe(
      false,
    );

    expect(
      ListItConsumableMovementsQuerySchema.parse({
        departmentId: oid(41),
        locationId: oid(42),
        responsibleEmployeeId: oid(43),
      }),
    ).toMatchObject({ departmentId: oid(41), locationId: oid(42), responsibleEmployeeId: oid(43) });
    // The ledger has no holder-kind filter: a row names a department or it does not.
    expect(
      ListItConsumableMovementsQuerySchema.safeParse({ holderKind: 'department' }).success,
    ).toBe(false);
  });

  it('keeps the department off a mobile line’s paper — a line is never held by a department', () => {
    type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;
    const device: Has<ItCustodyReceiptDocumentDto, 'custodian'> = true;
    const mobileLine: Has<ItMobileLineReceiptDocumentDto, 'custodian'> = false;
    expect([device, mobileLine]).toEqual([true, false]);
  });

  it('publishes the department on the custody events, and an employee’s event parses as before', () => {
    const asset = { assetId: oid(1), assetCode: 'AST-00001' };
    expect(
      ItAssetAssignedPayloadV1.safeParse({ ...asset, employeeId: oid(2), assignmentId: oid(3) })
        .success,
    ).toBe(true);
    expect(
      ItAssetAssignedPayloadV1.safeParse({
        ...asset,
        employeeId: null,
        assignmentId: oid(3),
        holderKind: 'department',
        ...department,
      }).success,
    ).toBe(true);
    expect(
      ItAssetReturnedPayloadV1.safeParse({ ...asset, employeeId: oid(2), condition: null }).success,
    ).toBe(true);
    expect(
      ItAssetReturnedPayloadV1.safeParse({
        ...asset,
        employeeId: null,
        condition: 'N',
        holderKind: 'department',
        ...department,
      }).success,
    ).toBe(true);
    const moved = {
      ...asset,
      fromEmployeeId: oid(2),
      toEmployeeId: null,
      fromBranchId: null,
      toBranchId: null,
    };
    expect(ItAssetTransferredPayloadV1.safeParse(moved).success).toBe(true);
    expect(
      ItAssetTransferredPayloadV1.safeParse({
        ...moved,
        fromDepartmentId: null,
        toDepartmentId: oid(41),
        fromLocationId: null,
        toLocationId: oid(42),
      }).success,
    ).toBe(true);
  });
});

// «المواقع» — the per-branch list of places a department keeps what it holds at.
describe('it locations («المواقع»)', () => {
  const name = { ar: 'غرفة السيرفرات', en: 'Server room' };

  it('creates a place in a branch, ordered 0 unless told, active by nature', () => {
    expect(CreateItLocationSchema.parse({ branchId: oid(1), name })).toEqual({
      branchId: oid(1),
      name,
      sortOrder: 0,
    });
    expect(
      CreateItLocationSchema.parse({
        branchId: oid(1),
        name,
        code: ' SRV-1 ',
        description: 'الدور الثالث',
        sortOrder: 2,
      }),
    ).toMatchObject({ code: 'SRV-1', description: 'الدور الثالث', sortOrder: 2 });
    expect(CreateItLocationSchema.safeParse({ name }).success).toBe(false);
    expect(CreateItLocationSchema.safeParse({ branchId: oid(1) }).success).toBe(false);
    expect(
      CreateItLocationSchema.safeParse({ branchId: oid(1), name: { ar: '', en: 'x' } }).success,
    ).toBe(false);
    // Created active: the switch is the edit's.
    expect(
      CreateItLocationSchema.safeParse({ branchId: oid(1), name, isActive: false }).success,
    ).toBe(false);
  });

  it('edits a place — retiring it included — but never moves it to another branch', () => {
    expect(UpdateItLocationSchema.parse({ version: 3, isActive: false })).toEqual({
      version: 3,
      isActive: false,
    });
    expect(
      UpdateItLocationSchema.parse({ version: 0, code: null, description: null, name }),
    ).toEqual({ version: 0, code: null, description: null, name });
    expect(UpdateItLocationSchema.safeParse({ version: 0, branchId: oid(2) }).success).toBe(false);
    expect(UpdateItLocationSchema.safeParse({ isActive: false }).success).toBe(false);
  });

  it('lists by branch, status and text; offers one branch or all, the retired ones when asked', () => {
    expect(
      ListItLocationsQuerySchema.parse({
        branchId: oid(1),
        isActive: 'false',
        search: 'السيرفرات',
      }),
    ).toMatchObject({ branchId: oid(1), isActive: false, search: 'السيرفرات', page: 1 });
    expect(ListItLocationsQuerySchema.safeParse({ kind: 'location' }).success).toBe(false);

    expect(ItLocationOptionsQuerySchema.parse({})).toEqual({});
    expect(
      ItLocationOptionsQuerySchema.parse({ branchId: oid(1), includeInactive: 'true' }),
    ).toEqual({ branchId: oid(1), includeInactive: true });
    // Names only, whole — not a page.
    expect(ItLocationOptionsQuerySchema.safeParse({ page: '2' }).success).toBe(false);
  });
});
