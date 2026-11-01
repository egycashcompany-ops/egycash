// The custody fund's three letters and its ledger: «شحن العهدة» charges the fund, «استعاضة عهدة»
// brings a set of memos back into it, «تسوية عهدة» takes the licensing memos out of it; «سجل
// العهدة» folds all of it with the receipts the fund paid.
//
// EVERY OPERATION IS ONE TRANSACTION, and each begins by writing the fund's lock document
// (`fleet_custody_counters`, key `custodyFund`). Each operation snapshots the fund it found —
// `fundBefore`, `chargedTotal`, the letter's bracket figure — and those are printed and never
// refreshed, so two operations recorded at the same moment must not both read the same fund: the
// second to write the lock meets a write conflict, which is transient, and `unitOfWork` runs it
// again on a snapshot that includes the first.
//
// What each one claims, it claims inside the same transaction with a conditional write whose
// count is checked: a memo replenished once (`markReplenished`), a licensing memo settled once
// (`markSettled`). Anything short aborts everything — no operation, no memo marked, no record
// settled.
//
// A «استعاضة» is recorded HELD: its letter is printed and its memos are taken, but its money is not
// in the fund until «تأكيد التحويل» names the day it arrived — or it is cancelled and its memos are
// free again (`custody-fund-hold.ts`, under the same lock).
import { Types, type ClientSession } from 'mongoose';
import {
  FLEET_LICENSE_EXPENSE_KINDS,
  type CreateFleetCustodyCharge,
  type CreateFleetCustodyReplenishment,
  type CreateFleetCustodySettlement,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyLedgerSummaryQuery,
  type FleetCustodyLedgerTotalsDto,
  type FleetCustodyOperationDto,
  type FleetCustodyPaperSignatures,
  type FleetCustodyReplenishCandidatesDto,
  type FleetCustodySettleCandidateDto,
  type FleetCustodySettleCandidatesDto,
  type FleetCustodySource,
  type FleetLicenseExpenseKind,
  type ListFleetCustodyLedgerQuery,
  type Paginated,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { FleetReceiptModel } from '../receipts/receipt.model';
import { type FleetLicenseExpenseDoc } from '../license-expenses/license-expense.model';
import { fleetLicenseExpenseRepository } from '../license-expenses/license-expense.repository';
import { codesFor, toLicenseExpenseDto } from '../license-expenses/license-expense.service';
import { partMoney } from '../license-expenses/license-expense-money';
import { settlementField, settlementOf } from '../license-expenses/license-expense-lock';
import { FleetCustodyCounterModel, ensureCustodyCounter } from './custody-counter.model';
import { signalReceiptsOfMemo } from './custody-memo-guard';
import { fleetCustodyMemoRepository } from './custody-memo.repository';
import { fleetCustodyMemoService } from './custody-memo.service';
import { RECEIPT_PIASTRES, readMemoTotals } from './custody-memo-totals';
import { fleetCustodyPapersService } from './custody-papers.service';
import {
  chargeReasonOf,
  dayKey,
  fromPiastres,
  letterFigureOf,
  monthBounds,
  readCustodyFundTerms,
  toPiastres,
  utcDay,
} from './custody-fund';
import {
  custodyLedgerTotals,
  foldCustodyLedger,
  ledgerOperationOf,
  ledgerPlaceOf,
  pageCustodyLedger,
  type LedgerReceiptGroup,
} from './custody-ledger';
import {
  cancellationDtoOf,
  operationStatusOf,
  transferDtoOf,
  type FleetCustodyOperationDoc,
  type FleetCustodyOperationMemoDoc,
  type FleetCustodyOperationPartDoc,
} from './custody-operation.model';
import { fleetCustodyOperationRepository } from './custody-operation.repository';

/** The fund's lock document — written first by every operation, so two never interleave. */
export const CUSTODY_FUND_LOCK = 'custodyFund';

/** Create the lock document if it is missing — OUTSIDE the transaction, which only `$inc`s it. */
export const ensureFundLock = (): Promise<void> => ensureCustodyCounter(CUSTODY_FUND_LOCK);

/** Take the fund for this transaction: a write every concurrent operation also makes. */
export const lockFund = async (session: ClientSession): Promise<void> => {
  const result = await FleetCustodyCounterModel.updateOne(
    { key: CUSTODY_FUND_LOCK },
    { $inc: { seq: 1 } },
    { session },
  ).exec();
  if (result.matchedCount !== 1) {
    throw new ConflictError('the custody fund is not ready yet — try again');
  }
};

export const operationRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'custodyOperation',
  entityId: id,
});
export const memoRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'custodyMemo',
  entityId: id,
});
const licenseExpenseRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'licenseExpense',
  entityId: id,
});

