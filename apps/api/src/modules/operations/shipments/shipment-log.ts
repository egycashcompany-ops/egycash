// The shipment's action log — «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة» — as a PURE mapping from
// audit rows to the entries the screen prints.
//
// The audit trail already holds every act: the shipment's own rows (create, edit, the desk's ✓ and
// its undo, the pickup record's ✓ and its undo, the receipt photo, delete, restore, a cancelled
// vault receipt), its legs' rows (`shipmentAssignment` — the crew, the route order, the captain's
// execution on the mobile app) and its vault custody's rows. What it
// does NOT hold is anything a person can read: ids, minor units, ISO instants. This file turns each
// row into one entry of a closed `kind`, with every value resolved to the name, code, day or
// amount the board itself would print — so the browser translates a kind and a field key, and
// never sees an id where a name exists.
//
// Kept apart from the service, and pure over (rows, names), so the mapping can be pinned row by
// row without a database; `operationsShipmentService.log` does the reads around it.
import {
  fromMinorUnits,
  ymdOf,
  type AuditLogDto,
  type OperationsShipmentLeg,
  type OperationsShipmentLogChangeDto,
  type OperationsShipmentLogEntryDto,
  type OperationsShipmentLogField,
  type OperationsShipmentLogKind,
} from '@ecms/contracts';

/** The audit entity types that record acts on one shipment (their `entityRef.entityType`). */
export const SHIPMENT_LOG_ENTITY = {
  shipment: 'shipment',
  leg: 'shipmentAssignment',
  custody: 'vaultCustody',
} as const;

/**
 * The field a shipment's audit row carries when «توزيع المحصنات» moved an overdue shipment's delivery
 * date to the distribution day (Round 12) — written by the distribution service, read here. Never
 * printed itself: the entry's kind (`deliveryRescheduled`) is what it means.
 */
export const DISTRIBUTION_RESCHEDULE_MARKER = 'rescheduledOnDistribution';

/** The names a trail's values resolve to — read once for the whole trail, by the service. */
export interface ShipmentLogNames {
  bank: (id: string) => string | null;
  branch: (id: string) => string | null;
  currency: (id: string) => string | null;
  person: (employeeId: string) => string | null;
  vehicle: (vehicleId: string) => string | null;
}

/** Every id a trail's values name, by what it names — so each kind is resolved in ONE read. */
export interface ShipmentLogRefs {
  bankIds: string[];
  branchIds: string[];
  currencyIds: string[];
  employeeIds: string[];
  vehicleIds: string[];
}

type Render = (value: unknown, names: ShipmentLogNames) => string | null;
type Ref = keyof ShipmentLogRefs;
interface FieldRule {
  field: OperationsShipmentLogField;
  render: Render;
  /** Which id list the raw value belongs to, when it is an id. */
  ref?: Ref;
}

const idOf = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** A stored text, number or flag as it reads; anything else (an object, nothing) is no value. */
const textOf = (value: unknown): string | null => {
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};
const plain: Render = (value) => textOf(value);

/** A date-only value → its 'YYYY-MM-DD' (the stored UTC day, never re-read in a zone). */
const day: Render = (value) => {
  if (typeof value !== 'string' || value === '') return null;
  try {
    return ymdOf(value);
  } catch {
    return null;
  }
};

const named =
  (pick: (names: ShipmentLogNames, id: string) => string | null): Render =>
  (value, names) => {
    const id = idOf(value);
    return id === null ? null : pick(names, id);
  };

/** Latin digits, grouped, up to two decimals — how the board prints an amount («1,500.5»). */
const amountFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** Separator for a list held in one value — the Arabic comma the screens already read. */
const LIST_SEPARATOR = '، ';

/** The money lines as «currency amount», in the order the shipment holds them. */
const lines: Render = (value, names) => {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value
    .map((line: unknown) => {
      const { currencyId, amountMinor } = (line ?? {}) as {
        currencyId?: unknown;
        amountMinor?: unknown;
      };
      const amount =
        typeof amountMinor === 'number' ? amountFormat.format(fromMinorUnits(amountMinor)) : '';
      const id = idOf(currencyId);
      const currency = id === null ? null : names.currency(id);
      return currency === null ? amount : `${currency} ${amount}`.trim();
    })
    .join(LIST_SEPARATOR);
};

