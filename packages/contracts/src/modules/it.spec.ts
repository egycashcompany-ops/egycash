// The IT contract guards that carry business rules — the ones a careless caller would violate
// first: status is not writable (FR-2), the code is not writable (FR-1), warranty dates are
// ordered, and the label batch is bounded.
//
// IT-3 adds the help desk's own set, and they are the same KIND of guard: everything the server
// owns (the ticket code, the status, the SLA snapshot, the requester) must be unwritable, and the
// two cross-field rules (a hold needs a reason, a resolution target cannot undercut a response
// target) must fail in the schema rather than deep in a service.
import { describe, expect, it } from 'vitest';
import {
  AssignItTicketSchema,
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
