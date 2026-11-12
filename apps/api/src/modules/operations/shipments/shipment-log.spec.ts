// The action log's mapping, pinned row by row without a database: which audit row becomes which
// kind of entry, and that every value reaches the screen as a name, a code, a day or an amount —
// never as the id or the minor units the audit row stores.
import { describe, expect, it } from 'vitest';
import { type AuditLogDto } from '@ecms/contracts';
import {
  DISTRIBUTION_RESCHEDULE_MARKER,
  SHIPMENT_LOG_ENTITY,
  buildShipmentLogEntries,
  collectShipmentLogRefs,
  type ShipmentLogNames,
} from './shipment-log';

const oid = (n: number): string => n.toString(16).padStart(24, '0');
const BANK_A = oid(1);
const BANK_B = oid(2);
const BRANCH_A = oid(3);
const BRANCH_B = oid(4);
const EGP = oid(5);
const USD = oid(6);
const CAPTAIN_1 = oid(7);
const CAPTAIN_2 = oid(8);
const VAN_1 = oid(9);
const TREASURER_1 = oid(10);
const TREASURER_2 = oid(11);
const SHIPMENT = oid(20);
const LEG = oid(21);
const CUSTODY = oid(22);

const NAMES: Record<string, string> = {
  [BANK_A]: 'الأهلي',
  [BANK_B]: 'مصر',
  [BRANCH_A]: 'فرع التحرير (101)',
  [BRANCH_B]: 'فرع المعادي (202)',
  [EGP]: 'مصري',
  [USD]: 'دولار',
  [CAPTAIN_1]: 'قائد أول',
  [CAPTAIN_2]: 'قائد ثان',
  [TREASURER_1]: 'أمين أول',
  [TREASURER_2]: 'أمين ثان',
  [VAN_1]: 'ك-12',
};
const lookup = (id: string): string | null => NAMES[id] ?? null;
const names: ShipmentLogNames = {
  bank: lookup,
  branch: lookup,
  currency: lookup,
  person: lookup,
  vehicle: lookup,
};

let rowCounter = 0;
const row = (
  entityType: string,
  entityId: string,
  action: AuditLogDto['action'],
  changes: AuditLogDto['changes'] = [],
  requestId: string | null = null,
): AuditLogDto => {
  rowCounter += 1;
  return {
    id: oid(1000 + rowCounter),
    entityRef: { moduleId: 'operations', entityType, entityId },
    action,
    changes,
    actor: { userId: oid(99), ip: null, userAgent: null },
    actorSnapshot: {
      userId: oid(99),
      displayName: { ar: 'موظف المكتب', en: 'Desk clerk' },
      jobTitle: null,
      avatarFileId: null,
      deletedAt: null,
    },
    requestId,
    at: new Date(Date.UTC(2026, 10, 11, 8, 0, rowCounter)).toISOString(),
  };
};
const shipmentRow = (
  action: AuditLogDto['action'],
  changes: AuditLogDto['changes'] = [],
  requestId: string | null = null,
) => row(SHIPMENT_LOG_ENTITY.shipment, SHIPMENT, action, changes, requestId);

const build = (rows: AuditLogDto[]) =>
  buildShipmentLogEntries(rows, new Map([[LEG, 'pickup' as const]]), names);