/** A list of seal numbers in one value. */
const list: Render = (value) =>
  Array.isArray(value) && value.length > 0
    ? value.map((item) => textOf(item) ?? '').join(LIST_SEPARATOR)
    : null;

/** 'true' / 'false' — the screen says yes / no (`OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS`). */
const flag: Render = (value) => (typeof value === 'boolean' ? String(value) : null);

const bank = named((names, id) => names.bank(id));
const branch = named((names, id) => names.branch(id));
const person = named((names, id) => names.person(id));
const vehicle = named((names, id) => names.vehicle(id));

// What each entity's audit snapshot calls a field, and how the log prints it. A raw field not
// listed here (the type, the status, an internal id) is never printed as a change: the `kind`
// already says what the status move meant, and nothing else may leak a raw value.
const SHIPMENT_FIELDS: Readonly<Record<string, FieldRule>> = {
  mainBankId: { field: 'mainBank', render: bank, ref: 'bankIds' },
  secondaryBankId: { field: 'secondaryBank', render: bank, ref: 'bankIds' },
  originBranchId: { field: 'originBranch', render: branch, ref: 'branchIds' },
  destinationBranchId: { field: 'destinationBranch', render: branch, ref: 'branchIds' },
  areaName: { field: 'areaName', render: plain },
  lines: { field: 'lines', render: lines },
  collectionDate: { field: 'collectionDate', render: day },
  deliveryDate: { field: 'deliveryDate', render: day },
  serialTracked: { field: 'serialTracked', render: flag },
  notes: { field: 'notes', render: plain },
  // Round 10 — the reason typed when the vault's receipt was cancelled. Recorded on the SHIPMENT's
  // row (not only the custody's) so every reader of the log sees why, vault grant or not.
  receiptCancelReason: { field: 'reason', render: plain },
};

const LEG_CREW_FIELDS: Readonly<Record<string, FieldRule>> = {
  captainEmployeeId: { field: 'captain', render: person, ref: 'employeeIds' },
  vehicleId: { field: 'vehicle', render: vehicle, ref: 'vehicleIds' },
};

const LEG_ORDER_FIELDS: Readonly<Record<string, FieldRule>> = {
  sequence: { field: 'sequence', render: plain },
};

const CUSTODY_FIELDS: Readonly<Record<string, FieldRule>> = {
  receiptNumber: { field: 'receiptNumber', render: plain },
  bagCount: { field: 'bagCount', render: plain },
  cartonCount: { field: 'cartonCount', render: plain },
  boxCount: { field: 'boxCount', render: plain },
  bagSeals: { field: 'bagSeals', render: list },
  boxSeals: { field: 'boxSeals', render: list },
  receivedByPrimaryId: { field: 'receivedByPrimary', render: person, ref: 'employeeIds' },
  receivedBySecondaryId: { field: 'receivedBySecondary', render: person, ref: 'employeeIds' },
};

const RULES_BY_ENTITY: Readonly<Record<string, readonly Readonly<Record<string, FieldRule>>[]>> = {
  [SHIPMENT_LOG_ENTITY.shipment]: [SHIPMENT_FIELDS],
  [SHIPMENT_LOG_ENTITY.leg]: [LEG_CREW_FIELDS, LEG_ORDER_FIELDS],
  [SHIPMENT_LOG_ENTITY.custody]: [CUSTODY_FIELDS],
};

