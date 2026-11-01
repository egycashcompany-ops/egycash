// The register of mobile lines (FR-19) — «صفحة لإدارتهم … وبردو بفلتر لكل شبكة مع بيانات كل شبكة»:
// register, edit, read, list with each line's holder, the per-network figures, a line's history and
// the custody intervals across lines. The custody actions themselves live in `line-custody.service`.
import { Types, type FilterQuery } from 'mongoose';
import {
  IT_MOBILE_NETWORKS,
  asciiDigits,
  type CreateItMobileLine,
  type ItMobileLineCountDto,
  type ItMobileLinesSummaryDto,
  type ItMobileLinesSummaryQuery,
  type ListItMobileLineAssignmentsQuery,
  type ListItMobileLineHistoryQuery,
  type ListItMobileLinesQuery,
  type Paginated,
  type UpdateItMobileLine,
} from '@ecms/contracts';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { keyReachesBranch, type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployees } from '../../../platform/directory';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
// Types only, and imported as such: the mapper module reaches every IT model, which a service
// that only names the label shapes has no reason to load.
import type {
  ItHolderLabels,
  ItMobileLineHolderLabels,
  ItMobileLineLabels,
  ItReceiptStates,
} from '../it.mappers';
import { itMobileLineRepository, type ItMobileLineCounts } from './mobile-line.repository';
import { itMobileLineAssignmentRepository } from './line-assignment.repository';
import { itMobileLineEventRepository } from './line-event.repository';
import { itMobileLineReceiptRepository } from './line-receipt.repository';
import { ensureItMobileLineCollections, lineEntityRef, writeLineHistory } from './line-history';
import { type ItMobileLineDoc } from './mobile-line.model';
import { type ItMobileLineAssignmentDoc } from './line-assignment.model';
import { type ItMobileLineEventDoc } from './line-event.model';

/** The register's facts as the audit trail compares them — never the holder, which is custody. */
const snapshot = (doc: ItMobileLineDoc) => ({
  network: doc.network,
  phoneNumber: doc.phoneNumber,
  accountNumber: doc.accountNumber ?? null,
  ratePlan: doc.ratePlan ?? null,
  simKind: doc.simKind,
  simSerial: doc.simSerial ?? null,
  status: doc.status,
  branchId: String(doc.branchId),
  notes: doc.notes ?? null,
});

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The filters the register and its network cards share — everything but the network and paging. */
type RegisterFilters = Pick<
  ItMobileLinesSummaryQuery,
  'search' | 'status' | 'branchId' | 'holderEmployeeId' | 'holderKind'
> & { networks?: ListItMobileLinesQuery['networks'] };

/** Largest first; equal counts by value, «none» last — so the card reads the same every time. */
const byCount = (rows: ItMobileLineCountDto[]): ItMobileLineCountDto[] =>
  [...rows].sort(
    (a, b) =>
      b.count - a.count ||
      (a.value === null ? 1 : b.value === null ? -1 : a.value.localeCompare(b.value)),
  );

/**
 * The cards' figures from the one aggregation: always the three networks, in the order the screen
 * shows them, a network nobody has counting zero rather than vanishing.
 */
export const summarizeMobileLines = (counts: ItMobileLineCounts): ItMobileLinesSummaryDto => ({
  networks: IT_MOBILE_NETWORKS.map((network) => {
    const statusCount = (status: string): number =>
      counts.statuses
        .filter((row) => row._id.network === network && row._id.key === status)
        .reduce((sum, row) => sum + row.count, 0);
    const valuesOf = (rows: ItMobileLineCounts['accounts']): ItMobileLineCountDto[] =>
      byCount(
        rows
          .filter((row) => row._id.network === network)
          .map((row) => ({ value: row._id.key ?? null, count: row.count })),
      );
    const inStock = statusCount('inStock');
    const assigned = statusCount('assigned');
    const suspended = statusCount('suspended');
    return {
      network,
      total: inStock + assigned + suspended,
      inStock,
      assigned,
      suspended,
      accounts: valuesOf(counts.accounts),
      ratePlans: valuesOf(counts.ratePlans),
    };
  }),
});