describe('the shipment action log — one audit row, one entry, in names', () => {
  it('prints a creation with its first values, and an edit with each changed field old → new', () => {
    const [created, edited] = build([
      shipmentRow('create', [
        { field: 'shipmentType', old: null, new: 'daily' },
        { field: 'status', old: null, new: 'draft' },
        { field: 'mainBankId', old: null, new: BANK_A },
        { field: 'originBranchId', old: null, new: BRANCH_A },
        { field: 'lines', old: null, new: [{ currencyId: EGP, amountMinor: 150_050 }] },
        { field: 'collectionDate', old: null, new: '2026-11-11T00:00:00.000Z' },
        { field: 'serialTracked', old: null, new: false },
      ]),
      shipmentRow('update', [
        { field: 'mainBankId', old: BANK_A, new: BANK_B },
        { field: 'destinationBranchId', old: BRANCH_A, new: BRANCH_B },
        {
          field: 'lines',
          old: [{ currencyId: EGP, amountMinor: 150_050 }],
          new: [
            { currencyId: EGP, amountMinor: 200_000 },
            { currencyId: USD, amountMinor: 5_000 },
          ],
        },
        {
          field: 'collectionDate',
          old: '2026-11-11T00:00:00.000Z',
          new: '2026-11-14T00:00:00.000Z',
        },
        { field: 'serialTracked', old: false, new: true },
        { field: 'notes', old: null, new: 'ملاحظة' },
      ]),
    ]);

    expect(created?.kind).toBe('created');
    expect(created?.actorName).toBe('موظف المكتب');
    expect(created?.leg).toBeNull();
    // The type and the status are never printed — the kind already says what they are.
    expect(created?.changes).toEqual([
      { field: 'mainBank', old: null, new: 'الأهلي' },
      { field: 'originBranch', old: null, new: 'فرع التحرير (101)' },
      { field: 'lines', old: null, new: 'مصري 1,500.5' },
      { field: 'collectionDate', old: null, new: '2026-11-11' },
      { field: 'serialTracked', old: null, new: 'false' },
    ]);

    expect(edited?.kind).toBe('edited');
    expect(edited?.changes).toEqual([
      { field: 'mainBank', old: 'الأهلي', new: 'مصر' },
      { field: 'destinationBranch', old: 'فرع التحرير (101)', new: 'فرع المعادي (202)' },
      { field: 'lines', old: 'مصري 1,500.5', new: 'مصري 2,000، دولار 50' },
      { field: 'collectionDate', old: '2026-11-11', new: '2026-11-14' },
      { field: 'serialTracked', old: 'false', new: 'true' },
      { field: 'notes', old: null, new: 'ملاحظة' },
    ]);
    // No reference id survives into the values the screen is given.
    expect(JSON.stringify([created?.changes, edited?.changes])).not.toMatch(/[0-9a-f]{24}/);
  });

  it('reads the desk ✓ and its undo, the receipt photo, delete and restore as their own acts', () => {
    const entries = build([
      shipmentRow('update', [{ field: 'status', old: 'draft', new: 'completed' }]),
      shipmentRow('update', [{ field: 'status', old: 'completed', new: 'draft' }]),
      shipmentRow('update', [{ field: 'receiptImage', old: null, new: oid(500) }]),
      shipmentRow('update', [{ field: 'receiptImage', old: oid(500), new: oid(501) }]),
      shipmentRow('update', [{ field: 'receiptImage', old: oid(501), new: null }]),
      shipmentRow('delete'),
      shipmentRow('restore'),
    ]);
    expect(entries.map((e) => e.kind)).toEqual([
      'received',
      'receiveUndone',
      'receiptImageAdded',
      'receiptImageReplaced',
      'receiptImageRemoved',
      'deleted',
      'restored',
    ]);
    // The photo's file id is never handed to the screen.
    expect(entries.every((e) => e.changes.length === 0)).toBe(true);
  });

  it('skips an edit that recorded no change — nothing happened', () => {
    expect(build([shipmentRow('update', [])])).toEqual([]);
  });

  it('prints a leg: crewed, re-crewed, reordered and each captain execution step', () => {
    const leg = (action: AuditLogDto['action'], changes: AuditLogDto['changes']) =>
      row(SHIPMENT_LOG_ENTITY.leg, LEG, action, changes);
    const entries = build([
      leg('create', [
        { field: 'leg', old: null, new: 'pickup' },
        { field: 'captainEmployeeId', old: null, new: CAPTAIN_1 },
        { field: 'vehicleId', old: null, new: VAN_1 },
        { field: 'crewAssignmentId', old: null, new: oid(600) },
        { field: 'sequence', old: null, new: 1 },
      ]),
      leg('update', [
        { field: 'captainEmployeeId', old: CAPTAIN_1, new: CAPTAIN_2 },
        { field: 'sequence', old: 1, new: 3 },
      ]),
      leg('update', [{ field: 'sequence', old: 3, new: 2 }]),
      leg('update', [{ field: 'executionStatus', old: 'pending', new: 'active' }]),
      leg('update', [{ field: 'executionStatus', old: 'active', new: 'pickedUp' }]),
      leg('update', [{ field: 'executionStatus', old: 'pickedUp', new: 'delivered' }]),
      leg('update', [{ field: 'executionStatus', old: 'delivered', new: 'completed' }]),
    ]);
    expect(entries.map((e) => e.kind)).toEqual([
      'crewAssigned',
      'crewChanged',
      'reordered',
      'executionStarted',
      'executionPickedUp',
      'executionDelivered',
      'executionCompleted',
    ]);
    expect(entries.every((e) => e.leg === 'pickup')).toBe(true);
    expect(entries[0]?.changes).toEqual([
      { field: 'captain', old: null, new: 'قائد أول' },
      { field: 'vehicle', old: null, new: 'ك-12' },
    ]);
    // A change of captain is the news; the re-seat on his route that comes with it is not.
    expect(entries[1]?.changes).toEqual([{ field: 'captain', old: 'قائد أول', new: 'قائد ثان' }]);
    expect(entries[2]?.changes).toEqual([{ field: 'sequence', old: '3', new: '2' }]);
  });

  it('folds the vault custody into the shipment entry of the same request — one act, one entry', () => {
    const custody = (action: AuditLogDto['action'], changes: AuditLogDto['changes'], req: string) =>
      row(SHIPMENT_LOG_ENTITY.custody, CUSTODY, action, changes, req);
    const entries = build([
      custody(
        'create',
        [
          { field: 'state', old: null, new: 'held' },
          { field: 'receiptNumber', old: null, new: 'R-77' },
          { field: 'bagCount', old: null, new: 3 },
          { field: 'bagSeals', old: null, new: ['S1', 'S2'] },
          { field: 'receivedByPrimaryId', old: null, new: TREASURER_1 },
          { field: 'receivedBySecondaryId', old: null, new: TREASURER_2 },
        ],
        'req-receive',
      ),
      shipmentRow('update', [{ field: 'status', old: 'draft', new: 'inVault' }], 'req-receive'),
      custody(
        'update',
        [
          { field: 'state', old: 'held', new: 'released' },
          { field: 'releasedById', old: null, new: oid(99) },
        ],
        'req-dispatch',
      ),
      shipmentRow(
        'update',
        [{ field: 'status', old: 'inVault', new: 'dispatched' }],
        'req-dispatch',
      ),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(['vaultReceived', 'dispatched']);
    expect(entries[0]?.changes).toEqual([
      { field: 'receiptNumber', old: null, new: 'R-77' },
      { field: 'bagCount', old: null, new: '3' },
      { field: 'bagSeals', old: null, new: 'S1، S2' },
      { field: 'receivedByPrimary', old: null, new: 'أمين أول' },
      { field: 'receivedBySecondary', old: null, new: 'أمين ثان' },
    ]);
    // The releaser is the entry's actor — not printed again as a raw user id.
    expect(entries[1]?.changes).toEqual([]);
  });

  // Round 10 — the pickup record («تم الاستلام من العمليات» / من القائد), its undo, and the vault's
  // receipt cancelled with a reason.
  it('reads the pickup ✓, its undo and a cancelled vault receipt as their own acts — saying WHO', () => {
    const custody = (action: AuditLogDto['action'], changes: AuditLogDto['changes'], req: string) =>
      row(SHIPMENT_LOG_ENTITY.custody, CUSTODY, action, changes, req);
    const entries = build([
      shipmentRow('update', [
        { field: 'pickedUpBy', old: null, new: 'operations' },
        { field: 'pickedUpAt', old: null, new: '2026-11-11T08:00:00.000Z' },
      ]),
      // The desk takes a CAPTAIN's ✓ back — the entry says whose it was.
      shipmentRow('update', [
        { field: 'pickedUpBy', old: 'captain', new: null },
        { field: 'pickedUpAt', old: '2026-11-11T07:00:00.000Z', new: null },
      ]),
      custody('delete', [{ field: 'cancelReason', old: null, new: 'استلام بالخطأ' }], 'req-cancel'),
      shipmentRow(
        'update',
        [
          { field: 'status', old: 'inVault', new: 'draft' },
          { field: 'receiptNumber', old: 'R-77', new: null },
          { field: 'receiptCancelReason', old: null, new: 'استلام بالخطأ' },
        ],
        'req-cancel',
      ),
    ]);
    // ONE entry for the cancelled receipt — the custody's half is folded into the shipment's.
    expect(entries.map((e) => e.kind)).toEqual([
      'pickupConfirmed',
      'pickupUndone',
      'receiptCancelled',
    ]);
    // Who and when are the entry's own; only whose ✓ it is, as a code, is printed — never a user id.
    expect(entries[0]?.changes).toEqual([{ field: 'pickedUpBy', old: null, new: 'operations' }]);
    expect(entries[1]?.changes).toEqual([{ field: 'pickedUpBy', old: 'captain', new: null }]);
    expect(entries[2]?.changes).toEqual([{ field: 'reason', old: null, new: 'استلام بالخطأ' }]);
  });

  it('the captain’s ✓ in the app is ONE entry — his leg’s — not a second pickupConfirmed beside it', () => {
    const entries = build([
      row(
        SHIPMENT_LOG_ENTITY.leg,
        LEG,
        'update',
        [{ field: 'executionStatus', old: 'active', new: 'pickedUp' }],
        'req-app',
      ),
      shipmentRow(
        'update',
        [
          { field: 'pickedUpBy', old: null, new: 'captain' },
          { field: 'pickedUpAt', old: null, new: '2026-11-11T07:00:00.000Z' },
        ],
        'req-app',
      ),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(['executionPickedUp']);
    // Without its leg's row (another request) the record's entry stands on its own.
    const alone = build([
      shipmentRow('update', [{ field: 'pickedUpBy', old: null, new: 'captain' }], 'req-x'),
    ]);
    expect(alone).toMatchObject([
      { kind: 'pickupConfirmed', changes: [{ field: 'pickedUpBy', old: null, new: 'captain' }] },
    ]);
    // …and the DESK's ✓ is never folded, whatever shares its request.
    const desk = build([
      row(
        SHIPMENT_LOG_ENTITY.leg,
        LEG,
        'update',
        [{ field: 'executionStatus', old: 'active', new: 'pickedUp' }],
        'req-y',
      ),
      shipmentRow('update', [{ field: 'pickedUpBy', old: null, new: 'operations' }], 'req-y'),
    ]);
    expect(desk.map((e) => e.kind)).toEqual(['executionPickedUp', 'pickupConfirmed']);
  });

  it('a cancelled receipt without the vault grant still says why — the reason is the shipment’s', () => {
    const [cancelled] = build([
      shipmentRow('update', [
        { field: 'status', old: 'inVault', new: 'draft' },
        { field: 'receiptCancelReason', old: null, new: 'سبب' },
      ]),
    ]);
    expect(cancelled).toMatchObject({
      kind: 'receiptCancelled',
      changes: [{ field: 'reason', old: null, new: 'سبب' }],
    });
  });

  // Round 12 — «توزيع المحصنات»: a shipment taken off its van retires its delivery leg, and an
  // overdue one placed on a van of a later day moves its delivery date. Both are the shipment's
  // story, printed in names.
  it('prints a van taken off as `crewRemoved` — the captain and van it was on', () => {
    const delivery = oid(23);
    const [assigned, removed] = buildShipmentLogEntries(
      [
        row(SHIPMENT_LOG_ENTITY.leg, delivery, 'create', [
          { field: 'leg', old: null, new: 'delivery' },
          { field: 'captainEmployeeId', old: null, new: CAPTAIN_1 },
          { field: 'vehicleId', old: null, new: VAN_1 },
        ]),
        row(SHIPMENT_LOG_ENTITY.leg, delivery, 'delete', [
          { field: 'captainEmployeeId', old: CAPTAIN_1, new: null },
          { field: 'vehicleId', old: VAN_1, new: null },
          { field: 'crewAssignmentId', old: oid(600), new: null },
        ]),
      ],
      new Map([[delivery, 'delivery' as const]]),
      names,
    );
    expect(assigned).toMatchObject({ kind: 'crewAssigned', leg: 'delivery' });
    expect(removed).toMatchObject({
      kind: 'crewRemoved',
      leg: 'delivery',
      changes: [
        { field: 'captain', old: 'قائد أول', new: null },
        { field: 'vehicle', old: 'ك-12', new: null },
      ],
    });
  });

  it('prints an overdue day moved on distribution as `deliveryRescheduled`, the marker unprinted', () => {
    const [moved] = build([
      shipmentRow('update', [
        {
          field: 'deliveryDate',
          old: '2026-11-10T00:00:00.000Z',
          new: '2026-11-12T00:00:00.000Z',
        },
        { field: DISTRIBUTION_RESCHEDULE_MARKER, old: null, new: true },
      ]),
    ]);
    expect(moved).toMatchObject({
      kind: 'deliveryRescheduled',
      leg: null,
      changes: [{ field: 'deliveryDate', old: '2026-11-10', new: '2026-11-12' }],
    });
    // The same date moved by the edit form is an ordinary edit.
    const [edited] = build([
      shipmentRow('update', [
        {
          field: 'deliveryDate',
          old: '2026-11-10T00:00:00.000Z',
          new: '2026-11-12T00:00:00.000Z',
        },
      ]),
    ]);
    expect(edited?.kind).toBe('edited');
  });

  it('a value that no longer resolves is null — never the id in its place', () => {
    const [edited] = build([
      shipmentRow('update', [{ field: 'mainBankId', old: BANK_A, new: oid(777) }]),
    ]);
    expect(edited?.changes).toEqual([{ field: 'mainBank', old: 'الأهلي', new: null }]);
  });

  it('collects every id the values name, by kind, for one read each', () => {
    const refs = collectShipmentLogRefs([
      shipmentRow('update', [
        { field: 'mainBankId', old: BANK_A, new: BANK_B },
        { field: 'originBranchId', old: BRANCH_A, new: BRANCH_B },
        {
          field: 'lines',
          old: [{ currencyId: EGP, amountMinor: 1 }],
          new: [{ currencyId: USD, amountMinor: 2 }],
        },
        { field: 'receiptImage', old: null, new: oid(500) },
      ]),
      row(SHIPMENT_LOG_ENTITY.leg, LEG, 'create', [
        { field: 'captainEmployeeId', old: null, new: CAPTAIN_1 },
        { field: 'vehicleId', old: null, new: VAN_1 },
      ]),
      row(SHIPMENT_LOG_ENTITY.custody, CUSTODY, 'create', [
        { field: 'receivedByPrimaryId', old: null, new: TREASURER_1 },
      ]),
    ]);
    expect(refs.bankIds.sort()).toEqual([BANK_A, BANK_B].sort());
    expect(refs.branchIds.sort()).toEqual([BRANCH_A, BRANCH_B].sort());
    expect(refs.currencyIds.sort()).toEqual([EGP, USD].sort());
    expect(refs.employeeIds.sort()).toEqual([CAPTAIN_1, TREASURER_1].sort());
    expect(refs.vehicleIds).toEqual([VAN_1]);
  });
});