/** Every id the trail's printable values name — the reads the service makes, one per kind. */
export const collectShipmentLogRefs = (rows: readonly AuditLogDto[]): ShipmentLogRefs => {
  const found: Record<Ref, Set<string>> = {
    bankIds: new Set(),
    branchIds: new Set(),
    currencyIds: new Set(),
    employeeIds: new Set(),
    vehicleIds: new Set(),
  };
  for (const row of rows) {
    const tables = RULES_BY_ENTITY[row.entityRef.entityType] ?? [];
    for (const change of row.changes) {
      for (const value of [change.old, change.new]) {
        if (row.entityRef.entityType === SHIPMENT_LOG_ENTITY.shipment && change.field === 'lines') {
          if (!Array.isArray(value)) continue;
          for (const line of value as { currencyId?: unknown }[]) {
            const id = idOf(line?.currencyId);
            if (id !== null) found.currencyIds.add(id);
          }
          continue;
        }
        const ref = tables
          .map((table) => table[change.field])
          .find((rule) => rule !== undefined)?.ref;
        const id = idOf(value);
        if (ref !== undefined && id !== null) found[ref].add(id);
      }
    }
  }
  return {
    bankIds: [...found.bankIds],
    branchIds: [...found.branchIds],
    currencyIds: [...found.currencyIds],
    employeeIds: [...found.employeeIds],
    vehicleIds: [...found.vehicleIds],
  };
};

/** The row's changes that `rules` knows, printed — in the order the row recorded them. */
const printed = (
  row: AuditLogDto,
  rules: Readonly<Record<string, FieldRule>>,
  names: ShipmentLogNames,
): OperationsShipmentLogChangeDto[] =>
  row.changes.flatMap((change) => {
    const rule = rules[change.field];
    if (rule === undefined) return [];
    return [
      {
        field: rule.field,
        old: rule.render(change.old, names),
        new: rule.render(change.new, names),
      },
    ];
  });

const changeOf = (row: AuditLogDto, field: string) =>
  row.changes.find((change) => change.field === field);

/** A pickup record's `by` as the code the screen labels — anything else is no value. */
const pickedUpBy = (value: unknown): string | null =>
  value === 'captain' || value === 'operations' ? value : null;

/**
 * What a move of the shipment's STATUS meant. Only five moves exist (shipment-status.ts, the vault
 * flow and Round 10's cancelled receipt), and each is its own act on the screen — the desk's ✓ is
 * not an edit, and neither is the vault's receipt being undone.
 */
const statusKind = (from: unknown, to: unknown): OperationsShipmentLogKind => {
  if (to === 'completed') return 'received';
  if (from === 'completed') return 'receiveUndone';
  if (from === 'inVault' && to === 'draft') return 'receiptCancelled';
  if (to === 'inVault') return 'vaultReceived';
  if (to === 'dispatched') return 'dispatched';
  return 'other';
};

/** The captain's execution step a leg's move reached (mobile/execution-state.ts). */
const EXECUTION_KIND: Readonly<Record<string, OperationsShipmentLogKind>> = {
  active: 'executionStarted',
  pickedUp: 'executionPickedUp',
  delivered: 'executionDelivered',
  completed: 'executionCompleted',
};

interface Drafted {
  kind: OperationsShipmentLogKind;
  changes: OperationsShipmentLogChangeDto[];
}

