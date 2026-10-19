// «المذكرات» — the custody memos: list, figures, the receipts no memo holds yet, the editor's
// candidates, and create / edit / soft-delete. Audited like every Fleet record.
//
// A memo's receipts are claimed and freed IN THE MEMO'S TRANSACTION, by a conditional write on the
// receipts themselves (`memoId: null` → this memo): two memos reaching for one receipt at the same
// moment conflict on that receipt, and the one retried finds it taken. Its money is never stored —
// totals are read live from its receipts (`custody-memo-totals.ts`).
//
// Nothing beyond the arithmetic is required: a kind and one receipt. The name is free text shown
// in the app only; the dates default to the receipts' own days.
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  FLEET_CUSTODY_MEMO_MAX_LINES,
  FLEET_CUSTODY_SOURCES,
  parseFleetSort,
  type ApiErrorDetail,
  type CreateFleetCustodyMemo,
  type FleetCustodyMemoCandidateDto,
  type FleetCustodyMemoCandidatesDto,
  type FleetCustodyMemoCandidatesQuery,
  type FleetCustodyMemoDto,
  type FleetCustodyMemoLine,
  type FleetCustodyMemoLineDto,
  type FleetCustodyMemoRowDto,
  type FleetCustodyMemoSummaryQuery,
  type FleetCustodyMemoTotalsDto,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySource,
  type ListFleetCustodyMemosQuery,
  type Paginated,
  type UpdateFleetCustodyMemo,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  StaleDocumentError,
  ValidationError,
} from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { FleetReceiptModel, type FleetReceiptDoc } from '../receipts/receipt.model';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import {
  CUSTODY_MEMO_COUNTER,
  ensureCustodyCounter,
  nextCustodyNumber,
  peekCustodyNumber,
} from './custody-counter.model';
import {
  FleetCustodyMemoModel,
  type FleetCustodyMemoDoc,
  type FleetCustodyMemoLineDoc,
} from './custody-memo.model';
import { assertCustodyMemoWritable, fleetCustodyMemoRepository } from './custody-memo.repository';
import { dayAfter, dayKey, lineChanges, orderLines, periodOf, utcDay } from './custody-memo-rules';
import { readMemoTotals, sumMemoTotals, type CustodyMemoTotals } from './custody-memo-totals';
import { missionOptions, suggestMissions } from './custody-mission';
import { fleetCustodyPapersService } from './custody-papers.service';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'custodyMemo', entityId: id });

/**
 * The memos' counter, raised to the highest number already used (deleted memos included) — never
 * lowered. Run by the seed once the indexes exist, and before every create, OUTSIDE the create's
 * transaction, so that transaction only ever `$inc`s an existing document.
 */
export const ensureCustodyMemoCounter = async (): Promise<void> => {
  await ensureCustodyCounter(CUSTODY_MEMO_COUNTER, await fleetCustodyMemoRepository.maxNo());
};

const stringOrNull = (value: Types.ObjectId | null | undefined): string | null =>
  value == null ? null : String(value);
const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);
const ZERO: CustodyMemoTotals = { receipts: 0, total: 0 };

