// Preparation («الشوالات والسيلزات») — the day's issued lines, and the bag QRs and cassette seals
// scanned (or typed) while closing the bags (S-6, S-7; docs/12-planning/atm-settlements-phase1.md
// §6.8).
//
// SCOPE. The page works in one branch (`atmPreparation.view` / `.capture`, DS-22). A save reads the
// preparation through the view key's match (404 outside), then asks `.capture` to reach its branch
// (403): a department-scoped grant reads and never writes.
//
// VALUES are stored as scanned, after `cleanScannedValue` (format characters, CR/LF/Tab removed,
// Arabic-Indic digits → ASCII), with `sealKey` beside them for duplicates (§3.5). An invalid value is
// a 400 naming the field, never the value. Duplicates WARN and never block (S-7); a missing required
// value blocks «تم التجهيز» only (DS-16).
//
// CONCURRENCY. Every write's filter carries the preparation's `__v` and status: a cancel bumps
// that `__v` and a reopen soft-deletes the document, so a capture can never land on a cancelled or
// reopened line. «تم التجهيز» moves the preparation and the line together, in one transaction.
import {
  AtmBagQrSchema,
  AtmSealValueSchema,
  ErrorCodes,
  cleanScannedValue,
  scannedValueWarnings,
  sealKey,
  type ApiErrorDetail,
  type AtmPlanRun,
  type AtmPreparationContextDto,
  type AtmPreparationLineDto,
  type AtmSealDuplicateDto,
  type AtmSettlementDayQuery,
  type AtmVersion,
  type SaveAtmPreparation,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
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
import { diffChanges } from '../../../../shared/utils/diff';
import { actorName } from '../../shared/atm-context';
import { branchScopeMatch } from '../../shared/branch-scope';
import { cairoDateString } from '../../shared/cairo-time';
import { bySerial, plainPlanSlots } from '../plans/plan-dto';
import { AtmPlanLineModel, type AtmPlanLineDoc } from '../plans/plan-line.model';
import { lineStateError, atmSettlementPlanService } from '../plans/plan.service';
import { AtmReplenishmentPlanModel, type AtmReplenishmentPlanDoc } from '../plans/plan.model';
import { signalControlDay } from '../shared/day-signals';
import {
  bagRequired,
  preparationProgress,
  preparationStatusOf,
  requiredMissing,
  sealRequired,
} from '../shared/preparation-state';
import {
  addDays,
  branchNameOf,
  enabledSettlementBanks,
  readBranch,
} from '../shared/settlement-context';
import { runSettlementHook } from '../shared/test-hooks';
import { AtmLinePreparationModel, type AtmLinePreparationDoc } from './line-preparation.model';
import { fieldKey, findSealDuplicates, type SealField } from './seal-duplicates';

const VIEW = 'atmPreparation.view';
const CAPTURE = 'atmPreparation.capture';

const asId = (id: Types.ObjectId | string): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

const preparationRef = (id: string) => ({
  moduleId: 'atm',
  entityType: 'linePreparation',
  entityId: id,
});
const lineRef = (id: string) => ({ moduleId: 'atm', entityType: 'planLine', entityId: id });

/**
 * DS-25: the earliest day from today (Cairo) on which the branch has issued lines not yet prepared
 * (of the enabled banks), else tomorrow. Preparation and Control both open on it.
 */
export const suggestedDay = async (branchId: string): Promise<string> => {
  const today = cairoDateString(new Date());
  const banks = await enabledSettlementBanks();
  const next = await AtmPlanLineModel.findOne(
    {
      branchId: asId(branchId),
      bankCode: { $in: banks },
      replenishDate: { $gte: today },
      status: 'issued',
      isDeleted: false,
    },
    { replenishDate: 1 },
  )
    .sort({ replenishDate: 1 })
    .lean<Pick<AtmPlanLineDoc, 'replenishDate'>>()
    .exec();
  return next?.replenishDate ?? addDays(today, 1);
};

/** The fields of a preparation that hold a key, for the duplicate lookup. */
export const sealFieldsOf = (prep: AtmLinePreparationDoc): SealField[] => {
  const lineId = String(prep.lineId);
  return [
    ...prep.bags.flatMap((b): SealField[] =>
      b.qrKey === null ? [] : [{ lineId, field: 'bag', bag: b.bag, key: b.qrKey }],
    ),
    ...prep.seals.flatMap((s): SealField[] =>
      s.key === null ? [] : [{ lineId, field: 'seal', slot: s.slot, key: s.key }],
    ),
  ];
};

/** The duplicates of one line's fields, out of the whole list's lookup. */
export const duplicatesOfLine = (
  prep: AtmLinePreparationDoc,
  all: ReadonlyMap<string, AtmSealDuplicateDto>,
): AtmSealDuplicateDto[] =>
  sealFieldsOf(prep).flatMap((f) => {
    const found = all.get(fieldKey(f));
    return found === undefined ? [] : [found];
  });

export const toPreparationLineDto = (
  line: AtmPlanLineDoc,
  prep: AtmLinePreparationDoc,
  duplicates: AtmSealDuplicateDto[],
): AtmPreparationLineDto => ({
  lineId: String(line._id),
  planId: String(line.planId),
  serial: line.serial,
  voidedSerials: line.voidedSerials.map((v) => v.serial),
  lineStatus: line.status,
  kind: line.kind,
  machineCode: line.machineCode,
  machineName: line.machineName,
  area: line.area,
  hubLabel: line.hubLabel,
  typeLabel: line.typeLabel,
  spareCode: line.spareCode,
  run: line.run as AtmPlanRun,
  scheduleTime: line.scheduleTime,
  egpTotalMinor: line.egpTotalMinor,
  slots: plainPlanSlots(line.slots),
  preparation: {
    id: String(prep._id),
    version: prep.__v,
    status: prep.status,
    bags: prep.bags.map((b) => ({
      bag: b.bag,
      slots: [...b.slots],
      qr: b.qr,
      required: bagRequired(b, line.slots),
    })),
    seals: prep.seals.map((s) => ({
      slot: s.slot,
      value: s.value,
      required: sealRequired(s.slot, line.slots),
    })),
    lastCapturedByName: prep.lastCapturedByName,
    lastCapturedAt: prep.lastCapturedAt === null ? null : new Date(prep.lastCapturedAt).toISOString(),
    preparedByName: prep.preparedByName,
    preparedAt: prep.preparedAt === null ? null : new Date(prep.preparedAt).toISOString(),
  },
  progress: preparationProgress(prep, line.slots),
  warnings: [
    ...prep.bags.flatMap((b) =>
      b.qr === null
        ? []
        : scannedValueWarnings(b.qr).map((code) => ({ field: 'bag' as const, bag: b.bag, code })),
    ),
    ...prep.seals.flatMap((s) =>
      s.value === null
        ? []
        : scannedValueWarnings(s.value).map((code) => ({
            field: 'seal' as const,
            slot: s.slot,
            code,
          })),
    ),
  ],
  duplicates,
});

/** What a capture audit compares: `bags.1.qr`, `seals.3.value`. */
const captureSnapshot = (prep: Pick<AtmLinePreparationDoc, 'bags' | 'seals'>) =>
  Object.fromEntries([
    ...prep.bags.map((b) => [`bags.${String(b.bag)}.qr`, b.qr] as const),
    ...prep.seals.map((s) => [`seals.${String(s.slot)}.value`, s.value] as const),
  ]);

const locked = (): AppError =>
  new AppError(ErrorCodes.ATM_PREPARATION_LOCKED, 409, 'the preparation is closed');

class AtmPreparationService {
  /** P1 — the work branch, the day (asked or suggested), and its plans' progress. */
  async context(query: AtmSettlementDayQuery, ctx: AuthContext): Promise<AtmPreparationContextDto> {
    const branchId = await readBranch(ctx, VIEW, CAPTURE, query.branchId);
    const date = query.date ?? (await suggestedDay(branchId));
    const banks = await enabledSettlementBanks();
    const view = scopeSelector(ctx, VIEW);
    const plans = await AtmReplenishmentPlanModel.find({
      $and: [
        { isDeleted: false },
        branchScopeMatch(view),
        { branchId: asId(branchId), replenishDate: date, bankCode: { $in: banks } },
      ],
    } as FilterQuery<AtmReplenishmentPlanDoc>)
      .sort({ bankCode: 1 })
      .lean<AtmReplenishmentPlanDoc[]>()
      .exec();
    const lines = await AtmPlanLineModel.find({
      planId: { $in: plans.map((p) => p._id) },
      status: { $in: ['issued', 'prepared', 'cancelled'] },
      isDeleted: false,
    })
      .lean<AtmPlanLineDoc[]>()
      .exec();
    const preps = await AtmLinePreparationModel.find({
      lineId: { $in: lines.map((l) => l._id) },
      isDeleted: false,
    })
      .lean<AtmLinePreparationDoc[]>()
      .exec();
    const prepOf = new Map(preps.map((p) => [String(p.lineId), p]));
    return {
      branch: { id: branchId, name: await branchNameOf(branchId) },
      date,
      canCapture: keyReachesBranch(ctx, CAPTURE, branchId),
      plans: plans
        .map((plan) => {
          const own = lines.filter((l) => String(l.planId) === String(plan._id));
          const live = own.filter((l) => l.status !== 'cancelled');
          const counts = { prepared: 0, complete: 0, partial: 0, none: 0 };
          for (const line of live) {
            const prep = prepOf.get(String(line._id));
            if (prep === undefined) continue;
            counts[preparationStatusOf(prep, line.slots)] += 1;
          }
          return {
            planId: String(plan._id),
            bankCode: plan.bankCode,
            lines: live.length,
            ...counts,
            hasLines: own.length > 0,
          };
        })
        .filter((p) => p.hasLines)
        .map(({ hasLines: _hasLines, ...p }) => p),
    };
  }

  /** P2 — the plan's issued, prepared and cancelled lines, in serial order, with duplicates. */
  async lines(planId: string, ctx: AuthContext): Promise<AtmPreparationLineDto[]> {
    const plan = await atmSettlementPlanService.loadPlan(planId, ctx, VIEW);
    const lines = (
      await AtmPlanLineModel.find({
        planId: plan._id,
        status: { $in: ['issued', 'prepared', 'cancelled'] },
        isDeleted: false,
      })
        .lean<AtmPlanLineDoc[]>()
        .exec()
    ).sort(bySerial);
    const preps = await AtmLinePreparationModel.find({
      lineId: { $in: lines.map((l) => l._id) },
      isDeleted: false,
    })
      .lean<AtmLinePreparationDoc[]>()
      .exec();
    const prepOf = new Map(preps.map((p) => [String(p.lineId), p]));
    const duplicates = await findSealDuplicates(preps.flatMap(sealFieldsOf), ctx, VIEW);
    return lines.flatMap((line) => {
      const prep = prepOf.get(String(line._id));
      return prep === undefined
        ? []
        : [toPreparationLineDto(line, prep, duplicatesOfLine(prep, duplicates))];
    });
  }

  /** The preparation of a line through the view key's match (404), and capture reaching it (403). */
  private async loadForWrite(
    lineId: string,
    ctx: AuthContext,
  ): Promise<{ prep: AtmLinePreparationDoc; line: AtmPlanLineDoc }> {
    const prep = await AtmLinePreparationModel.findOne({
      $and: [{ lineId: asId(lineId), isDeleted: false }, branchScopeMatch(scopeSelector(ctx, VIEW))],
    } as FilterQuery<AtmLinePreparationDoc>)
      .lean<AtmLinePreparationDoc>()
      .exec();
    if (prep === null) throw new NotFoundError('no such line to prepare');
    if (!keyReachesBranch(ctx, CAPTURE, String(prep.branchId))) {
      throw new ForbiddenError('the capture key does not reach this branch');
    }
    const line = await AtmPlanLineModel.findOne({ _id: prep.lineId, isDeleted: false })
      .lean<AtmPlanLineDoc>()
      .exec();
    if (line === null) throw new NotFoundError('no such line to prepare');
    return { prep, line };
  }

  private async lineDtoOf(lineId: Types.ObjectId, ctx: AuthContext): Promise<AtmPreparationLineDto> {
    const [line, prep] = await Promise.all([
      AtmPlanLineModel.findOne({ _id: lineId, isDeleted: false }).lean<AtmPlanLineDoc>().exec(),
      AtmLinePreparationModel.findOne({ lineId, isDeleted: false })
        .lean<AtmLinePreparationDoc>()
        .exec(),
    ]);
    if (line === null || prep === null) throw new NotFoundError('no such line to prepare');
    const duplicates = await findSealDuplicates(sealFieldsOf(prep), ctx, VIEW);
    return toPreparationLineDto(line, prep, duplicatesOfLine(prep, duplicates));
  }

  /** P3 — save the scanned values of one line. */
  async save(
    lineId: string,
    input: SaveAtmPreparation,
    ctx: AuthContext,
  ): Promise<{ line: AtmPreparationLineDto }> {
    // 1. The preparation open, its line issued.
    const { prep, line } = await this.loadForWrite(lineId, ctx);
    if (prep.status === 'prepared' || line.status === 'cancelled') throw locked();
    if (line.status !== 'issued') throw lineStateError(line.status);

    // 2. Exactly the preparation's bags and bagged slots.
    const bagNumbers = prep.bags.map((b) => b.bag).sort();
    const bodyBags = input.bags.map((b) => b.bag).sort();
    if (
      bodyBags.length !== bagNumbers.length ||
      new Set(bodyBags).size !== bodyBags.length ||
      bodyBags.some((b, i) => b !== bagNumbers[i])
    ) {
      throw new ValidationError([
        { field: 'body.bags', code: 'UNKNOWN_BAG', message: 'the bags are not this line’s' },
      ]);
    }
    const slotNumbers = prep.seals.map((s) => s.slot).sort((a, b) => a - b);
    const bodySlots = input.seals.map((s) => s.slot).sort((a, b) => a - b);
    if (
      bodySlots.length !== slotNumbers.length ||
      new Set(bodySlots).size !== bodySlots.length ||
      bodySlots.some((s, i) => s !== slotNumbers[i])
    ) {
      throw new ValidationError([
        { field: 'body.seals', code: 'UNKNOWN_SLOT', message: 'the cassettes are not this line’s' },
      ]);
    }

    // 3. Clean, check and key every value; the message never repeats a value.
    const invalid: ApiErrorDetail[] = [];
    const bagValue = new Map<number, { qr: string | null; qrKey: string | null }>();
    input.bags.forEach((b, i) => {
      const qr = cleanScannedValue(b.qr);
      if (qr !== null && !AtmBagQrSchema.safeParse(qr).success) {
        invalid.push({ field: `bags[${String(i)}].qr`, code: 'INVALID_SEAL', message: 'not a bag QR' });
      }
      bagValue.set(b.bag, { qr, qrKey: qr === null ? null : sealKey(qr) });
    });
    const sealValue = new Map<number, { value: string | null; key: string | null }>();
    input.seals.forEach((s, i) => {
      const value = cleanScannedValue(s.value);
      if (value !== null && !AtmSealValueSchema.safeParse(value).success) {
        invalid.push({ field: `seals[${String(i)}].value`, code: 'INVALID_SEAL', message: 'not a seal' });
      }
      sealValue.set(s.slot, { value, key: value === null ? null : sealKey(value) });
    });
    if (invalid.length > 0) throw new ValidationError(invalid);
    const bags = prep.bags.map((b) => ({
      bag: b.bag,
      slots: [...b.slots],
      ...(bagValue.get(b.bag) ?? { qr: null, qrKey: null }),
    }));
    const seals = prep.seals.map((s) => ({
      slot: s.slot,
      ...(sealValue.get(s.slot) ?? { value: null, key: null }),
    }));

    // 4. One transaction, guarded by the preparation's version and status.
    await runSettlementHook('preparation.save.beforeWrite');
    const by = asId(ctx.userId);
    await unitOfWork(async (session) => {
      const saved = await AtmLinePreparationModel.updateOne(
        { _id: prep._id, lineId: prep.lineId, status: 'open', __v: input.version, isDeleted: false },
        {
          $set: {
            bags,
            seals,
            lastCapturedAt: new Date(),
            lastCapturedByName: actorName(ctx),
            updatedBy: by,
          },
          $inc: { __v: 1 },
        },
        { session },
      ).exec();
      if (saved.matchedCount !== 1) throw new StaleDocumentError();
    });

    // 5. The audit; 6. the line with its warnings and duplicates.
    const changes = diffChanges(captureSnapshot(prep), captureSnapshot({ bags, seals }));
    if (changes.length > 0) {
      await auditService.record({
        entityRef: preparationRef(String(prep._id)),
        action: 'update',
        changes,
      });
    }
    signalControlDay(String(prep.planId), String(prep.branchId));
    return { line: await this.lineDtoOf(prep.lineId, ctx) };
  }

  /** P4 — «تم التجهيز»: every required QR and seal present (DS-16); the line moves with it. */
  async prepared(
    lineId: string,
    input: AtmVersion,
    ctx: AuthContext,
  ): Promise<{ line: AtmPreparationLineDto }> {
    const { prep, line } = await this.loadForWrite(lineId, ctx);
    if (prep.status === 'prepared') throw locked();
    if (line.status !== 'issued') throw lineStateError(line.status);
    const missing = requiredMissing(prep, line.slots);
    if (missing.length > 0) {
      throw new AppError(
        ErrorCodes.ATM_PREPARATION_INCOMPLETE,
        422,
        'some required values are missing',
        { details: missing.map((field) => ({ field, code: 'REQUIRED', message: 'REQUIRED' })) },
      );
    }
    await runSettlementHook('preparation.prepared.beforeWrite');
    const by = asId(ctx.userId);
    const name = actorName(ctx);
    await unitOfWork(async (session) => {
      const now = new Date();
      const closed = await AtmLinePreparationModel.updateOne(
        { _id: prep._id, status: 'open', __v: input.version, isDeleted: false },
        {
          $set: {
            status: 'prepared',
            preparedAt: now,
            preparedBy: by,
            preparedByName: name,
            updatedBy: by,
          },
          $inc: { __v: 1 },
        },
        { session },
      ).exec();
      if (closed.matchedCount !== 1) throw new StaleDocumentError();
      const moved = await AtmPlanLineModel.updateOne(
        { _id: prep.lineId, status: 'issued', isDeleted: false },
        { $set: { status: 'prepared', updatedBy: by }, $inc: { __v: 1 } },
        { session },
      ).exec();
      if (moved.matchedCount !== 1) throw lineStateError(line.status);
    });
    await auditService.record({
      entityRef: preparationRef(String(prep._id)),
      action: 'statusChange',
      changes: [{ field: 'status', old: 'open', new: 'prepared' }],
    });
    await auditService.record({
      entityRef: lineRef(String(prep.lineId)),
      action: 'statusChange',
      changes: [{ field: 'status', old: 'issued', new: 'prepared' }],
    });
    signalControlDay(String(prep.planId), String(prep.branchId));
    return { line: await this.lineDtoOf(prep.lineId, ctx) };
  }

  /** P5 — a prepared line back to open / issued; no date lock (GS-16). */
  async reopen(
    lineId: string,
    input: AtmVersion,
    ctx: AuthContext,
  ): Promise<{ line: AtmPreparationLineDto }> {
    const { prep, line } = await this.loadForWrite(lineId, ctx);
    if (prep.status !== 'prepared' || line.status !== 'prepared') {
      throw lineStateError(line.status);
    }
    const by = asId(ctx.userId);
    await unitOfWork(async (session) => {
      const opened = await AtmLinePreparationModel.updateOne(
        { _id: prep._id, status: 'prepared', __v: input.version, isDeleted: false },
        {
          $set: {
            status: 'open',
            preparedAt: null,
            preparedBy: null,
            preparedByName: null,
            updatedBy: by,
          },
          $inc: { __v: 1 },
        },
        { session },
      ).exec();
      if (opened.matchedCount !== 1) throw new StaleDocumentError();
      const moved = await AtmPlanLineModel.updateOne(
        { _id: prep.lineId, status: 'prepared', isDeleted: false },
        { $set: { status: 'issued', updatedBy: by }, $inc: { __v: 1 } },
        { session },
      ).exec();
      if (moved.matchedCount !== 1) throw lineStateError(line.status);
    });
    await auditService.record({
      entityRef: preparationRef(String(prep._id)),
      action: 'statusChange',
      changes: [{ field: 'status', old: 'prepared', new: 'open' }],
    });
    await auditService.record({
      entityRef: lineRef(String(prep.lineId)),
      action: 'statusChange',
      changes: [{ field: 'status', old: 'prepared', new: 'issued' }],
    });
    signalControlDay(String(prep.planId), String(prep.branchId));
    return { line: await this.lineDtoOf(prep.lineId, ctx) };
  }
}

export const atmPreparationService = new AtmPreparationService();