/** One shipment row → its entry; null for a row that recorded nothing (an edit that changed nothing). */
const shipmentEntry = (row: AuditLogDto, names: ShipmentLogNames): Drafted | null => {
  switch (row.action) {
    case 'create':
      return { kind: 'created', changes: printed(row, SHIPMENT_FIELDS, names) };
    case 'delete':
      return { kind: 'deleted', changes: [] };
    case 'restore':
      return { kind: 'restored', changes: [] };
    case 'update': {
      if (row.changes.length === 0) return null;
      const status = changeOf(row, 'status');
      if (status !== undefined) {
        return {
          kind: statusKind(status.old, status.new),
          changes: printed(row, SHIPMENT_FIELDS, names),
        };
      }
      // The photo's link is a file id: the act is printed, the id never is.
      const image = changeOf(row, 'receiptImage');
      if (image !== undefined) {
        const kind: OperationsShipmentLogKind =
          image.new == null
            ? 'receiptImageRemoved'
            : image.old == null
              ? 'receiptImageAdded'
              : 'receiptImageReplaced';
        return { kind, changes: [] };
      }
      // Round 12 — «توزيع المحصنات» placed an OVERDUE shipment in the vault on a van of a later day,
      // and its delivery date moved with it: the one change a received محصنة takes, because it is a
      // flow act. The marker says so; only the date is printed (the kind is the explanation).
      if (changeOf(row, DISTRIBUTION_RESCHEDULE_MARKER) !== undefined) {
        return {
          kind: 'deliveryRescheduled',
          changes: printed(row, SHIPMENT_FIELDS, names),
        };
      }
      // Round 10 — the pickup record written («تم الاستلام من العمليات», or the captain's ✓ from
      // the app) or cleared by the desk's undo. Only WHO is printed — on the ✓ who confirmed it, on
      // the undo whose ✓ was removed; the instant and the user are the entry's own time and actor.
      const pickup = changeOf(row, 'pickedUpBy');
      if (pickup !== undefined) {
        return pickup.new == null
          ? {
              kind: 'pickupUndone',
              changes: [{ field: 'pickedUpBy', old: pickedUpBy(pickup.old), new: null }],
            }
          : {
              kind: 'pickupConfirmed',
              changes: [{ field: 'pickedUpBy', old: null, new: pickedUpBy(pickup.new) }],
            };
      }
      return { kind: 'edited', changes: printed(row, SHIPMENT_FIELDS, names) };
    }
    default:
      return { kind: 'other', changes: printed(row, SHIPMENT_FIELDS, names) };
  }
};

/** One leg row → its entry. The leg's own audit rows are the crew, the order and the execution. */
const legEntry = (row: AuditLogDto, names: ShipmentLogNames): Drafted | null => {
  if (row.action === 'create') {
    return { kind: 'crewAssigned', changes: printed(row, LEG_CREW_FIELDS, names) };
  }
  // Round 12 — the leg RETIRED: «توزيع المحصنات» took the shipment off its van, or an edit moved its
  // delivery date off its van's day (that edit's own entry comes just before this one). The row
  // carries the captain and van it was on (old → null), which is what the entry prints.
  if (row.action === 'delete') {
    return { kind: 'crewRemoved', changes: printed(row, LEG_CREW_FIELDS, names) };
  }
  if (row.action !== 'update') return { kind: 'other', changes: [] };
  if (row.changes.length === 0) return null;
  const execution = changeOf(row, 'executionStatus');
  if (execution !== undefined) {
    const to = typeof execution.new === 'string' ? execution.new : '';
    return { kind: EXECUTION_KIND[to] ?? 'other', changes: [] };
  }
  // A new captain or van is a crew change, whatever else moved with it — a change of captain
  // re-seats the leg at the end of the new captain's route, and that is a consequence, not news.
  if (['captainEmployeeId', 'vehicleId', 'crewAssignmentId'].some((f) => changeOf(row, f))) {
    return { kind: 'crewChanged', changes: printed(row, LEG_CREW_FIELDS, names) };
  }
  if (changeOf(row, 'sequence') !== undefined) {
    return { kind: 'reordered', changes: printed(row, LEG_ORDER_FIELDS, names) };
  }
  return { kind: 'other', changes: [] };
};

/** One custody row → its entry: into the vault (with the receipt), out of it, or its receipt undone. */
const custodyEntry = (row: AuditLogDto, names: ShipmentLogNames): Drafted | null => {
  if (row.action === 'create') {
    return { kind: 'vaultReceived', changes: printed(row, CUSTODY_FIELDS, names) };
  }
  // Round 10 — a cancelled receipt voids the custody (audited as its delete). The reason is printed
  // from the SHIPMENT's row of the same request, which this entry is folded into.
  if (row.action === 'delete') return { kind: 'receiptCancelled', changes: [] };
  if (row.action === 'update') {
    if (row.changes.length === 0) return null;
    // Released is the custody half of the dispatch. `releasedById` is the actor of the entry, who
    // is already named, so it is not printed again.
    if (changeOf(row, 'state')?.new === 'released') return { kind: 'dispatched', changes: [] };
  }
  return { kind: 'other', changes: [] };
};

