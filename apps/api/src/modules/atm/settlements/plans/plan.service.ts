// The daily replenishment plan («خطة التغذية») — create, add machine and spare lines, edit a draft,
// issue, reopen, cancel, and record a spare's machine (S-3…S-6, S-9; docs/12-planning/
// atm-settlements-phase1.md §6.5).
//
// CONCURRENCY (the governing rule). Every guard is checked by the write that depends on it, inside
// the same transaction: an `updateOne` whose filter carries `{ _id, planId, __v, status,
// isDeleted: false }`, and a missed match that throws (`StaleDocumentError` or the named 409), which
// rolls the whole transaction back. A check made before the transaction only shapes the error.
//   · Adds `$inc` the plan's `lastPosition` FIRST, so two adds meet a write conflict on the plan and
//     `withTransaction` retries the loser, whose new attempt reads the winner's lines;
//     `ux_plan_machine_run` is the backstop (E11000 → 409, answered outside the transaction).
//   · Issue takes its serials from the branch × bank counter inside the transaction (DS-11): two
//     issues conflict there and are serialised; a missed line CAS takes the increment back.
//   · Reopen guards the preparation's emptiness in its own filter; cancel bumps the preparation's
//     `__v`, so a capture in flight fails.
// AUDITS are built inside the transaction callback — fresh on every attempt, because
// `withTransaction` may run it more than once — and recorded once, after the commit.
import {
  ATM_PLAN_LINES_MAX,
  ErrorCodes,
  bagAllocation,
  cleanLabel,
  fillFromStandard,
  isPlanned,
  layoutIssues,
  lineEgpTotalMinor,
  normalizeAtmMachineCode,
  normalizeScheduleTime,
  splitByDenomination,
  type AddAtmPlanLines,
  type AddAtmSpareLine,
  type ApiErrorDetail,
  type AtmCassetteSlot,
  type AtmDenominationNotes,
  type AtmLineReason,
  type AtmPlanAddRefusal,
  type AtmPlanAddResultDto,
  type AtmPlanLineDto,
  type AtmPlanLineStatus,
  type AtmPlanSlot,
  type AtmSettlementPlanDto,
  type AtmSettlementPlanQuery,
  type AtmSpareUse,
  type CreateAtmPlan,
  type IssueAtmPlan,
  type UpdateAtmPlanLine,
} from '@ecms/contracts';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  StaleDocumentError,
  ValidationError,
} from '../../../../shared/errors';
import { keyReachesBranch, scopeSelector, type AuthContext } from '../../../../shared/types';
import { type BaseDocFields } from '../../../../shared/base/base.model';
import { diffChanges } from '../../../../shared/utils/diff';
import { AtmMachineModel, type AtmMachineDoc } from '../../machines/machine.model';
import { type PendingAudit } from '../../register/register-coupling';
import { actorName } from '../../shared/atm-context';
import { branchScopeMatch } from '../../shared/branch-scope';
import { AtmRouteAssignmentModel } from '../control/route-assignment.model';
import { type AtmCassetteLayoutDoc } from '../layouts/cassette-layout.model';
import { liveLayoutOf, liveLayoutsByMachine } from '../layouts/layout.repository';
import {
  AtmLinePreparationModel,
  type AtmLinePreparationDoc,
} from '../preparation/line-preparation.model';
import { signalControlDay, signalPreparationDay } from '../shared/day-signals';
import { holdsAnyValue } from '../shared/preparation-state';
import { machineBanks } from '../shared/register-bank';
import {
  branchMismatch,
  isDuplicateKey,
  readBranch,
  requireEnabledBank,
  requireWorkBranch,
} from '../shared/settlement-context';
import { runSettlementHook } from '../shared/test-hooks';
import { type AtmStandardLoadDoc } from '../standard-loads/standard-load.model';
import { liveStandardLoads, profileFor } from '../standard-loads/standard-load.service';
import { ensureNoteCounter, noteCounterKey, takeNoteSerials } from './note-counter.model';
import {
  byIssueOrder,
  issuesOf,
  loadPlanWorld,
  plainPlanSlots,
  preparationsByLine,
  toPlanDto,
  toPlanLineDto,
} from './plan-dto';
import { AtmPlanLineModel, type AtmPlanLineDoc } from './plan-line.model';
import { AtmReplenishmentPlanModel, type AtmReplenishmentPlanDoc } from './plan.model';

const VIEW = 'atmSettlementPlan.view';
const MANAGE = 'atmSettlementPlan.manage';

const asId = (id: Types.ObjectId | string): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

const planRef = (id: string) => ({ moduleId: 'atm', entityType: 'settlementPlan', entityId: id });
const lineRef = (id: string) => ({ moduleId: 'atm', entityType: 'planLine', entityId: id });
const preparationRef = (id: string) => ({
  moduleId: 'atm',
  entityType: 'linePreparation',
  entityId: id,
});
const assignmentRef = (lineId: string) => ({
  moduleId: 'atm',
  entityType: 'routeAssignment',
  entityId: lineId,
});

const recordAll = async (audits: readonly PendingAudit[]): Promise<void> => {
  for (const audit of audits) await auditService.record(audit);
};

/** 409 `ATM_PLAN_LINE_STATE` — the action does not fit the line's status. */
export const lineStateError = (status: AtmPlanLineStatus | string): AppError =>
  new AppError(ErrorCodes.ATM_PLAN_LINE_STATE, 409, `the line is ${status}`, {
    details: [{ field: 'status', code: status, message: status }],
  });

const fieldError = (field: string, code: string, message: string): ValidationError =>
  new ValidationError([{ field, code, message }]);

/** A layout's slots as a line's, every planned slot's notes from `fill`, not bagged yet. */
const planSlotsFrom = (
  slots: readonly AtmCassetteSlot[],
  notes: ReadonlyMap<number, number>,
): AtmPlanSlot[] =>
  [...slots]
    .sort((a, b) => a.slot - b.slot)
    .map((s) => ({
      slot: s.slot,
      kind: s.kind,
      denomination: s.denomination ?? null,
      currency: s.currency ?? null,
      notes: isPlanned(s) ? (notes.get(s.slot) ?? 0) : 0,
      bag: null,
    }));