const employeeLabels = async (ids: readonly (string | null)[]): Promise<ItHolderLabels> => {
  const distinct = [...new Set(ids.filter((id): id is string => id !== null))];
  if (distinct.length === 0) return new Map();
  const employees = await getDirectoryEmployees(distinct);
  return new Map(
    [...employees].map(([id, employee]) => [
      id,
      { code: employee.code, fullNameAr: employee.fullNameAr },
    ]),
  );
};

/**
 * Whether each paper has its signed copy — read unscoped by id: the rows naming them were already
 * read under the caller's scope, and all this adds is one yes/no per paper they reference.
 */
const receiptStates = async (ids: readonly (string | null)[]): Promise<ItReceiptStates> => {
  const receipts = await itMobileLineReceiptRepository.findByIdsSystem(
    ids.filter((id): id is string => id !== null),
  );
  return new Map(
    receipts.map((receipt) => [String(receipt._id), { signed: receipt.signedCopy !== null }]),
  );
};

const idOf = (id: Types.ObjectId | null): string | null => (id === null ? null : String(id));

class ItMobileLineService {
  /**
   * The filter both the register and its cards read under — built once, so a card never counts a
   * different set of lines from the table under it.
   *
   * A holder (an employee, a kind, a car's code or plate) is a fact of the OPEN interval, matched
   * through the line's own pointer to it: a line returned yesterday is not «held» by yesterday's
   * holder.
   */
  private async registerFilter(query: RegisterFilters): Promise<FilterQuery<ItMobileLineDoc>> {
    const filter: FilterQuery<ItMobileLineDoc> = {};
    if (query.networks !== undefined) filter.network = { $in: query.networks };
    if (query.status !== undefined) filter.status = query.status;
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.holderEmployeeId !== undefined || query.holderKind !== undefined) {
      filter.currentAssignmentId = {
        $in: await itMobileLineAssignmentRepository.openIdsMatching({
          employeeId: query.holderEmployeeId,
          holderKind: query.holderKind,
        }),
      };
    }
    if (query.search !== undefined && query.search !== '') {
      // A number is typed in either digit set; the register stores ASCII. The invisible direction
      // marks a number copied from a chat carries are not part of it.
      const text = asciiDigits(query.search)
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, '')
        .trim();
      const pattern = new RegExp(escapeRegex(text), 'i');
      // A pasted number or card serial — «010 1234 5678», «+20 10…», the card's printed groups — is
      // matched the way the register stores it: digits only, the international prefix as a 0.
      const compact = text.replace(/[\s\-().،]/gu, '').replace(/^(\+20|0020)/u, '0');
      const digits = /^\d+$/u.test(compact) ? new RegExp(escapeRegex(compact)) : pattern;
      const byCar = await itMobileLineAssignmentRepository.openIdsMatching({ vehicle: pattern });
      filter.$or = [
        { phoneNumber: digits },
        { simSerial: digits },
        { ratePlan: pattern },
        { accountNumber: pattern },
        { notes: pattern },
        ...(byCar.length === 0 ? [] : [{ currentAssignmentId: { $in: byCar } }]),
      ];
    }
    return filter;
  }

  async list(
    query: ListItMobileLinesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItMobileLineDoc>> {
    return itMobileLineRepository.list({
      filter: await this.registerFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // Unsorted, the register reads as the networks' own sheets do: by network, then by number.
      ...(query.sortBy === undefined
        ? {
            sorts: [
              { by: 'network', dir: 'asc' as const },
              { by: 'phoneNumber', dir: 'asc' as const },
            ],
          }
        : {}),
      sortableFields: [
        'phoneNumber',
        'network',
        'status',
        'ratePlan',
        'accountNumber',
        'createdAt',
        'updatedAt',
      ],
      scope,
    });
  }

  async summary(
    query: ItMobileLinesSummaryQuery,
    scope: ScopeSelector,
  ): Promise<ItMobileLinesSummaryDto> {
    const counts = await itMobileLineRepository.countsByNetwork(
      await this.registerFilter(query),
      scope,
    );
    return summarizeMobileLines(counts);
  }

  async get(id: string, scope: ScopeSelector): Promise<ItMobileLineDoc> {
    const line = await itMobileLineRepository.findById(id, scope);
    if (line === null) throw new NotFoundError('mobile line not found');
    return line;
  }

  /**
   * Register a line — in stock, held by nobody. Only into a branch the caller's `itAsset.create`
   * reaches: the scope that would hide another branch's lines from them must not let them file one
   * there. A number or an ICCID already on the register is the unique indexes' conflict (409).
   */
  async register(input: CreateItMobileLine, ctx: AuthContext): Promise<ItMobileLineDoc> {
    if (!keyReachesBranch(ctx, 'itAsset.create', input.branchId)) {
      throw new ForbiddenError('itAsset.create does not reach this branch');
    }
    await ensureItMobileLineCollections();
    const at = new Date();
    const doc = await unitOfWork(async (session) => {
      const line = await itMobileLineRepository.create(
        {
          network: input.network,
          phoneNumber: input.phoneNumber,
          accountNumber: input.accountNumber ?? null,
          ratePlan: input.ratePlan ?? null,
          simKind: input.simKind,
          simSerial: input.simSerial ?? null,
          status: 'inStock',
          branchId: new Types.ObjectId(input.branchId),
          currentAssignmentId: null,
          notes: input.notes ?? null,
        },
        { by: ctx.userId, session },
      );
      await writeLineHistory(
        {
          lineId: String(line._id),
          type: 'registered',
          at,
          metadata: { network: line.network, phoneNumber: line.phoneNumber },
          notes: null,
        },
        ctx,
        session,
      );
      return line;
    });
    await auditService.record({
      entityRef: lineEntityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  /**
   * Edit the register's facts. The line as it ENDS UP may not be an eSIM with a card serial (an
   * edit can change either half alone), and a new branch must be one the caller's `itAsset.edit`
   * reaches.
   *
   * A line somebody holds MAY move branch — «عايزك تفتح إنى أعدل الفرع عادي لخط من خطوط الموبايل
   * لأن ممكن القائد يغير الفرع بتاعه»: its holder moved, and the line goes with them. Its OPEN
   * interval and the paper it names move in the same transaction, so the branch that keeps the
   * line now sees who holds it and can print the paper again; the line's past intervals keep the
   * branch they were held in.
   */
  async update(
    id: string,
    input: UpdateItMobileLine,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItMobileLineDoc> {
    const before = await this.get(id, scope);
    const toBranch =
      input.branchId !== undefined && input.branchId !== String(before.branchId)
        ? input.branchId
        : null;
    if (toBranch !== null && !keyReachesBranch(ctx, 'itAsset.edit', toBranch)) {
      throw new ForbiddenError('itAsset.edit does not reach this branch');
    }
    const simKind = input.simKind ?? before.simKind;
    const simSerial = input.simSerial === undefined ? (before.simSerial ?? null) : input.simSerial;
    if (simKind === 'esim' && simSerial !== null) {
      throw new BusinessRuleError(
        'an eSIM has no card serial; clear the SIM serial to make it one',
      );
    }

    const set: Partial<ItMobileLineDoc> = {};
    if (input.network !== undefined) set.network = input.network;
    if (input.phoneNumber !== undefined) set.phoneNumber = input.phoneNumber;
    if (input.accountNumber !== undefined) set.accountNumber = input.accountNumber;
    if (input.ratePlan !== undefined) set.ratePlan = input.ratePlan;
    if (input.simKind !== undefined) set.simKind = input.simKind;
    if (input.simSerial !== undefined) set.simSerial = input.simSerial;
    if (input.branchId !== undefined) set.branchId = new Types.ObjectId(input.branchId);
    if (input.notes !== undefined) set.notes = input.notes;

    await ensureItMobileLineCollections();
    const updated = await unitOfWork(async (session) => {
      const after = await itMobileLineRepository.updateById(id, set, {
        by: ctx.userId,
        version: input.version,
        session,
        scope,
      });
      // The line's current custody, and the paper signed for it, move with the line.
      if (toBranch !== null && after.status === 'assigned') {
        const receiptId = await itMobileLineAssignmentRepository.moveOpenToBranch(
          id,
          after.branchId,
          session,
        );
        if (receiptId !== null) {
          await itMobileLineReceiptRepository.moveToBranch(receiptId, after.branchId, session);
        }
      }
      const fields = diffChanges(snapshot(before), snapshot(after)).map((entry) => entry.field);
      if (fields.length > 0) {
        await writeLineHistory(
          { lineId: id, type: 'updated', at: new Date(), metadata: { fields }, notes: null },
          ctx,
          session,
        );
      }
      return after;
    });
    const changes = diffChanges(snapshot(before), snapshot(updated));
    if (changes.length > 0) {
      await auditService.record({ entityRef: lineEntityRef(id), action: 'update', changes });
    }
    return updated;
  }

  /** A line's history, newest first — read only once the line itself is, under the same scope. */
  async history(
    id: string,
    query: ListItMobileLineHistoryQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItMobileLineEventDoc>> {
    await this.get(id, scope);
    return itMobileLineEventRepository.listForLine({
      lineId: id,
      type: query.type,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /** The custody intervals across lines — scoped on the branch each interval was opened in. */
  async listAssignments(
    query: ListItMobileLineAssignmentsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItMobileLineAssignmentDoc>> {
    return itMobileLineAssignmentRepository.listFiltered({
      open: query.open,
      lineId: query.lineId,
      employeeId: query.employeeId,
      branchId: query.branchId,
      page: query.page,
      pageSize: query.pageSize,
      // Newest hand-over first unless asked otherwise — an employee's lines read as a history.
      sortBy: query.sortBy ?? 'assignedAt',
      sortDir: query.sortDir,
      scope,
    });
  }

  /**
   * Who holds each line on ONE page — the open intervals by id, their employees through the
   * directory, their papers' signed state: three reads per page, never three per row.
   */
  async holderLabels(lines: readonly ItMobileLineDoc[]): Promise<ItMobileLineHolderLabels> {
    const intervals = (
      await itMobileLineAssignmentRepository.findByIdsSystem(
        lines.flatMap((line) =>
          line.currentAssignmentId === null ? [] : [String(line.currentAssignmentId)],
        ),
      )
    ).filter((interval) => interval.returnedAt === null && !interval.isDeleted);
    const [employees, receipts] = await Promise.all([
      employeeLabels(intervals.map((interval) => idOf(interval.assignedToEmployeeId))),
      receiptStates(intervals.map((interval) => idOf(interval.receiptId))),
    ]);
    return {
      intervals: new Map(intervals.map((interval) => [String(interval._id), interval])),
      employees,
      receipts,
    };
  }

  /**
   * The labels on ONE page of intervals: the employee, the line, the paper. The lines are read
   * THROUGH the caller's scope, so a reader is never told a number from a branch they cannot see.
   */
  async assignmentLabels(
    rows: readonly ItMobileLineAssignmentDoc[],
    scope: ScopeSelector,
  ): Promise<{ holders: ItHolderLabels; lines: ItMobileLineLabels; receipts: ItReceiptStates }> {
    const [holders, found, receipts] = await Promise.all([
      employeeLabels(rows.map((row) => idOf(row.assignedToEmployeeId))),
      itMobileLineRepository.findManyByIds(
        rows.map((row) => String(row.lineId)),
        scope,
      ),
      receiptStates(rows.map((row) => idOf(row.receiptId))),
    ]);
    return {
      holders,
      lines: new Map(
        found.map((line) => [
          String(line._id),
          { network: line.network, phoneNumber: line.phoneNumber, ratePlan: line.ratePlan ?? null },
        ]),
      ),
      receipts,
    };
  }
}

export const itMobileLineService = new ItMobileLineService();