const dayOrNull = (value: Date | null | undefined): string | null =>
  value == null ? null : dayKey(value);

/** The signatures exactly as the snapshot holds them — role, office, name, on; and the note. */
const signaturesOf = (
  value: FleetCustodyOperationDoc['signatures'] | null | undefined,
): FleetCustodyPaperSignatures => ({
  blocks: (value?.blocks ?? []).map((block) => ({
    role: block.role,
    office: block.office ?? '',
    name: block.name ?? '',
    on: block.on ?? true,
  })),
  note: value?.note ?? '',
});

export const toCustodyOperationDto = (
  doc: FleetCustodyOperationDoc,
  ledger: { before: number; after: number } | null,
): FleetCustodyOperationDto => ({
  id: String(doc._id),
  kind: doc.kind,
  status: operationStatusOf(doc),
  transfer: transferDtoOf(doc),
  cancellation: cancellationDtoOf(doc),
  date: dayKey(doc.date),
  from: dayOrNull(doc.from),
  to: dayOrNull(doc.to),
  amount: doc.amount,
  reason: doc.reason ?? '',
  memos: (doc.memos ?? []).map((memo) => ({
    memoId: String(memo.memoId),
    no: memo.no,
    kind: memo.kind,
    name: memo.name ?? '',
    from: dayKey(memo.from),
    to: dayKey(memo.to),
    receipts: memo.receipts,
    amount: memo.amount,
  })),
  parts: (doc.parts ?? []).map((part) => ({
    expenseId: String(part.expenseId),
    part: part.part,
    date: dayKey(part.date),
    cars: part.cars,
    codes: [...(part.codes ?? [])],
    visaTotal: part.visaTotal,
    cashTotal: part.cashTotal,
    amount: part.amount,
  })),
  fundBefore: doc.fundBefore,
  chargedTotal: doc.chargedTotal,
  letterFigure: doc.letterFigure ?? null,
  signatures: signaturesOf(doc.signatures),
  ledger,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

/** What the audit trail keeps of an operation. */
const snapshot = (doc: FleetCustodyOperationDoc) => ({
  kind: doc.kind,
  status: operationStatusOf(doc),
  transfer: transferDtoOf(doc),
  cancellation: cancellationDtoOf(doc),
  date: dayKey(doc.date),
  from: dayOrNull(doc.from),
  to: dayOrNull(doc.to),
  amount: doc.amount,
  reason: doc.reason ?? '',
  memoIds: (doc.memos ?? []).map((memo) => String(memo.memoId)),
  parts: (doc.parts ?? []).map((part) => ({ expenseId: String(part.expenseId), part: part.part })),
  fundBefore: doc.fundBefore,
  chargedTotal: doc.chargedTotal,
  letterFigure: doc.letterFigure ?? null,
});

/**
 * A letter's period: what was typed, else whole months over the days it covers. A side left out
 * never lands on the wrong side of the one that was typed.
 */
const periodFor = (
  input: { from?: Date | null | undefined; to?: Date | null | undefined },
  days: readonly Date[],
): { from: Date | null; to: Date | null } => {
  const bounds = monthBounds(days);
  let from = input.from == null ? (bounds?.from ?? null) : utcDay(input.from);
  let to = input.to == null ? (bounds?.to ?? null) : utcDay(input.to);
  if (from !== null && to !== null && from.getTime() > to.getTime()) {
    if (input.from == null) from = to;
    else to = from;
  }
  return { from, to };
};

/** A licensing memo's cars, by the registry's code — a hand-typed plate when it has none. */
const partCodes = (
  doc: FleetLicenseExpenseDoc,
  part: FleetLicenseExpenseKind,
  codes: Map<string, string>,
): string[] =>
  (doc[part]?.vehicles ?? [])
    .map((vehicle) =>
      vehicle.vehicleId == null
        ? vehicle.plate
        : (codes.get(String(vehicle.vehicleId)) ?? vehicle.plate),
    )
    .filter((code) => code.trim() !== '');

const PART_ORDER: Readonly<Record<FleetLicenseExpenseKind, number>> = { renewal: 0, extension: 1 };

/** Licensing memos in the letter's order: day ascending, a renewal before an extension. */
const byLetterOrder = <P extends { doc: FleetLicenseExpenseDoc; part: FleetLicenseExpenseKind }>(
  a: P,
  b: P,
): number =>
  a.doc.date.getTime() - b.doc.date.getTime() ||
  PART_ORDER[a.part] - PART_ORDER[b.part] ||
  a.doc.createdAt.getTime() - b.doc.createdAt.getTime() ||
  String(a.doc._id).localeCompare(String(b.doc._id));

interface ReceiptGroupRow {
  _id: { day: string; kind: FleetCustodySource; memoId: Types.ObjectId | null };
  count: number;
  piastres: number;
}

/**
 * The live custody receipts, already grouped per day, kind and memo in the database — the ledger
 * needs no single receipt, and re-reading every one on each refetch would grow with the fund.
 */
const readReceiptGroups = async (): Promise<LedgerReceiptGroup[]> => {
  const rows = await FleetReceiptModel.aggregate<ReceiptGroupRow>([
    { $match: { isDeleted: false, source: 'custody' } },
    {
      $group: {
        _id: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          kind: '$kind',
          memoId: { $ifNull: ['$memoId', null] },
        },
        count: { $sum: 1 },
        piastres: { $sum: RECEIPT_PIASTRES },
      },
    },
  ]).exec();
  const numbers = await fleetCustodyMemoRepository.numbersByIds(
    rows.flatMap((row) => (row._id.memoId == null ? [] : [String(row._id.memoId)])),
  );
  return rows.map((row) => ({
    day: row._id.day,
    kind: row._id.kind,
    memoNo: row._id.memoId == null ? null : (numbers.get(String(row._id.memoId)) ?? null),
    count: row.count,
    amount: fromPiastres(Math.round(row.piastres)),
  }));
};

class FleetCustodyFundService {
  // ── Reading ───────────────────────────────────────────────────────────────────────────────

  /** The fund's figures — the ledger's tiles, the tabs' badges, the dialogs' «الآن». Unfiltered. */
  async summary(): Promise<FleetCustodyFundSummaryDto> {
    const [terms, memos, outside] = await Promise.all([
      readCustodyFundTerms(),
      fleetCustodyMemoService.counts(),
      fleetCustodyMemoService.outside(),
    ]);
    return {
      fundTotal: terms.fundTotal,
      charged: terms.charged,
      spent: terms.spent,
      replenished: terms.replenished,
      held: terms.held,
      cancelled: terms.cancelled,
      settled: terms.settled,
      // The ledger's operation rows — a held and a cancelled replenishment are rows too.
      operations:
        terms.charged.count +
        terms.replenished.count +
        terms.held.count +
        terms.cancelled.count +
        terms.settled.count,
      memos,
      outside,
    };
  }

  /** The whole ledger, oldest first — always folded over the WHOLE history. */
  private async ledgerRows(): Promise<FleetCustodyLedgerRowDto[]> {
    const [operations, receipts] = await Promise.all([
      fleetCustodyOperationRepository.allLive(),
      readReceiptGroups(),
    ]);
    return foldCustodyLedger(operations.map(ledgerOperationOf), receipts);
  }

  /** «سجل العهدة» — one page; a filter picks rows, it never changes a row's «بعدها». */
  async ledger(query: ListFleetCustodyLedgerQuery): Promise<Paginated<FleetCustodyLedgerRowDto>> {
    return pageCustodyLedger(await this.ledgerRows(), query);
  }

  /** The count chip, over the same filters as the page. */
  async ledgerSummary(query: FleetCustodyLedgerSummaryQuery): Promise<FleetCustodyLedgerTotalsDto> {
    return custodyLedgerTotals(await this.ledgerRows(), query);
  }

  /** One operation — what its letter printed, and its place in the fund («قبلها» / «بعدها»). */
  async operation(id: string): Promise<FleetCustodyOperationDto> {
    const doc = await fleetCustodyOperationRepository.getById(id);
    return toCustodyOperationDto(doc, ledgerPlaceOf(await this.ledgerRows(), String(doc._id)));
  }

  /** «استعاضة عهدة» offers the memos no replenishment has taken — held ones are taken — oldest first. */
  async replenishCandidates(): Promise<FleetCustodyReplenishCandidatesDto> {
    const [memos, outside, terms] = await Promise.all([
      fleetCustodyMemoService.pendingRows(),
      fleetCustodyMemoService.outside(),
      readCustodyFundTerms(),
    ]);
    return { memos, outside, fundTotal: terms.fundTotal, chargedTotal: terms.charged.amount };
  }

  /**
   * «تسوية عهدة» offers every licensing memo not settled yet — one row per memo, a record holding
   * both giving two — day ascending, a renewal before an extension. Each carries its whole record,
   * so the eye preview needs no licensing grant.
   */
  async settleCandidates(): Promise<FleetCustodySettleCandidatesDto> {
    const [docs, terms] = await Promise.all([
      fleetLicenseExpenseRepository.findUnsettled(),
      readCustodyFundTerms(),
    ]);
    const codes = await codesFor(docs);
    const parts: FleetCustodySettleCandidateDto[] = docs
      .flatMap((doc) =>
        FLEET_LICENSE_EXPENSE_KINDS.filter(
          (part) => doc[part] != null && settlementOf(doc, part) === null,
        ).map((part) => ({ doc, part })),
      )
      .sort(byLetterOrder)
      .map(({ doc, part }) => {
        const money = partMoney(doc[part]);
        return {
          expenseId: String(doc._id),
          part,
          date: dayKey(doc.date),
          cars: doc[part]?.vehicles.length ?? 0,
          codes: partCodes(doc, part, codes),
          visaTotal: money.visa,
          cashTotal: money.cash,
          total: money.total,
          expense: toLicenseExpenseDto(doc, codes),
        };
      });
    return { parts, fundTotal: terms.fundTotal };
  }

  // ── The three letters ─────────────────────────────────────────────────────────────────────

  /** «شحن العهدة» — the only figure it needs is its amount. */
  async charge(input: CreateFleetCustodyCharge, by: string): Promise<FleetCustodyOperationDto> {
    const signatures = await fleetCustodyPapersService.signaturesFor('charge');
    const date = utcDay(input.date ?? new Date());
    const reason = chargeReasonOf(input.reason);
    await ensureFundLock();
    const doc = await unitOfWork(async (session) => {
      await lockFund(session);
      const terms = await readCustodyFundTerms(session);
      return fleetCustodyOperationRepository.create(
        {
          kind: 'charge',
          status: 'done',
          transfer: null,
          cancellation: null,
          date,
          from: null,
          to: null,
          amount: fromPiastres(toPiastres(input.amount)),
          reason,
          memos: [],
          parts: [],
          fundBefore: terms.fundTotal,
          chargedTotal: terms.charged.amount,
          letterFigure: letterFigureOf('charge', terms),
          signatures,
        },
        { by, session },
      );
    });
    await this.audit(doc);
    return this.operation(String(doc._id));
  }

  /**
   * «استعاضة عهدة» — the letter takes the memos with what their receipts add up to now, and they
   * are frozen from then on. It is recorded HELD: the fund does not move until «تأكيد التحويل».
   * A memo another replenishment already took — held or transferred — refuses the whole letter (409).
   */
  async replenish(
    input: CreateFleetCustodyReplenishment,
    by: string,
  ): Promise<FleetCustodyOperationDto> {
    const signatures = await fleetCustodyPapersService.signaturesFor('replenish');
    const date = utcDay(input.date ?? new Date());
    const operationId = new Types.ObjectId();
    await ensureFundLock();
    const { doc, memoIds } = await unitOfWork(async (session) => {
      await lockFund(session);
      const memos = await fleetCustodyMemoRepository.findLiveByIds(input.memoIds, session);
      const found = new Set(memos.map((memo) => String(memo._id)));
      const missing = input.memoIds.find((id) => !found.has(new Types.ObjectId(id).toString()));
      if (missing !== undefined) throw new NotFoundError(`custody memo ${missing} not found`);
      const taken = memos.find((memo) => memo.replenishmentId != null);
      if (taken !== undefined) {
        const day = dayOrNull(taken.replenishedAt);
        throw new ConflictError(
          taken.replenishmentHeld === true
            ? `custody memo ${taken.no} is already held by a replenishment${day === null ? '' : ` of ${day}`} waiting for its transfer`
            : `custody memo ${taken.no} was already replenished${day === null ? '' : ` on ${day}`}`,
        );
      }
      const totals = await readMemoTotals(memos, session);
      const snapshots: FleetCustodyOperationMemoDoc[] = [...memos]
        .sort((a, b) => a.no - b.no)
        .map((memo) => {
          const total = totals.get(String(memo._id));
          return {
            memoId: memo._id,
            no: memo.no,
            kind: memo.kind,
            name: memo.name ?? '',
            from: memo.from,
            to: memo.to,
            receipts: total?.receipts ?? 0,
            amount: total?.total ?? 0,
          };
        });
      const amount = fromPiastres(
        snapshots.reduce((sum, memo) => sum + toPiastres(memo.amount), 0),
      );
      const terms = await readCustodyFundTerms(session);
      const period = periodFor(
        input,
        memos.flatMap((memo) => [memo.from, memo.to]),
      );
      const created = await fleetCustodyOperationRepository.create(
        {
          _id: operationId,
          kind: 'replenish',
          // Its money waits for «تأكيد التحويل».
          status: 'held',
          transfer: null,
          cancellation: null,
          date,
          from: period.from,
          to: period.to,
          amount,
          reason: '',
          memos: snapshots,
          parts: [],
          fundBefore: terms.fundTotal,
          chargedTotal: terms.charged.amount,
          letterFigure: letterFigureOf('replenish', terms),
          signatures,
        },
        { by, session },
      );
      const ids = memos.map((memo) => String(memo._id));
      const marked = await fleetCustodyMemoRepository.markReplenished(
        ids,
        operationId,
        date,
        by,
        session,
        { held: true },
      );
      if (marked !== ids.length) {
        throw new ConflictError('a custody memo was replenished or deleted meanwhile — try again');
      }
      return { doc: created, memoIds: ids };
    });
    await this.audit(doc);
    for (const memoId of memoIds) {
      await auditService.record({
        entityRef: memoRef(memoId),
        action: 'statusChange',
        changes: [
          { field: 'replenishmentId', old: null, new: String(operationId) },
          { field: 'replenishedAt', old: null, new: dayKey(date) },
          { field: 'replenishmentHeld', old: false, new: true },
        ],
      });
    }
    // Their receipts are locked now: the receipts screen reads again (one signal, not one per memo).
    if (memoIds.length > 0) signalReceiptsOfMemo(String(operationId));
    return this.operation(String(operationId));
  }

  /**
   * «تسوية عهدة» — the licensing memos come off the fund with what they cost, and their records
   * are locked from then on. There is no fund check: his own letter settles more than the fund
   * holds, and the fund goes negative. A memo already settled refuses the whole letter (409).
   */
  async settle(input: CreateFleetCustodySettlement, by: string): Promise<FleetCustodyOperationDto> {
    const signatures = await fleetCustodyPapersService.signaturesFor('settle');
    const date = utcDay(input.date ?? new Date());
    const operationId = new Types.ObjectId();
    await ensureFundLock();
    const { doc, settled } = await unitOfWork(async (session) => {
      await lockFund(session);
      const docs = await fleetLicenseExpenseRepository.findLiveByIds(
        input.parts.map((entry) => entry.expenseId),
        session,
      );
      const byId = new Map(docs.map((record) => [String(record._id), record]));
      const picked = input.parts.map(({ expenseId, part }) => {
        const record = byId.get(new Types.ObjectId(expenseId).toString());
        if (record === undefined) throw new NotFoundError(`licence expense ${expenseId} not found`);
        if (record[part] == null) {
          throw new NotFoundError(`licence expense ${expenseId} has no ${part}`);
        }
        const settlement = settlementOf(record, part);
        if (settlement !== null) {
          throw new ConflictError(
            `the ${part} of licence expense ${expenseId} was already settled on ${dayKey(settlement.settledAt)}`,
          );
        }
        return { doc: record, part };
      });
      const codes = await codesFor(docs);
      const parts: FleetCustodyOperationPartDoc[] = [...picked]
        .sort(byLetterOrder)
        .map(({ doc: record, part }) => {
          const money = partMoney(record[part]);
          return {
            expenseId: record._id,
            part,
            date: record.date,
            cars: record[part]?.vehicles.length ?? 0,
            codes: partCodes(record, part, codes),
            visaTotal: money.visa,
            cashTotal: money.cash,
            amount: money.total,
          };
        });
      const amount = fromPiastres(parts.reduce((sum, part) => sum + toPiastres(part.amount), 0));
      const terms = await readCustodyFundTerms(session);
      const period = periodFor(
        input,
        parts.map((part) => part.date),
      );
      const created = await fleetCustodyOperationRepository.create(
        {
          _id: operationId,
          kind: 'settle',
          status: 'done',
          transfer: null,
          cancellation: null,
          date,
          from: period.from,
          to: period.to,
          amount,
          reason: '',
          memos: [],
          parts,
          fundBefore: terms.fundTotal,
          chargedTotal: terms.charged.amount,
          letterFigure: letterFigureOf('settle', terms),
          signatures,
        },
        { by, session },
      );
      for (const part of parts) {
        const marked = await fleetLicenseExpenseRepository.markSettled(
          String(part.expenseId),
          part.part,
          { operationId, settledAt: date },
          by,
          session,
        );
        if (!marked) {
          throw new ConflictError(
            `the ${part.part} of licence expense ${String(part.expenseId)} was settled, changed or deleted meanwhile — try again`,
          );
        }
      }
      return { doc: created, settled: parts };
    });
    await this.audit(doc);
    // One status change per record, naming each of its memos this letter settled.
    const records = new Map<string, FleetLicenseExpenseKind[]>();
    for (const part of settled) {
      const id = String(part.expenseId);
      records.set(id, [...(records.get(id) ?? []), part.part]);
    }
    for (const [expenseId, kinds] of records) {
      await auditService.record({
        entityRef: licenseExpenseRef(expenseId),
        action: 'statusChange',
        changes: kinds.map((part) => ({
          field: settlementField(part),
          old: null,
          new: { operationId: String(operationId), settledAt: dayKey(date) },
        })),
      });
    }
    return this.operation(String(operationId));
  }

  private async audit(doc: FleetCustodyOperationDoc): Promise<void> {
    await auditService.record({
      entityRef: operationRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
  }
}

export const fleetCustodyFundService = new FleetCustodyFundService();