const actorNameOf = (row: AuditLogDto): string | null => {
  const name = row.actorSnapshot?.displayName;
  if (name === undefined) return null;
  return name.ar !== '' ? name.ar : name.en !== '' ? name.en : null;
};

/**
 * The log's entries, oldest first, from the rows `auditService.trailOf` read (oldest first).
 *
 * ONE ACT, ONE ENTRY. Receiving a secured shipment into the vault writes two rows in one request —
 * the custody taken, then the shipment's status — and so do dispatching it and cancelling its
 * receipt (Round 10). Shown as two, the same act would appear twice. So a custody row is folded
 * into the shipment's entry of the SAME kind written by the SAME request (`requestId`): the entry
 * keeps the shipment row's id and time and gains the custody's details. A custody row with no
 * such partner stands on its own. The captain's pickup ✓ in the app (Round 10) is the same story
 * the other way round: the shipment's pickup record is folded into his leg's entry.
 */
export const buildShipmentLogEntries = (
  rows: readonly AuditLogDto[],
  legOf: ReadonlyMap<string, OperationsShipmentLeg>,
  names: ShipmentLogNames,
): OperationsShipmentLogEntryDto[] => {
  const drafted: { row: AuditLogDto; entry: OperationsShipmentLogEntryDto }[] = [];
  for (const row of rows) {
    const type = row.entityRef.entityType;
    const draft =
      type === SHIPMENT_LOG_ENTITY.shipment
        ? shipmentEntry(row, names)
        : type === SHIPMENT_LOG_ENTITY.leg
          ? legEntry(row, names)
          : type === SHIPMENT_LOG_ENTITY.custody
            ? custodyEntry(row, names)
            : null;
    if (draft === null) continue;
    const legChange = changeOf(row, 'leg')?.new;
    const leg =
      type === SHIPMENT_LOG_ENTITY.leg
        ? (legOf.get(row.entityRef.entityId) ??
          (legChange === 'pickup' || legChange === 'delivery' ? legChange : null))
        : null;
    drafted.push({
      row,
      entry: {
        id: row.id,
        at: row.at,
        actorName: actorNameOf(row),
        kind: draft.kind,
        leg,
        changes: draft.changes,
      },
    });
  }

  const folded = new Set<OperationsShipmentLogEntryDto>();
  // Round 10 — the captain's ✓ in the app is ONE act that writes two rows in one request: his leg
  // moves to `pickedUp` and the shipment's pickup record is written as his. The leg's
  // `executionPickedUp` entry already says it (with the leg), so the record's `pickupConfirmed` by
  // 'captain' is folded into it rather than shown twice. Without such a partner it stands alone.
  for (const { row, entry } of drafted) {
    if (
      entry.kind !== 'pickupConfirmed' ||
      row.requestId === null ||
      entry.changes[0]?.new !== 'captain'
    ) {
      continue;
    }
    const partner = drafted.some(
      (other) =>
        other.row.entityRef.entityType === SHIPMENT_LOG_ENTITY.leg &&
        other.row.requestId === row.requestId &&
        other.entry.kind === 'executionPickedUp',
    );
    if (partner) folded.add(entry);
  }
  for (const { row, entry } of drafted) {
    if (row.entityRef.entityType !== SHIPMENT_LOG_ENTITY.custody || row.requestId === null)
      continue;
    const partner = drafted.find(
      (other) =>
        other.row.entityRef.entityType === SHIPMENT_LOG_ENTITY.shipment &&
        other.row.requestId === row.requestId &&
        other.entry.kind === entry.kind,
    );
    if (partner === undefined) continue;
    partner.entry.changes = [...entry.changes, ...partner.entry.changes];
    folded.add(entry);
  }
  return drafted.map(({ entry }) => entry).filter((entry) => !folded.has(entry));
};