const plainNotes = (notes: readonly AtmDenominationNotes[]): AtmDenominationNotes[] =>
  notes.map((n) => ({ denomination: n.denomination, notes: n.notes }));

/** The counts a profile gives (S-3, DS-8). */
const filledFrom = (
  slots: readonly AtmCassetteSlot[],
  profile: AtmStandardLoadDoc | null,
): Pick<AtmPlanLineDoc, 'slots' | 'countsSource' | 'standardLoadId' | 'standardNotes'> => ({
  slots: planSlotsFrom(slots, fillFromStandard(slots, profile).notes),
  countsSource: 'standard',
  standardLoadId: profile === null ? null : profile._id,
  standardNotes: profile === null ? null : plainNotes(profile.notes),
});

/** S16 step 3 / S15: typed totals per denomination, split by THE method of S-4. */
const applyDenominationNotes = (
  slots: AtmPlanSlot[],
  entries: readonly AtmDenominationNotes[],
): AtmPlanSlot[] => {
  const fill = splitByDenomination(slots, entries);
  const unplaced = fill.unplaced[0];
  if (unplaced !== undefined) {
    const i = entries.findIndex((e) => e.denomination === unplaced);
    throw fieldError(
      `body.denominationNotes.${String(i)}.denomination`,
      'UNKNOWN_SLOT',
      'no planned cassette of the line carries this denomination',
    );
  }
  return slots.map((s) => (fill.notes.has(s.slot) ? { ...s, notes: fill.notes.get(s.slot) ?? 0 } : s));
};

/** S16 step 4 / S15: single-slot overrides; only a planned slot of the line takes notes (DS-4). */
const applySlotNotes = (
  slots: AtmPlanSlot[],
  entries: readonly { slot: number; notes: number }[],
): AtmPlanSlot[] => {
  const next = slots.map((s) => ({ ...s }));
  entries.forEach((entry, i) => {
    const target = next.find((s) => s.slot === entry.slot);
    if (target === undefined) {
      throw fieldError(`body.notes.${String(i)}.slot`, 'UNKNOWN_SLOT', 'the line has no such slot');
    }
    if (!isPlanned(target)) {
      throw fieldError(
        `body.notes.${String(i)}.slot`,
        'SLOT_NOT_FILLABLE',
        'only an EGP withdrawal or recycle cassette takes notes',
      );
    }
    target.notes = entry.notes;
  });
  return next;
};

/** What the line's audit records of its counts. */
const notesSnapshot = (slots: readonly AtmPlanSlot[]) =>
  slots.map((s) => ({ slot: s.slot, notes: s.notes }));

const lineSnapshot = (line: Pick<
  AtmPlanLineDoc,
  | 'run'
  | 'scheduleTime'
  | 'slots'
  | 'countsSource'
  | 'standardLoadId'
  | 'layoutRevision'
  | 'typeLabel'
  | 'featuresLabel'
  | 'hubLabel'
  | 'egpTotalMinor'
>) => ({
  run: line.run,
  scheduleTime: line.scheduleTime,
  notes: notesSnapshot(line.slots),
  slots: plainPlanSlots(line.slots).map((s) => ({
    slot: s.slot,
    kind: s.kind,
    denomination: s.denomination,
    currency: s.currency,
  })),
  countsSource: line.countsSource,
  standardLoadId: line.standardLoadId === null ? null : String(line.standardLoadId),
  layoutRevision: line.layoutRevision,
  typeLabel: line.typeLabel,
  featuresLabel: line.featuresLabel,
  hubLabel: line.hubLabel,
  egpTotalMinor: line.egpTotalMinor,
});

/** A new line's fields that every add shares. */
type NewLine = Omit<AtmPlanLineDoc, keyof BaseDocFields | 'position'>;

const blankLineFields = {
  spareUse: null,
  serial: null,
  voidedSerials: [] as AtmPlanLineDoc['voidedSerials'],
  issuedAt: null,
  issuedBy: null,
  issuedByName: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelledByName: null,
  cancelReason: null,
  notePrintCount: 0,
  notePrintedAt: null,
} as const;

type MachineRow = Pick<
  AtmMachineDoc,
  '_id' | 'branchId' | 'machineCode' | 'name' | 'area' | 'isActive'
>;

class AtmSettlementPlanService {
  // ── Loading ──────────────────────────────────────────────────────────────────────────────────

  /** The plan through the view key's match, or 404. */
  async loadPlan(
    planId: string,
    ctx: AuthContext,
    viewKey = VIEW,
  ): Promise<AtmReplenishmentPlanDoc> {
    const plan = await AtmReplenishmentPlanModel.findOne({
      $and: [{ _id: asId(planId), isDeleted: false }, branchScopeMatch(scopeSelector(ctx, viewKey))],
    } as FilterQuery<AtmReplenishmentPlanDoc>)
      .lean<AtmReplenishmentPlanDoc>()
      .exec();
    if (plan === null) throw new NotFoundError('no such plan');
    return plan;
  }

  /** §6.2: a line of THIS plan, through the read match (a line of another plan is a 404). */
  private async loadLine(planId: string, lineId: string, ctx: AuthContext): Promise<AtmPlanLineDoc> {
    const line = await AtmPlanLineModel.findOne({
      $and: [
        { _id: asId(lineId), planId: asId(planId), isDeleted: false },
        branchScopeMatch(scopeSelector(ctx, VIEW)),
      ],
    } as FilterQuery<AtmPlanLineDoc>)
      .lean<AtmPlanLineDoc>()
      .exec();
    if (line === null) throw new NotFoundError('no such line in this plan');
    return line;
  }

  private requireManage(ctx: AuthContext, branchId: Types.ObjectId | string): void {
    if (!keyReachesBranch(ctx, MANAGE, String(branchId))) {
      throw new ForbiddenError('the plan key does not reach this branch');
    }
  }

  private async linesOf(planId: Types.ObjectId, session?: ClientSession): Promise<AtmPlanLineDoc[]> {
    return AtmPlanLineModel.find({ planId, isDeleted: false })
      .session(session ?? null)
      .lean<AtmPlanLineDoc[]>()
      .exec();
  }