/** A memo row as the list shows it — its money from `totals`, never stored. */
export const toCustodyMemoRowDto = (
  doc: FleetCustodyMemoDoc,
  totals: CustodyMemoTotals = ZERO,
): FleetCustodyMemoRowDto => ({
  id: String(doc._id),
  no: doc.no,
  kind: doc.kind,
  name: doc.name ?? '',
  date: dayKey(doc.date),
  from: dayKey(doc.from),
  to: dayKey(doc.to),
  receipts: totals.receipts,
  total: totals.total,
  replenishment:
    doc.replenishmentId == null
      ? null
      : {
          id: String(doc.replenishmentId),
          date: dayKey(doc.replenishedAt ?? doc.updatedAt),
        },
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

const snapshot = (doc: FleetCustodyMemoDoc) => ({
  no: doc.no,
  kind: doc.kind,
  name: doc.name ?? '',
  date: dayKey(doc.date),
  from: dayKey(doc.from),
  to: dayKey(doc.to),
  receiptIds: doc.lines.map((line) => String(line.receiptId)),
  // Only the typed cells — a line with none is fully described by its receipt id above.
  cells: doc.lines
    .filter((line) => line.mission !== '' || line.statement !== '' || line.note !== '')
    .map((line) => ({
      receiptId: String(line.receiptId),
      mission: line.mission,
      statement: line.statement,
      note: line.note,
    })),
  replenishmentId: stringOrNull(doc.replenishmentId),
});

/** «المذكرات»'s filters as one database filter — the list's and its figures' alike. */
const memoFilter = (query: FleetCustodyMemoSummaryQuery): FilterQuery<FleetCustodyMemoDoc> => {
  const clauses: FilterQuery<FleetCustodyMemoDoc>[] = [];
  if (query.kind !== undefined) clauses.push({ kind: { $in: [...query.kind] } });
  if (query.status === 'pending') clauses.push({ replenishmentId: null });
  if (query.status === 'replenished') clauses.push({ replenishmentId: { $ne: null } });
  // The period OVERLAPS the filter's: it ends on or after `from`, and starts by the end of `to`.
  if (query.from !== undefined) clauses.push({ to: { $gte: utcDay(query.from) } });
  if (query.to !== undefined) clauses.push({ from: { $lt: dayAfter(query.to) } });
  return clauses.length === 0 ? {} : { $and: clauses };
};

type ReceiptRow = Pick<
  FleetReceiptDoc,
  | '_id'
  | 'date'
  | 'vehicleId'
  | 'driverEmployeeId'
  | 'driverName'
  | 'kind'
  | 'source'
  | 'amount'
  | 'fuelType'
  | 'litres'
  | 'company'
  | 'memoId'
  | 'isDeleted'
  | 'createdAt'
>;
const RECEIPT_FIELDS = {
  date: 1,
  vehicleId: 1,
  driverEmployeeId: 1,
  driverName: 1,
  kind: 1,
  source: 1,
  amount: 1,
  fuelType: 1,
  litres: 1,
  company: 1,
  memoId: 1,
  isDeleted: 1,
  createdAt: 1,
} as const;

const byDayThenEntry = (a: ReceiptRow, b: ReceiptRow): number =>
  utcDay(a.date).getTime() - utcDay(b.date).getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (String(a._id) < String(b._id) ? -1 : 1);

class FleetCustodyMemoService {
  // ── Reading ───────────────────────────────────────────────────────────────

  async list(query: ListFleetCustodyMemosQuery): Promise<Paginated<FleetCustodyMemoRowDto>> {
    const page = await fleetCustodyMemoRepository.listMemos({
      filter: memoFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'no',
      sortDir: query.sortBy === undefined ? 'desc' : query.sortDir,
      sorts: parseFleetSort(query.sort),
    });
    const totals = await readMemoTotals(page.items);
    return {
      ...page,
      items: page.items.map((doc) => toCustodyMemoRowDto(doc, totals.get(String(doc._id)))),
    };
  }

  /** «الإحصائيات» — over every memo the filters match, never the page on screen. */
  async summary(query: FleetCustodyMemoSummaryQuery): Promise<FleetCustodyMemoTotalsDto> {
    const memos = await FleetCustodyMemoModel.find({
      $and: [{ isDeleted: false }, memoFilter(query)],
    })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    const sum = sumMemoTotals((await readMemoTotals(memos)).values());
    return { count: memos.length, receipts: sum.receipts, total: sum.total };
  }

  /**
   * «إيصالات لم تدخل أي مذكرة بعد» — the live custody receipts no memo holds, per kind: always the
   * four kinds, in `FLEET_CUSTODY_SOURCES` order, zeros kept. A receipt written before memos
   * existed has no `memoId` at all, which `memoId: null` matches — it counts as outside.
   */
  async outside(): Promise<FleetCustodyOutsideKindDto[]> {
    const rows = await FleetReceiptModel.aggregate<{
      _id: FleetCustodySource;
      count: number;
      piastres: number;
    }>([
      { $match: { isDeleted: false, source: 'custody', memoId: null } },
      {
        $group: {
          _id: '$kind',
          count: { $sum: 1 },
          piastres: { $sum: { $round: [{ $multiply: ['$amount', 100] }, 0] } },
        },
      },
    ]).exec();
    const byKind = new Map(rows.map((row) => [row._id, row]));
    return FLEET_CUSTODY_SOURCES.map((kind) => ({
      kind,
      count: byKind.get(kind)?.count ?? 0,
      total: Math.round(byKind.get(kind)?.piastres ?? 0) / 100,
    }));
  }

  async get(id: string): Promise<FleetCustodyMemoDto> {
    return this.toDto(await fleetCustodyMemoRepository.getById(id));
  }

  /** The memo with its lines — each receipt's facts read live, in paper order. */
  async toDto(doc: FleetCustodyMemoDoc): Promise<FleetCustodyMemoDto> {
    const receipts = await FleetReceiptModel.find({
      _id: { $in: doc.lines.map((line) => line.receiptId) },
      isDeleted: false,
    })
      .select(RECEIPT_FIELDS)
      .lean<ReceiptRow[]>()
      .exec();
    const byId = new Map(receipts.map((row) => [String(row._id), row]));
    const codes = await fleetVehicleRepository.codesByIds([
      ...new Set(receipts.map((row) => String(row.vehicleId))),
    ]);
    const totals = (await readMemoTotals([doc])).get(String(doc._id));
    const lines = orderLines(
      doc.lines
        .map((line) => ({ ...line, receiptId: String(line.receiptId) }))
        .filter((line) => byId.has(line.receiptId)),
      byId,
    ).map((line): FleetCustodyMemoLineDto => {
      const row = byId.get(line.receiptId) as ReceiptRow;
      return {
        receiptId: line.receiptId,
        date: dayKey(row.date),
        vehicleId: String(row.vehicleId),
        vehicleCode: codes.get(String(row.vehicleId)) ?? null,
        driverEmployeeId: stringOrNull(row.driverEmployeeId),
        driverName: row.driverName ?? null,
        amount: row.amount,
        fuelType: row.fuelType ?? null,
        litres: row.litres ?? null,
        mission: line.mission ?? '',
        statement: line.statement ?? '',
        note: line.note ?? '',
      };
    });
    return {
      ...toCustodyMemoRowDto(doc, totals),
      lines,
      signatures: structuredClone({
        blocks: (doc.signatures?.blocks ?? []).map((block) => ({
          role: block.role,
          office: block.office ?? '',
          name: block.name ?? '',
          on: block.on,
        })),
        note: doc.signatures?.note ?? '',
      }),
    };
  }

  /**
   * The editor's receipts: the live custody receipts of `kind` that no memo holds, oldest first —
   * and, on an edit, the memo's own (`inThisMemo`), always all of them. At most
   * `FLEET_CUSTODY_MEMO_MAX_LINES` in all; `truncated` says more were waiting.
   */
  async candidates(query: FleetCustodyMemoCandidatesQuery): Promise<FleetCustodyMemoCandidatesDto> {
    const cap = FLEET_CUSTODY_MEMO_MAX_LINES;
    const base = { isDeleted: false, source: 'custody', kind: query.kind };
    const own =
      query.memoId === undefined
        ? []
        : await FleetReceiptModel.find({ ...base, memoId: oid(query.memoId) })
            .select(RECEIPT_FIELDS)
            .sort({ date: 1, createdAt: 1, _id: 1 })
            .limit(cap)
            .lean<ReceiptRow[]>()
            .exec();
    const room = cap - own.length;
    const waiting = await FleetReceiptModel.find({ ...base, memoId: null })
      .select(RECEIPT_FIELDS)
      .sort({ date: 1, createdAt: 1, _id: 1 })
      .limit(room + 1)
      .lean<ReceiptRow[]>()
      .exec();
    const truncated = waiting.length > room;
    const rows = [...own, ...waiting.slice(0, Math.max(0, room))].sort(byDayThenEntry);

    const [codes, missions, options, nextNo] = await Promise.all([
      fleetVehicleRepository.codesByIds([...new Set(rows.map((row) => String(row.vehicleId)))]),
      query.kind === 'fuel' ? suggestMissions(rows) : Promise.resolve(new Map<string, null>()),
      query.kind === 'fuel' ? missionOptions() : Promise.resolve([] as string[]),
      this.nextNumber(),
    ]);
    const ownIds = new Set(own.map((row) => String(row._id)));
    return {
      nextNo,
      receipts: rows.map((row): FleetCustodyMemoCandidateDto => ({
        id: String(row._id),
        date: dayKey(row.date),
        vehicleId: String(row.vehicleId),
        vehicleCode: codes.get(String(row.vehicleId)) ?? null,
        driverEmployeeId: stringOrNull(row.driverEmployeeId),
        driverName: row.driverName ?? null,
        amount: row.amount,
        fuelType: row.fuelType ?? null,
        litres: row.litres ?? null,
        company: row.company ?? null,
        suggestedMission: query.kind === 'fuel' ? (missions.get(String(row._id)) ?? null) : null,
        inThisMemo: ownIds.has(String(row._id)),
      })),
      missionOptions: options,
      truncated,
    };
  }

  /** «رقم N» before saving — a preview: somebody may save first. */
  async nextNumber(): Promise<number> {
    return peekCustodyNumber(CUSTODY_MEMO_COUNTER, await fleetCustodyMemoRepository.maxNo());
  }

  // ── For «استعاضة عهدة» (custody-fund.service.ts) ──────────────────────────

  /** The live memos not replenished yet, oldest `no` first, with their live totals. */
  async pendingRows(): Promise<FleetCustodyMemoRowDto[]> {
    const docs = await FleetCustodyMemoModel.find({ isDeleted: false, replenishmentId: null })
      .sort({ no: 1 })
      .lean<FleetCustodyMemoDoc[]>()
      .exec();
    const totals = await readMemoTotals(docs);
    return docs.map((doc) => toCustodyMemoRowDto(doc, totals.get(String(doc._id))));
  }

  /** How many live memos there are, how many wait for a «استعاضة», and what those add up to. */
  async counts(): Promise<{ count: number; pending: number; pendingTotal: number }> {
    const docs = await FleetCustodyMemoModel.find({ isDeleted: false })
      .select({ _id: 1, replenishmentId: 1 })
      .lean<{ _id: Types.ObjectId; replenishmentId?: Types.ObjectId | null }[]>()
      .exec();
    const pending = docs.filter((doc) => doc.replenishmentId == null);
    const sum = sumMemoTotals((await readMemoTotals(pending)).values());
    return { count: docs.length, pending: pending.length, pendingTotal: sum.total };
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  /**
   * Claim receipts for `memoId` — only live custody receipts of the memo's kind that no memo holds.
   * Anything short of all of them aborts the caller's transaction with the reason, line by line.
   */
  private async claim(
    memoId: Types.ObjectId,
    kind: FleetCustodySource,
    wanted: readonly { receiptId: string; index: number }[],
    session: ClientSession,
  ): Promise<void> {
    if (wanted.length === 0) return;
    const ids = wanted.map((entry) => oid(entry.receiptId));
    const result = await FleetReceiptModel.updateMany(
      { _id: { $in: ids }, isDeleted: false, source: 'custody', kind, memoId: null },
      { $set: { memoId } },
      // Not a receipt edit: neither its `updatedAt` nor its `__v` moves, so a receipt dialog open
      // elsewhere does not go stale because a memo picked the receipt up.
      { session, timestamps: false },
    ).exec();
    if (result.modifiedCount === wanted.length) return;

    const rows = await FleetReceiptModel.find({ _id: { $in: ids } })
      .select({ isDeleted: 1, source: 1, kind: 1, memoId: 1 })
      .session(session)
      .lean<Pick<FleetReceiptDoc, '_id' | 'isDeleted' | 'source' | 'kind' | 'memoId'>[]>()
      .exec();
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    const invalid: ApiErrorDetail[] = [];
    const held: { receiptId: string; memoId: string }[] = [];
    for (const entry of wanted) {
      const row = byId.get(entry.receiptId.toLowerCase());
      const field = `body.lines.${entry.index}.receiptId`;
      if (row === undefined || row.isDeleted) {
        invalid.push({ field, code: 'INVALID', message: 'unknown or deleted receipt' });
      } else if (row.source !== 'custody') {
        invalid.push({
          field,
          code: 'INVALID',
          message: 'a receipt paid with a fuel card is not the custody fund’s — it goes on no memo',
        });
      } else if (row.kind !== kind) {
        invalid.push({
          field,
          code: 'INVALID',
          message: `a ${row.kind} receipt cannot go on a ${kind} memo`,
        });
      } else if (row.memoId != null && !row.memoId.equals(memoId)) {
        held.push({ receiptId: entry.receiptId, memoId: String(row.memoId) });
      }
    }
    if (invalid.length > 0) throw new ValidationError(invalid);
    if (held.length > 0) {
      const numbers = await fleetCustodyMemoRepository.numbersByIds(held.map((h) => h.memoId));
      const first = held[0] as { receiptId: string; memoId: string };
      throw new ConflictError(
        `receipt ${first.receiptId} is already on custody memo ${numbers.get(first.memoId) ?? '?'}` +
          (held.length > 1 ? ` (and ${held.length - 1} more are on other memos)` : ''),
      );
    }
  }

  /** The lines as stored — in paper order — and the period their receipts span. */
  private async placeLines(
    lines: readonly FleetCustodyMemoLine[],
    session: ClientSession,
  ): Promise<{ lines: FleetCustodyMemoLineDoc[]; period: { from: Date; to: Date } | null }> {
    const receipts = await FleetReceiptModel.find({
      _id: { $in: lines.map((line) => oid(line.receiptId)) },
    })
      .select({ date: 1, createdAt: 1 })
      .session(session)
      .lean<Pick<FleetReceiptDoc, '_id' | 'date' | 'createdAt'>[]>()
      .exec();
    const byId = new Map(receipts.map((row) => [String(row._id), row]));
    const ordered = orderLines(
      lines.map((line) => ({ ...line, receiptId: line.receiptId.toLowerCase() })),
      byId,
    );
    return {
      lines: ordered.map((line) => ({
        receiptId: oid(line.receiptId),
        mission: line.mission,
        statement: line.statement,
        note: line.note,
      })),
      period: periodOf(receipts.map((row) => row.date)),
    };
  }

  /**
   * The period to store: what was typed, else the receipts' first and last day. A typed end that
   * the receipts' other end would cross is met by it, so `from` never lands after `to`.
   */
  private periodFor(
    input: { from?: Date | null | undefined; to?: Date | null | undefined },
    period: { from: Date; to: Date } | null,
    fallback: Date,
  ): { from: Date; to: Date } {
    let from = input.from != null ? utcDay(input.from) : (period?.from ?? utcDay(fallback));
    let to = input.to != null ? utcDay(input.to) : (period?.to ?? utcDay(fallback));
    if (from.getTime() > to.getTime()) {
      if (input.to == null) to = from;
      else from = to;
    }
    return { from, to };
  }

  async create(input: CreateFleetCustodyMemo, by: string): Promise<FleetCustodyMemoDto> {
    await ensureCustodyMemoCounter();
    // The paper it prints with, taken now and never refreshed.
    const signatures = await fleetCustodyPapersService.signaturesFor(input.kind);
    const memoId = new Types.ObjectId();
    const date = utcDay(input.date ?? new Date());
    const created = await unitOfWork(async (session) => {
      const no = await nextCustodyNumber(CUSTODY_MEMO_COUNTER, session);
      await this.claim(
        memoId,
        input.kind,
        input.lines.map((line, index) => ({ receiptId: line.receiptId, index })),
        session,
      );
      const placed = await this.placeLines(input.lines, session);
      const { from, to } = this.periodFor(input, placed.period, date);
      return fleetCustodyMemoRepository.create(
        {
          _id: memoId,
          no,
          kind: input.kind,
          name: input.name,
          date,
          from,
          to,
          lines: placed.lines,
          signatures,
          replenishmentId: null,
          replenishedAt: null,
        },
        { by, session },
      );
    });
    await auditService.record({
      entityRef: entityRef(String(created._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(created)),
    });
    return this.get(String(created._id));
  }

  /**
   * The whole memo again. Its kind stays (422 on a change); `date` absent keeps the stored day;
   * `from` / `to` absent or null are worked out from the lines again. The signatures stay the ones
   * it was made with. A replenished memo is frozen (422).
   */
  async update(
    id: string,
    input: UpdateFleetCustodyMemo,
    by: string,
  ): Promise<FleetCustodyMemoDto> {
    const seen: { before?: FleetCustodyMemoDoc } = {};
    const updated = await unitOfWork(async (session) => {
      const current = await fleetCustodyMemoRepository.findLive(id, session);
      if (current === null) throw new NotFoundError();
      seen.before = current;
      assertCustodyMemoWritable(current);
      if (input.kind !== current.kind) {
        throw new BusinessRuleError(
          `custody memo ${current.no} is a ${current.kind} memo — a memo keeps its kind`,
        );
      }
      if (input.version !== current.__v) throw new StaleDocumentError();

      const { release, take } = lineChanges(
        current.lines.map((line) => String(line.receiptId)),
        input.lines.map((line) => line.receiptId),
      );
      if (release.length > 0) {
        await FleetReceiptModel.updateMany(
          { _id: { $in: release.map(oid) }, memoId: current._id },
          { $set: { memoId: null } },
          { session, timestamps: false },
        ).exec();
      }
      const indexOf = new Map(input.lines.map((line, i) => [line.receiptId.toLowerCase(), i]));
      await this.claim(
        current._id,
        current.kind,
        take.map((receiptId) => ({ receiptId, index: indexOf.get(receiptId.toLowerCase()) ?? 0 })),
        session,
      );
      const placed = await this.placeLines(input.lines, session);
      const { from, to } = this.periodFor(input, placed.period, input.date ?? current.date);
      return fleetCustodyMemoRepository.updateById(
        id,
        {
          name: input.name,
          lines: placed.lines,
          from,
          to,
          // Never `$set` an undefined: an absent date keeps the stored one.
          ...(input.date === undefined ? {} : { date: utcDay(input.date) }),
        },
        { by, version: input.version, session },
      );
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(
        seen.before === undefined ? {} : snapshot(seen.before),
        snapshot(updated),
      ),
    });
    return this.get(id);
  }

  /**
   * Soft delete: the row stays (`isDeleted`, `deletedBy`), its receipts go back to «لم تدخل أي مذكرة
   * بعد», and its number is never handed out again. A replenished memo stays (422).
   */
  async remove(id: string, by: string): Promise<void> {
    const before = await fleetCustodyMemoRepository.getById(id);
    await unitOfWork(async (session) => {
      await fleetCustodyMemoRepository.softDeleteById(id, { by, session });
      await FleetReceiptModel.updateMany(
        { memoId: oid(id) },
        { $set: { memoId: null } },
        { session, timestamps: false },
      ).exec();
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges(snapshot(before), {}),
    });
  }
}

export const fleetCustodyMemoService = new FleetCustodyMemoService();
