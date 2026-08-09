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
import { describe, expect, it } from 'vitest';
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
  ReopenItTicketSchema,
  ResolveItTicketSchema,
  UpdateItAssetSchema,
  UpdateItTicketPrioritySchema,
  UpdateItTicketSchema,
} from './it.js';

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
    expect(
      CreateItCatalogItemSchema.safeParse({ kind: 'assetCategory', name }).success,
    ).toBe(true);
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
    expect(
      CreateItTicketCommentSchema.safeParse({ body: 'x', visibility: 'secret' }).success,
    ).toBe(false);
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
    expect(ListItTicketsQuerySchema.safeParse({ requesterUserId: oid(1) }).success).toBe(false);
  });
});

// ── IT-4: maintenance and the store ─────────────────────────────────────────

describe('it maintenance contracts', () => {
  const oid = (n: number) => String(n).padStart(24, '0');

  it('keeps the order code, status, timestamps and kind out of a caller\'s hands', () => {
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

  it('keeps a plan\'s clock and its active flag off the write schemas', () => {
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
    expect(ListItMaintenanceOrdersQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);

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
    expect(CreateItSoftwareProductSchema.safeParse({ name: 'Microsoft Office' }).success).toBe(true);
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