  async planDto(plan: AtmReplenishmentPlanDoc, ctx: AuthContext): Promise<AtmSettlementPlanDto> {
    return toPlanDto(plan, await this.linesOf(plan._id), ctx);
  }

  /** One line's DTO, its issues against the plan as it is now. */
  async lineDto(plan: AtmReplenishmentPlanDoc, lineId: Types.ObjectId): Promise<AtmPlanLineDto> {
    const lines = await this.linesOf(plan._id);
    const line = lines.find((l) => String(l._id) === String(lineId));
    if (line === undefined) throw new NotFoundError('no such line in this plan');
    const [world, preparations] = await Promise.all([
      loadPlanWorld(lines),
      preparationsByLine([line._id]),
    ]);
    return toPlanLineDto(
      line,
      issuesOf(line, plan, lines, world),
      preparations.get(String(line._id)) ?? null,
    );
  }

  // ── S11–S13 ──────────────────────────────────────────────────────────────────────────────────

  /** S11 — the plan of a branch × bank × day, or null. */
  async byDay(
    query: AtmSettlementPlanQuery,
    ctx: AuthContext,
  ): Promise<{ plan: AtmSettlementPlanDto | null }> {
    const branchId = await readBranch(ctx, VIEW, MANAGE, query.branchId);
    const plan = await AtmReplenishmentPlanModel.findOne({
      $and: [
        { isDeleted: false },
        branchScopeMatch(scopeSelector(ctx, VIEW)),
        { branchId: asId(branchId), bankCode: query.bankCode, replenishDate: query.date },
      ],
    } as FilterQuery<AtmReplenishmentPlanDoc>)
      .lean<AtmReplenishmentPlanDoc>()
      .exec();
    return { plan: plan === null ? null : await this.planDto(plan, ctx) };
  }

  /** S13. */
  async get(planId: string, ctx: AuthContext): Promise<AtmSettlementPlanDto> {
    return this.planDto(await this.loadPlan(planId, ctx), ctx);
  }

  /** S12. */
  async create(input: CreateAtmPlan, ctx: AuthContext): Promise<AtmSettlementPlanDto> {
    await requireEnabledBank(input.bankCode);
    const work = await requireWorkBranch(ctx, VIEW, MANAGE);
    if (input.branchId !== work.branchId) throw branchMismatch();
    if (!work.canWrite) throw new ForbiddenError('the plan key does not reach this branch');
    const by = asId(ctx.userId);
    let plan: AtmReplenishmentPlanDoc;
    try {
      const [created] = await AtmReplenishmentPlanModel.create([
        {
          branchId: asId(work.branchId),
          bankCode: input.bankCode,
          replenishDate: input.replenishDate,
          lastPosition: 0,
          receiptPrint: null,
          handoverPrint: null,
          createdBy: by,
          updatedBy: by,
        },
      ]);
      plan = created?.toObject() as AtmReplenishmentPlanDoc;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await AtmReplenishmentPlanModel.findOne(
        {
          branchId: asId(work.branchId),
          bankCode: input.bankCode,
          replenishDate: input.replenishDate,
          isDeleted: false,
        },
        { _id: 1 },
      )
        .lean<{ _id: Types.ObjectId }>()
        .exec();
      const planId = existing === null ? '' : String(existing._id);
      throw new AppError(ErrorCodes.ATM_PLAN_EXISTS, 409, 'a plan for this bank and day exists', {
        details: [{ field: 'planId', code: 'EXISTS', message: planId }],
      });
    }
    await auditService.record({
      entityRef: planRef(String(plan._id)),
      action: 'create',
      changes: diffChanges(
        {},
        { branchId: work.branchId, bankCode: plan.bankCode, replenishDate: plan.replenishDate },
      ),
    });
    return this.planDto(plan, ctx);
  }

  // ── Adding lines (S14, S15) ──────────────────────────────────────────────────────────────────

  /**
   * The S14 callback shape, shared by both adds: the plan's `$inc` FIRST, then the in-session
   * re-read of its live machine lines and the 400-line cap, then the inserts.
   */
  private async insertLines(
    plan: AtmReplenishmentPlanDoc,
    candidates: readonly NewLine[],
    by: Types.ObjectId,
  ): Promise<{ inserted: AtmPlanLineDoc[]; duplicates: number[] }> {
    const k = candidates.length;
    try {
      return await unitOfWork(async (session) => {
        const moved = await AtmReplenishmentPlanModel.findOneAndUpdate(
          { _id: plan._id, isDeleted: false },
          { $inc: { lastPosition: k } },
          { new: true, session },
        )
          .lean<AtmReplenishmentPlanDoc>()
          .exec();
        if (moved === null) throw new NotFoundError('no such plan');
        const live = await AtmPlanLineModel.find(
          { planId: plan._id, status: { $in: ['draft', 'issued', 'prepared'] }, isDeleted: false },
          { kind: 1, machineId: 1, run: 1 },
        )
          .session(session)
          .lean<Pick<AtmPlanLineDoc, 'kind' | 'machineId' | 'run'>[]>()
          .exec();
        const taken = new Set(
          live
            .filter((l) => l.kind === 'machine' && l.machineId !== null)
            .map((l) => `${String(l.machineId)}:${String(l.run)}`),
        );
        const duplicates: number[] = [];
        const accepted: { index: number; line: NewLine }[] = [];
        candidates.forEach((line, index) => {
          const key = `${String(line.machineId)}:${String(line.run)}`;
          if (line.kind === 'machine' && taken.has(key)) {
            duplicates.push(index);
            return;
          }
          if (line.kind === 'machine') taken.add(key);
          accepted.push({ index, line });
        });
        if (live.length + accepted.length > ATM_PLAN_LINES_MAX) {
          throw new AppError(
            ErrorCodes.ATM_PLAN_FULL,
            422,
            `a plan holds at most ${String(ATM_PLAN_LINES_MAX)} lines`,
            {
              details: [
                {
                  field: 'lines',
                  code: 'PLAN_FULL',
                  message: String(ATM_PLAN_LINES_MAX),
                },
              ],
            },
          );
        }
        const first = moved.lastPosition - k + 1;
        const docs =
          accepted.length === 0
            ? []
            : await AtmPlanLineModel.create(
                accepted.map(({ index, line }) => ({
                  ...line,
                  position: first + index,
                  createdBy: by,
                  updatedBy: by,
                })),
                { session, ordered: true },
              );
        return { inserted: docs.map((d) => d.toObject() as AtmPlanLineDoc), duplicates };
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new StaleDocumentError();
      throw error;
    }
  }

  private async auditCreatedLines(lines: readonly AtmPlanLineDoc[]): Promise<void> {
    for (const line of lines) {
      await auditService.record({
        entityRef: lineRef(String(line._id)),
        action: 'create',
        changes: diffChanges(
          {},
          {
            kind: line.kind,
            machineCode: line.machineCode,
            spareCode: line.spareCode,
            run: line.run,
            scheduleTime: line.scheduleTime,
            notes: notesSnapshot(line.slots),
          },
        ),
      });
    }
  }

  /** S14 — machine lines by code; every refusal is per row and never fails the batch. */
  async addLines(
    planId: string,
    input: AddAtmPlanLines,
    ctx: AuthContext,
  ): Promise<AtmPlanAddResultDto> {
    const plan = await this.loadPlan(planId, ctx);
    this.requireManage(ctx, plan.branchId);
    const refused: { index: number; code: string; reason: AtmPlanAddRefusal }[] = [];

    // 1. Per row: the code, a repeat, the time.
    const seen = new Set<string>();
    const rows: { index: number; text: string; code: string; time: string | null }[] = [];
    input.rows.forEach((row, index) => {
      const code = normalizeAtmMachineCode(row.machineCode);
      if (seen.has(code)) {
        refused.push({ index, code: row.machineCode, reason: 'duplicateInRequest' });
        return;
      }
      seen.add(code);
      const time = normalizeScheduleTime(row.scheduleTime);
      if (time === 'bad') {
        refused.push({ index, code: row.machineCode, reason: 'badTime' });
        return;
      }
      rows.push({ index, text: row.machineCode, code, time });
    });

    // 2–3. The machines of the plan's branch, their bank and their layout.
    const machines = await AtmMachineModel.find(
      {
        branchId: plan.branchId,
        machineCode: { $in: rows.map((r) => r.code) },
        isDeleted: false,
      },
      { branchId: 1, machineCode: 1, name: 1, area: 1, isActive: 1 },
    )
      .lean<MachineRow[]>()
      .exec();
    const byCode = new Map(machines.map((m) => [m.machineCode, m]));
    const ids = machines.map((m) => m._id);
    const [banks, layouts, loads] = await Promise.all([
      machineBanks(ids),
      liveLayoutsByMachine(ids),
      liveStandardLoads(plan.branchId, plan.bankCode),
    ]);

    // 4. Each candidate as a draft line.
    const candidates: { index: number; text: string; line: NewLine }[] = [];
    for (const row of rows) {
      const machine = byCode.get(row.code);
      const refuse = (reason: AtmPlanAddRefusal): void => {
        refused.push({ index: row.index, code: row.text, reason });
      };
      if (machine === undefined) {
        refuse('unknownCode');
        continue;
      }
      if (!machine.isActive) {
        refuse('inactive');
        continue;
      }
      const bank = banks.get(String(machine._id));
      if (bank === undefined || bank.reason === 'noRegisterBank') {
        refuse('noRegisterBank');
        continue;
      }
      if (bank.bank !== plan.bankCode) {
        refuse('otherBank');
        continue;
      }
      const layout = layouts.get(String(machine._id));
      if (layout === undefined) {
        refuse('noLayout');
        continue;
      }
      if (!layout.slots.some(isPlanned)) {
        refuse('noFillableSlot');
        continue;
      }
      candidates.push({
        index: row.index,
        text: row.text,
        line: this.machineLine(plan, machine, layout, loads, input.run, row.time),
      });
    }

    // 5. One transaction; 6. the audits after it.
    const by = asId(ctx.userId);
    const { inserted, duplicates } =
      candidates.length === 0
        ? { inserted: [], duplicates: [] }
        : await this.insertLines(
            plan,
            candidates.map((c) => c.line),
            by,
          );
    for (const i of duplicates) {
      const candidate = candidates[i];
      if (candidate !== undefined) {
        refused.push({ index: candidate.index, code: candidate.text, reason: 'duplicateInRun' });
      }
    }
    await this.auditCreatedLines(inserted);

    const lines = await this.linesOf(plan._id);
    const world = await loadPlanWorld(lines);
    const insertedIds = new Set(inserted.map((l) => String(l._id)));
    return {
      added: lines
        .filter((l) => insertedIds.has(String(l._id)))
        .sort((a, b) => a.position - b.position)
        .map((l) => toPlanLineDto(l, issuesOf(l, plan, lines, world), null)),
      refused: refused
        .sort((a, b) => a.index - b.index)
        .map(({ code, reason }) => ({ code, reason })),
    };
  }

  /** A machine's draft line: the snapshot (DS-29) and the counts of its profile (S-3, DS-8). */
  private machineLine(
    plan: AtmReplenishmentPlanDoc,
    machine: MachineRow,
    layout: AtmCassetteLayoutDoc,
    loads: readonly AtmStandardLoadDoc[],
    run: 1 | 2 | 3,
    time: string | null,
  ): NewLine {
    const filled = filledFrom(layout.slots, profileFor(loads, [layout.standardLoadId]));
    return {
      planId: plan._id,
      branchId: plan.branchId,
      bankCode: plan.bankCode,
      replenishDate: plan.replenishDate,
      kind: 'machine',
      machineId: machine._id,
      machineCode: machine.machineCode,
      machineName: machine.name,
      area: machine.area,
      typeLabel: layout.typeLabel,
      featuresLabel: layout.featuresLabel,
      hubLabel: layout.hubLabel,
      layoutRevision: layout.revision,
      spareCode: null,
      run,
      scheduleTime: time,
      status: 'draft',
      ...filled,
      egpTotalMinor: lineEgpTotalMinor(filled.slots),
      ...blankLineFields,
    };
  }

  /** S15 — a spare set: its own line with a type and no machine (S-9, DS-27). */
  async addSpare(planId: string, input: AddAtmSpareLine, ctx: AuthContext): Promise<AtmPlanLineDto> {
    const plan = await this.loadPlan(planId, ctx);
    this.requireManage(ctx, plan.branchId);
    const slots: AtmCassetteSlot[] = input.slots.map((s) => ({
      slot: s.slot,
      kind: s.kind,
      denomination: s.denomination,
      currency: s.currency,
    }));
    const issues = layoutIssues(slots, { spare: true });
    if (issues.length > 0) {
      throw new ValidationError(
        issues.map(
          (issue): ApiErrorDetail => ({
            field: issue.slot === null ? 'body.slots' : `body.slots.slot=${String(issue.slot)}`,
            code: issue.code,
            message: 'the spare set’s cassettes are not valid',
          }),
        ),
      );
    }
    const loads = await liveStandardLoads(plan.branchId, plan.bankCode);
    let profile: AtmStandardLoadDoc | null = null;
    if (input.standardLoadId !== null) {
      profile = loads.find((l) => String(l._id) === input.standardLoadId) ?? null;
      if (profile === null) {
        throw fieldError(
          'body.standardLoadId',
          'STANDARD_LOAD_OTHER_BANK',
          "the standard load is not one of this plan's bank and branch",
        );
      }
    }
    const filled = filledFrom(slots, profile);
    let lineSlots = filled.slots;
    let manual = false;
    if (input.denominationNotes !== undefined && input.denominationNotes.length > 0) {
      lineSlots = applyDenominationNotes(lineSlots, input.denominationNotes);
      manual = true;
    }
    if (input.notes !== undefined && input.notes.length > 0) {
      lineSlots = applySlotNotes(lineSlots, input.notes);
      manual = true;
    }
    const line: NewLine = {
      planId: plan._id,
      branchId: plan.branchId,
      bankCode: plan.bankCode,
      replenishDate: plan.replenishDate,
      kind: 'spare',
      machineId: null,
      machineCode: null,
      machineName: null,
      area: null,
      typeLabel: cleanLabel(input.typeLabel),
      featuresLabel: null,
      hubLabel: null,
      layoutRevision: null,
      spareCode: input.spareCode === null || input.spareCode === '' ? null : input.spareCode,
      run: input.run,
      scheduleTime: input.scheduleTime,
      status: 'draft',
      slots: lineSlots,
      countsSource: manual ? 'manual' : 'standard',
      standardLoadId: filled.standardLoadId,
      standardNotes: filled.standardNotes,
      egpTotalMinor: lineEgpTotalMinor(lineSlots),
      ...blankLineFields,
    };
    const { inserted } = await this.insertLines(plan, [line], asId(ctx.userId));
    await this.auditCreatedLines(inserted);
    const created = inserted[0];
    if (created === undefined) throw new StaleDocumentError();
    return this.lineDto(plan, created._id);
  }

  // ── S16, S17 ─────────────────────────────────────────────────────────────────────────────────

  /** S16 — edit a draft line; the changes apply in the spec's order. */
  async updateLine(
    planId: string,
    lineId: string,
    patch: UpdateAtmPlanLine,
    ctx: AuthContext,
  ): Promise<AtmPlanLineDto> {
    const plan = await this.loadPlan(planId, ctx);
    const line = await this.loadLine(planId, lineId, ctx);
    this.requireManage(ctx, line.branchId);
    if (line.status !== 'draft') throw lineStateError(line.status);

    const next: AtmPlanLineDoc = { ...line, slots: plainPlanSlots(line.slots) };
    const loads = await liveStandardLoads(plan.branchId, plan.bankCode);

    // 1. refreshLayout: the machine and the layout again, then the counts from the line's profile.
    if (patch.refreshLayout === true) {
      if (line.kind !== 'machine' || line.machineId === null) {
        throw fieldError('body.refreshLayout', 'SPARE_LINE', 'a spare line has no layout to refresh');
      }
      const machine = await AtmMachineModel.findOne(
        { _id: line.machineId, isDeleted: false },
        { machineCode: 1, name: 1, area: 1 },
      )
        .lean<Pick<AtmMachineDoc, 'machineCode' | 'name' | 'area'>>()
        .exec();
      const layout = machine === null ? null : await liveLayoutOf(line.machineId);
      if (machine === null || layout === null) {
        throw new AppError(ErrorCodes.BUSINESS_RULE_VIOLATION, 422, 'the machine has no layout', {
          details: [{ field: 'body.refreshLayout', code: 'NO_LAYOUT', message: 'NO_LAYOUT' }],
        });
      }
      Object.assign(next, {
        machineCode: machine.machineCode,
        machineName: machine.name,
        area: machine.area,
        typeLabel: layout.typeLabel,
        featuresLabel: layout.featuresLabel,
        hubLabel: layout.hubLabel,
        layoutRevision: layout.revision,
        ...filledFrom(layout.slots, profileFor(loads, [line.standardLoadId, layout.standardLoadId])),
      });
    }

    // 2. standardLoadId: a profile, or null for the layout's or the bank's default.
    if (patch.standardLoadId !== undefined) {
      let profile: AtmStandardLoadDoc | null;
      if (patch.standardLoadId !== null) {
        profile = loads.find((l) => String(l._id) === patch.standardLoadId) ?? null;
        if (profile === null) {
          throw fieldError(
            'body.standardLoadId',
            'STANDARD_LOAD_OTHER_BANK',
            "the standard load is not one of this plan's bank and branch",
          );
        }
      } else {
        const layout =
          line.kind === 'machine' && line.machineId !== null
            ? await liveLayoutOf(line.machineId)
            : null;
        profile = profileFor(loads, [layout?.standardLoadId]);
      }
      Object.assign(next, filledFrom(next.slots, profile));
    }

    // 3. Totals per denomination; 4. single slots.
    if (patch.denominationNotes !== undefined && patch.denominationNotes.length > 0) {
      next.slots = applyDenominationNotes(next.slots, patch.denominationNotes);
      next.countsSource = 'manual';
    }
    if (patch.notes !== undefined && patch.notes.length > 0) {
      next.slots = applySlotNotes(next.slots, patch.notes);
      next.countsSource = 'manual';
    }
    if (patch.scheduleTime !== undefined) next.scheduleTime = patch.scheduleTime;
    if (patch.run !== undefined && patch.run !== line.run) {
      next.run = patch.run;
      if (line.kind === 'machine') {
        const occupied = await AtmPlanLineModel.exists({
          planId: line.planId,
          kind: 'machine',
          machineId: line.machineId,
          run: patch.run,
          status: { $in: ['draft', 'issued', 'prepared'] },
          isDeleted: false,
          _id: { $ne: line._id },
        }).exec();
        if (occupied !== null) {
          throw new AppError(
            ErrorCodes.BUSINESS_RULE_VIOLATION,
            422,
            'the machine already has a line in this run',
            { details: [{ field: 'body.run', code: 'DUPLICATE_IN_RUN', message: 'DUPLICATE_IN_RUN' }] },
          );
        }
      }
    }
    next.egpTotalMinor = lineEgpTotalMinor(next.slots);

    await runSettlementHook('plan.update.beforeWrite');
    const by = asId(ctx.userId);
    let updated: AtmPlanLineDoc;
    try {
      updated = await unitOfWork(async (session) => {
        const doc = await AtmPlanLineModel.findOneAndUpdate(
          {
            _id: line._id,
            planId: line.planId,
            status: 'draft',
            __v: patch.version,
            isDeleted: false,
          },
          {
            $set: {
              run: next.run,
              scheduleTime: next.scheduleTime,
              machineCode: next.machineCode,
              machineName: next.machineName,
              area: next.area,
              typeLabel: next.typeLabel,
              featuresLabel: next.featuresLabel,
              hubLabel: next.hubLabel,
              layoutRevision: next.layoutRevision,
              slots: next.slots,
              countsSource: next.countsSource,
              standardLoadId: next.standardLoadId,
              standardNotes: next.standardNotes,
              egpTotalMinor: next.egpTotalMinor,
              updatedBy: by,
            },
            $inc: { __v: 1 },
          },
          { new: true, session },
        )
          .lean<AtmPlanLineDoc>()
          .exec();
        if (doc === null) throw new StaleDocumentError();
        return doc;
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new StaleDocumentError();
      throw error;
    }
    const changes = diffChanges(lineSnapshot(line), lineSnapshot(updated));
    if (changes.length > 0) {
      await auditService.record({ entityRef: lineRef(lineId), action: 'update', changes });
    }
    return this.lineDto(plan, updated._id);
  }

  /** S17 — delete a draft line (soft). */
  async deleteLine(planId: string, lineId: string, version: number, ctx: AuthContext): Promise<void> {
    const line = await this.loadLine(planId, lineId, ctx);
    this.requireManage(ctx, line.branchId);
    if (line.status !== 'draft') throw lineStateError(line.status);
    const by = asId(ctx.userId);
    const deleted = await AtmPlanLineModel.updateOne(
      { _id: line._id, planId: line.planId, status: 'draft', __v: version, isDeleted: false },
      {
        $set: { isDeleted: true, deletedAt: new Date(), deletedBy: by, updatedBy: by },
        $inc: { __v: 1 },
      },
    ).exec();
    if (deleted.matchedCount !== 1) throw new StaleDocumentError();
    await auditService.record({
      entityRef: lineRef(lineId),
      action: 'delete',
      changes: diffChanges(
        { machineCode: line.machineCode, spareCode: line.spareCode, run: line.run },
        {},
      ),
    });
  }

  // ── S18 issue ────────────────────────────────────────────────────────────────────────────────

  /** The highest serial ever used for a branch × bank: live lines and voided serials (§4.9). */
  private async serialFloor(plan: AtmReplenishmentPlanDoc): Promise<number> {
    const [live, voided] = await Promise.all([
      AtmPlanLineModel.findOne(
        {
          branchId: plan.branchId,
          bankCode: plan.bankCode,
          serial: { $gt: 0 },
          isDeleted: false,
        },
        { serial: 1 },
      )
        .sort({ serial: -1 })
        .lean<Pick<AtmPlanLineDoc, 'serial'>>()
        .exec(),
      AtmPlanLineModel.findOne(
        { branchId: plan.branchId, bankCode: plan.bankCode, 'voidedSerials.serial': { $gt: 0 } },
        { voidedSerials: 1 },
      )
        .sort({ 'voidedSerials.serial': -1 })
        .lean<Pick<AtmPlanLineDoc, 'voidedSerials'>>()
        .exec(),
    ]);
    const voidedMax = Math.max(0, ...(voided?.voidedSerials ?? []).map((v) => v.serial));
    return Math.max(live?.serial ?? 0, voidedMax);
  }

  /** S18 — issue draft lines: serials, bags and an open preparation each (DS-10, DS-11, DS-13). */
  async issue(planId: string, input: IssueAtmPlan, ctx: AuthContext): Promise<AtmSettlementPlanDto> {
    // 1. The plan in reach; manage reaching its branch.
    const plan = await this.loadPlan(planId, ctx);
    this.requireManage(ctx, plan.branchId);

    // 2. Every listed line a live draft of this plan with the given version (a hint; 5 guards).
    const lines = await this.linesOf(plan._id);
    const byId = new Map(lines.map((l) => [String(l._id), l]));
    const listed = input.lines.map((entry) => {
      const line = byId.get(entry.id);
      if (line === undefined || line.status !== 'draft' || line.__v !== entry.version) {
        throw new StaleDocumentError();
      }
      return line;
    });

    // 3. Plannability again, and the issue rules: any error blocks.
    const world = await loadPlanWorld(lines);
    const blocked: ApiErrorDetail[] = [];
    listed.forEach((line, i) => {
      for (const issue of issuesOf(line, plan, lines, world)) {
        if (issue.severity !== 'error') continue;
        blocked.push({ field: `lines[${String(i)}]`, code: issue.code, message: issue.code });
      }
    });
    if (blocked.length > 0) {
      throw new AppError(ErrorCodes.ATM_PLAN_ISSUE_BLOCKED, 422, 'some lines cannot be issued', {
        details: blocked,
      });
    }

    // 4. The counter, outside the transaction, never below a number already used.
    const key = noteCounterKey(String(plan.branchId), plan.bankCode);
    await ensureNoteCounter(key, await this.serialFloor(plan));
    await runSettlementHook('plan.issue.beforeWrite');

    // 5. One transaction: the serials, the lines, their preparations.
    const ordered = [...listed].sort(byIssueOrder);
    const by = asId(ctx.userId);
    const name = actorName(ctx);
    const audits = await unitOfWork(async (session) => {
      const pending: PendingAudit[] = [];
      const first = await takeNoteSerials(key, ordered.length, session);
      const now = new Date();
      for (const [i, line] of ordered.entries()) {
        const serial = first + i;
        const bags = bagAllocation(line.slots);
        const bagOf = new Map(bags.flatMap((b) => b.slots.map((slot) => [slot, b.bag] as const)));
        const slots = plainPlanSlots(line.slots).map((s) => ({ ...s, bag: bagOf.get(s.slot) ?? null }));
        const moved = await AtmPlanLineModel.updateOne(
          { _id: line._id, planId: plan._id, status: 'draft', __v: line.__v, isDeleted: false },
          {
            $set: {
              status: 'issued',
              serial,
              slots,
              issuedAt: now,
              issuedBy: by,
              issuedByName: name,
              updatedBy: by,
            },
            $inc: { __v: 1 },
          },
          { session },
        ).exec();
        if (moved.matchedCount !== 1) throw new StaleDocumentError();
        await AtmLinePreparationModel.create(
          [
            {
              lineId: line._id,
              planId: plan._id,
              branchId: plan.branchId,
              bankCode: plan.bankCode,
              replenishDate: plan.replenishDate,
              bags: bags.map((b) => ({ bag: b.bag, slots: b.slots, qr: null, qrKey: null })),
              seals: bags.flatMap((b) => b.slots.map((slot) => ({ slot, value: null, key: null }))),
              status: 'open',
              lastCapturedAt: null,
              lastCapturedByName: null,
              preparedAt: null,
              preparedBy: null,
              preparedByName: null,
              createdBy: by,
              updatedBy: by,
            },
          ],
          { session },
        );
        pending.push({
          entityRef: lineRef(String(line._id)),
          action: 'statusChange',
          changes: [
            { field: 'status', old: 'draft', new: 'issued' },
            { field: 'serial', old: null, new: serial },
          ],
        });
      }
      return pending;
    });

    // 6. After the commit.
    await recordAll(audits);
    signalPreparationDay(String(plan._id), String(plan.branchId));
    signalControlDay(String(plan._id), String(plan.branchId));
    return this.planDto(await this.loadPlan(planId, ctx), ctx);
  }

  // ── S19 reopen, S20 cancel ───────────────────────────────────────────────────────────────────

  /** Soft-deletes the line's live route assignment inside the transaction; whether one existed. */
  private async dropAssignment(
    lineId: Types.ObjectId,
    by: Types.ObjectId,
    session: ClientSession,
  ): Promise<{ routeId: string } | null> {
    const current = await AtmRouteAssignmentModel.findOne({ lineId, isDeleted: false })
      .session(session)
      .lean<{ _id: Types.ObjectId; routeId: Types.ObjectId }>()
      .exec();
    if (current === null) return null;
    await AtmRouteAssignmentModel.updateOne(
      { _id: current._id, isDeleted: false },
      {
        $set: { isDeleted: true, deletedAt: new Date(), deletedBy: by, updatedBy: by },
        $inc: { __v: 1 },
      },
      { session },
    ).exec();
    return { routeId: String(current.routeId) };
  }

  /** S19 — an issued line back to draft: its serial voided, its empty preparation removed. */
  async reopen(
    planId: string,
    lineId: string,
    input: AtmLineReason,
    ctx: AuthContext,
  ): Promise<AtmPlanLineDto> {
    const plan = await this.loadPlan(planId, ctx);
    const line = await this.loadLine(planId, lineId, ctx);
    this.requireManage(ctx, line.branchId);
    const hasCaptures = (): AppError =>
      new AppError(
        ErrorCodes.ATM_PLAN_LINE_HAS_CAPTURES,
        409,
        'the line’s preparation holds captured values',
      );
    if (line.status === 'prepared') throw hasCaptures();
    if (line.status !== 'issued' || line.serial === null) throw lineStateError(line.status);
    const prep = await AtmLinePreparationModel.findOne({ lineId: line._id, isDeleted: false })
      .lean<AtmLinePreparationDoc>()
      .exec();
    if (prep !== null && (prep.status !== 'open' || holdsAnyValue(prep))) throw hasCaptures();
    await runSettlementHook('plan.reopen.beforeWrite');

    const by = asId(ctx.userId);
    const name = actorName(ctx);
    const serial = line.serial;
    const audits = await unitOfWork(async (session) => {
      const pending: PendingAudit[] = [];
      const now = new Date();
      const moved = await AtmPlanLineModel.updateOne(
        { _id: line._id, planId: line.planId, status: 'issued', __v: input.version, isDeleted: false },
        {
          $set: {
            status: 'draft',
            serial: null,
            'slots.$[].bag': null,
            notePrintCount: 0,
            notePrintedAt: null,
            issuedAt: null,
            issuedBy: null,
            issuedByName: null,
            updatedBy: by,
          },
          $push: {
            voidedSerials: {
              serial,
              printCount: line.notePrintCount,
              at: now,
              byName: name,
              reason: input.reason,
            },
          },
          $inc: { __v: 1 },
        },
        { session },
      ).exec();
      if (moved.matchedCount !== 1) throw new StaleDocumentError();
      pending.push({
        entityRef: lineRef(lineId),
        action: 'statusChange',
        changes: [
          { field: 'status', old: 'issued', new: 'draft' },
          { field: 'serial', old: serial, new: null },
          { field: 'reason', old: null, new: input.reason },
        ],
      });
      if (prep !== null) {
        const removed = await AtmLinePreparationModel.updateOne(
          {
            lineId: line._id,
            status: 'open',
            __v: prep.__v,
            isDeleted: false,
            'bags.qr': { $not: { $type: 'string' } },
            'seals.value': { $not: { $type: 'string' } },
          },
          {
            $set: { isDeleted: true, deletedAt: now, deletedBy: by, updatedBy: by },
            $inc: { __v: 1 },
          },
          { session },
        ).exec();
        if (removed.matchedCount !== 1) throw hasCaptures();
        pending.push({
          entityRef: preparationRef(String(prep._id)),
          action: 'delete',
          changes: [{ field: 'status', old: prep.status, new: null }],
        });
      }
      const dropped = await this.dropAssignment(line._id, by, session);
      if (dropped !== null) {
        pending.push({
          entityRef: assignmentRef(lineId),
          action: 'delete',
          changes: [{ field: 'routeId', old: dropped.routeId, new: null }],
        });
      }
      return pending;
    });
    await recordAll(audits);
    signalPreparationDay(String(plan._id), String(plan.branchId));
    signalControlDay(String(plan._id), String(plan.branchId));
    return this.lineDto(plan, line._id);
  }

  /** S20 — an issued or prepared line cancelled; its serial stays and is never reused. */
  async cancel(
    planId: string,
    lineId: string,
    input: AtmLineReason,
    ctx: AuthContext,
  ): Promise<AtmPlanLineDto> {
    const plan = await this.loadPlan(planId, ctx);
    const line = await this.loadLine(planId, lineId, ctx);
    this.requireManage(ctx, line.branchId);
    if (line.status !== 'issued' && line.status !== 'prepared') throw lineStateError(line.status);
    const by = asId(ctx.userId);
    const name = actorName(ctx);
    const audits = await unitOfWork(async (session) => {
      const pending: PendingAudit[] = [];
      const now = new Date();
      const moved = await AtmPlanLineModel.updateOne(
        {
          _id: line._id,
          planId: line.planId,
          status: { $in: ['issued', 'prepared'] },
          __v: input.version,
          isDeleted: false,
        },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: by,
            cancelledByName: name,
            cancelReason: input.reason,
            updatedBy: by,
          },
          $inc: { __v: 1 },
        },
        { session },
      ).exec();
      if (moved.matchedCount !== 1) throw new StaleDocumentError();
      // A capture or a «تم التجهيز» in flight with the old version now fails (GS-7: kept).
      await AtmLinePreparationModel.updateOne(
        { lineId: line._id, isDeleted: false },
        { $inc: { __v: 1 } },
        { session },
      ).exec();
      pending.push({
        entityRef: lineRef(lineId),
        action: 'statusChange',
        changes: [
          { field: 'status', old: line.status, new: 'cancelled' },
          { field: 'reason', old: null, new: input.reason },
        ],
      });
      const dropped = await this.dropAssignment(line._id, by, session);
      if (dropped !== null) {
        pending.push({
          entityRef: assignmentRef(lineId),
          action: 'delete',
          changes: [{ field: 'routeId', old: dropped.routeId, new: null }],
        });
      }
      return pending;
    });
    await recordAll(audits);
    signalPreparationDay(String(plan._id), String(plan.branchId));
    signalControlDay(String(plan._id), String(plan.branchId));
    return this.lineDto(plan, line._id);
  }

  // ── S21 spare use ────────────────────────────────────────────────────────────────────────────

  /** S21 — which machine a spare set replenished (S-9); a correction replaces it. */
  async spareUse(
    planId: string,
    lineId: string,
    input: AtmSpareUse,
    ctx: AuthContext,
  ): Promise<AtmPlanLineDto> {
    const plan = await this.loadPlan(planId, ctx);
    const line = await this.loadLine(planId, lineId, ctx);
    this.requireManage(ctx, line.branchId);
    if (line.kind !== 'spare') throw lineStateError(line.kind);
    if (line.status !== 'issued' && line.status !== 'prepared') throw lineStateError(line.status);

    const refuse = (code: AtmPlanAddRefusal): AppError =>
      new AppError(ErrorCodes.BUSINESS_RULE_VIOLATION, 422, 'this machine cannot be recorded', {
        details: [{ field: 'body.machineCode', code, message: code }],
      });
    const machine = await AtmMachineModel.findOne(
      {
        branchId: plan.branchId,
        machineCode: normalizeAtmMachineCode(input.machineCode),
        isDeleted: false,
      },
      { machineCode: 1, name: 1, isActive: 1 },
    )
      .lean<Pick<AtmMachineDoc, '_id' | 'machineCode' | 'name' | 'isActive'>>()
      .exec();
    if (machine === null) throw refuse('unknownCode');
    if (!machine.isActive) throw refuse('inactive');
    const bank = (await machineBanks([machine._id])).get(String(machine._id));
    if (bank === undefined || bank.reason === 'noRegisterBank') throw refuse('noRegisterBank');
    if (bank.bank !== plan.bankCode) throw refuse('otherBank');

    const by = asId(ctx.userId);
    const spareUse = {
      machineId: machine._id,
      machineCode: machine.machineCode,
      machineName: machine.name,
      at: new Date(),
      by,
      byName: actorName(ctx),
    };
    const moved = await AtmPlanLineModel.updateOne(
      {
        _id: line._id,
        planId: line.planId,
        kind: 'spare',
        status: { $in: ['issued', 'prepared'] },
        __v: input.version,
        isDeleted: false,
      },
      { $set: { spareUse, updatedBy: by }, $inc: { __v: 1 } },
    ).exec();
    if (moved.matchedCount !== 1) throw new StaleDocumentError();
    await auditService.record({
      entityRef: lineRef(lineId),
      action: 'update',
      changes: diffChanges(
        {
          spareUse:
            line.spareUse === null
              ? null
              : { machineId: String(line.spareUse.machineId), machineCode: line.spareUse.machineCode },
        },
        { spareUse: { machineId: String(machine._id), machineCode: machine.machineCode } },
      ),
    });
    return this.lineDto(plan, line._id);
  }
}

export const atmSettlementPlanService = new AtmSettlementPlanService();
