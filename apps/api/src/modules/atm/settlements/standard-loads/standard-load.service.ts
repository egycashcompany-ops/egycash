// Standard loads («الحمولة القياسية»): the count profiles per branch × bank that a plan line is
// filled from (S-3, DS-8; docs/12-planning/atm-settlements-phase1.md §6.4 S7–S10).
//
// READ (S7) is the OR of the layout page's and the plan page's matches, so a plan-only user sees the
// profiles their plan page offers. WRITES need `atmCassetteLayout.manage` reaching the profile's
// branch. ONE default per branch × bank: setting a new default clears the previous one in the same
// transaction, under its `__v`, and `ux_default` answers the race (409 `STALE_DOCUMENT`). A profile
// in use — by a live layout or by a DRAFT line — cannot be deleted; issued lines keep their own
// `standardNotes` and never read the profile again.
import {
  ErrorCodes,
  type AtmBankCode,
  type AtmDenominationNotes,
  type AtmSettlementBankQuery,
  type AtmStandardLoadDto,
  type SaveAtmStandardLoad,
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
import {
  hasPermission,
  keyReachesBranch,
  scopeSelector,
  type AuthContext,
} from '../../../../shared/types';
import { diffChanges } from '../../../../shared/utils/diff';
import { type PendingAudit } from '../../register/register-coupling';
import { branchScopeBranches, branchScopeMatch } from '../../shared/branch-scope';
import {
  branchMismatch,
  isDuplicateKey,
  requireWorkBranch,
} from '../shared/settlement-context';
import { AtmCassetteLayoutModel } from '../layouts/cassette-layout.model';
import { AtmPlanLineModel } from '../plans/plan-line.model';
import { AtmStandardLoadModel, type AtmStandardLoadDoc } from './standard-load.model';

const LAYOUT_VIEW = 'atmCassetteLayout.view';
const LAYOUT_MANAGE = 'atmCassetteLayout.manage';
const PLAN_VIEW = 'atmSettlementPlan.view';
const PLAN_MANAGE = 'atmSettlementPlan.manage';

const asId = (id: Types.ObjectId | string): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

/** DS-28: Σ notes × denomination × 100. */
export const notesEgpTotalMinor = (notes: readonly AtmDenominationNotes[]): number =>
  notes.reduce((sum, n) => sum + n.notes * n.denomination * 100, 0);

const plainNotes = (notes: readonly AtmDenominationNotes[]): AtmDenominationNotes[] =>
  notes.map((n) => ({ denomination: n.denomination, notes: n.notes }));

export const toStandardLoadDto = (doc: AtmStandardLoadDoc): AtmStandardLoadDto => ({
  id: String(doc._id),
  version: doc.__v,
  branchId: String(doc.branchId),
  bankCode: doc.bankCode,
  label: doc.label,
  isDefault: doc.isDefault,
  order: doc.order,
  notes: plainNotes(doc.notes),
  egpTotalMinor: notesEgpTotalMinor(doc.notes),
});

/** A branch × bank's live profiles, in `order`. */
export const liveStandardLoads = async (
  branchId: Types.ObjectId | string,
  bankCode: AtmBankCode,
  session?: ClientSession,
): Promise<AtmStandardLoadDoc[]> =>
  AtmStandardLoadModel.find({ branchId: asId(branchId), bankCode, isDeleted: false })
    .sort({ order: 1, _id: 1 })
    .session(session ?? null)
    .lean<AtmStandardLoadDoc[]>()
    .exec();

/**
 * The profile a line is filled from: the first of `candidates` that is still a live profile of the
 * branch and bank, else the bank's default, else none (§6.5 S14 step 4, S16 step 1).
 */
export const profileFor = (
  loads: readonly AtmStandardLoadDoc[],
  candidates: readonly (Types.ObjectId | string | null | undefined)[],
): AtmStandardLoadDoc | null => {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const found = loads.find((load) => String(load._id) === String(candidate));
    if (found !== undefined) return found;
  }
  return loads.find((load) => load.isDefault) ?? null;
};

const standardLoadRef = (id: string) => ({
  moduleId: 'atm',
  entityType: 'standardLoad',
  entityId: id,
});

const snapshot = (doc: Pick<AtmStandardLoadDoc, 'label' | 'isDefault' | 'notes'>) => ({
  label: doc.label,
  isDefault: doc.isDefault,
  notes: plainNotes(doc.notes),
});

const recordAll = async (audits: readonly PendingAudit[]): Promise<void> => {
  for (const audit of audits) await auditService.record(audit);
};

/** The read clause of S7: either page's match. */
const readMatch = (ctx: AuthContext): Record<string, unknown> => ({
  $or: [
    branchScopeMatch(scopeSelector(ctx, LAYOUT_VIEW)),
    branchScopeMatch(scopeSelector(ctx, PLAN_VIEW)),
  ],
});

const inReadReach = (ctx: AuthContext, branchId: string): boolean =>
  [LAYOUT_VIEW, PLAN_VIEW].some((key) => {
    if (!hasPermission(ctx, key)) return false;
    const reach = branchScopeBranches(scopeSelector(ctx, key));
    return reach === 'all' || reach.includes(branchId);
  });

/** Clears the branch × bank's previous default inside the caller's transaction. */
const clearPreviousDefault = async (
  branchId: Types.ObjectId,
  bankCode: AtmBankCode,
  exceptId: Types.ObjectId | null,
  by: Types.ObjectId,
  session: ClientSession,
): Promise<PendingAudit[]> => {
  const previous = await AtmStandardLoadModel.findOne({
    branchId,
    bankCode,
    isDefault: true,
    isDeleted: false,
    ...(exceptId === null ? {} : { _id: { $ne: exceptId } }),
  })
    .session(session)
    .lean<AtmStandardLoadDoc>()
    .exec();
  if (previous === null) return [];
  const cleared = await AtmStandardLoadModel.updateOne(
    { _id: previous._id, __v: previous.__v, isDefault: true, isDeleted: false },
    { $set: { isDefault: false, updatedBy: by }, $inc: { __v: 1 } },
    { session },
  ).exec();
  if (cleared.matchedCount !== 1) throw new StaleDocumentError();
  return [
    {
      entityRef: standardLoadRef(String(previous._id)),
      action: 'update',
      changes: diffChanges({ isDefault: true }, { isDefault: false }),
    },
  ];
};

class AtmStandardLoadService {
  /** S7 — the profiles of one branch × bank. */
  async list(query: AtmSettlementBankQuery, ctx: AuthContext): Promise<AtmStandardLoadDto[]> {
    let branchId: string;
    if (query.branchId !== undefined) {
      if (!inReadReach(ctx, query.branchId)) {
        throw new ValidationError([
          { field: 'query.branchId', code: 'OUT_OF_REACH', message: 'the branch is outside your reach' },
        ]);
      }
      branchId = query.branchId;
    } else {
      const pair = hasPermission(ctx, LAYOUT_VIEW)
        ? ([LAYOUT_VIEW, LAYOUT_MANAGE] as const)
        : ([PLAN_VIEW, PLAN_MANAGE] as const);
      branchId = (await requireWorkBranch(ctx, pair[0], pair[1])).branchId;
    }
    const docs = await AtmStandardLoadModel.find({
      $and: [
        { isDeleted: false },
        readMatch(ctx),
        { branchId: asId(branchId) },
        { bankCode: query.bankCode },
      ],
    } as FilterQuery<AtmStandardLoadDoc>)
      .sort({ order: 1, _id: 1 })
      .lean<AtmStandardLoadDoc[]>()
      .exec();
    return docs.map(toStandardLoadDto);
  }

  /** S8. */
  async create(input: SaveAtmStandardLoad, ctx: AuthContext): Promise<AtmStandardLoadDto> {
    const work = await requireWorkBranch(ctx, LAYOUT_VIEW, LAYOUT_MANAGE);
    if (input.branchId !== work.branchId) throw branchMismatch();
    if (!work.canWrite) throw new ForbiddenError('the layout key does not reach this branch');
    const branchId = asId(work.branchId);
    const by = asId(ctx.userId);

    let result: { doc: AtmStandardLoadDoc; audits: PendingAudit[] };
    try {
      result = await unitOfWork(async (session) => {
        const audits: PendingAudit[] = input.isDefault
          ? await clearPreviousDefault(branchId, input.bankCode, null, by, session)
          : [];
        const last = await AtmStandardLoadModel.findOne({ branchId, bankCode: input.bankCode })
          .sort({ order: -1 })
          .session(session)
          .lean<AtmStandardLoadDoc>()
          .exec();
        const [created] = await AtmStandardLoadModel.create(
          [
            {
              branchId,
              bankCode: input.bankCode,
              label: input.label === '' ? null : input.label,
              isDefault: input.isDefault,
              order: last === null ? 0 : last.order + 1,
              notes: input.notes,
              createdBy: by,
              updatedBy: by,
            },
          ],
          { session },
        );
        const doc = created?.toObject() as AtmStandardLoadDoc;
        audits.push({
          entityRef: standardLoadRef(String(doc._id)),
          action: 'create',
          changes: diffChanges({}, snapshot(doc)),
        });
        return { doc, audits };
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new StaleDocumentError();
      throw error;
    }
    await recordAll(result.audits);
    return toStandardLoadDto(result.doc);
  }

  /** The profile through the layout page's read match, then the manage key on its branch. */
  private async loadForWrite(id: string, ctx: AuthContext): Promise<AtmStandardLoadDoc> {
    const doc = await AtmStandardLoadModel.findOne({
      $and: [
        { _id: asId(id), isDeleted: false },
        branchScopeMatch(scopeSelector(ctx, LAYOUT_VIEW)),
      ],
    } as FilterQuery<AtmStandardLoadDoc>)
      .lean<AtmStandardLoadDoc>()
      .exec();
    if (doc === null) throw new NotFoundError('no such standard load');
    if (!keyReachesBranch(ctx, LAYOUT_MANAGE, String(doc.branchId))) {
      throw new ForbiddenError('the layout key does not reach this branch');
    }
    return doc;
  }

  /** S9. */
  async update(
    id: string,
    input: SaveAtmStandardLoad,
    ctx: AuthContext,
  ): Promise<AtmStandardLoadDto> {
    if (input.version === undefined) {
      throw new ValidationError([
        { field: 'body.version', code: 'REQUIRED', message: 'the version is required' },
      ]);
    }
    const version = input.version;
    const work = await requireWorkBranch(ctx, LAYOUT_VIEW, LAYOUT_MANAGE);
    if (input.branchId !== work.branchId) throw branchMismatch();
    const current = await this.loadForWrite(id, ctx);
    if (String(current.branchId) !== input.branchId) throw branchMismatch();
    if (current.bankCode !== input.bankCode) {
      throw new ValidationError([
        {
          field: 'body.bankCode',
          code: 'BANK_MISMATCH',
          message: 'a standard load keeps the bank it was created for',
        },
      ]);
    }
    const by = asId(ctx.userId);

    let result: { doc: AtmStandardLoadDoc; audits: PendingAudit[] };
    try {
      result = await unitOfWork(async (session) => {
        const audits: PendingAudit[] =
          input.isDefault && !current.isDefault
            ? await clearPreviousDefault(current.branchId, current.bankCode, current._id, by, session)
            : [];
        const updated = await AtmStandardLoadModel.findOneAndUpdate(
          { _id: current._id, __v: version, isDeleted: false },
          {
            $set: {
              label: input.label === '' ? null : input.label,
              isDefault: input.isDefault,
              notes: input.notes,
              updatedBy: by,
            },
            $inc: { __v: 1 },
          },
          { new: true, session },
        )
          .lean<AtmStandardLoadDoc>()
          .exec();
        if (updated === null) throw new StaleDocumentError();
        const changes = diffChanges(snapshot(current), snapshot(updated));
        if (changes.length > 0) {
          audits.push({ entityRef: standardLoadRef(id), action: 'update', changes });
        }
        return { doc: updated, audits };
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new StaleDocumentError();
      throw error;
    }
    await recordAll(result.audits);
    return toStandardLoadDto(result.doc);
  }

  /** S10 — refused while a live layout or a draft line points at the profile. */
  async remove(id: string, version: number, ctx: AuthContext): Promise<void> {
    const current = await this.loadForWrite(id, ctx);
    const by = asId(ctx.userId);
    await unitOfWork(async (session) => {
      const [layouts, draftLines] = await Promise.all([
        AtmCassetteLayoutModel.countDocuments({ standardLoadId: current._id, isDeleted: false })
          .session(session)
          .exec(),
        AtmPlanLineModel.countDocuments({
          standardLoadId: current._id,
          status: 'draft',
          isDeleted: false,
        })
          .session(session)
          .exec(),
      ]);
      if (layouts > 0 || draftLines > 0) {
        throw new AppError(
          ErrorCodes.ATM_STANDARD_LOAD_IN_USE,
          409,
          'the standard load is in use',
          {
            details: [
              { field: 'layouts', code: 'IN_USE', message: String(layouts) },
              { field: 'draftLines', code: 'IN_USE', message: String(draftLines) },
            ],
          },
        );
      }
      const deleted = await AtmStandardLoadModel.updateOne(
        { _id: current._id, __v: version, isDeleted: false },
        {
          $set: { isDeleted: true, deletedAt: new Date(), deletedBy: by, updatedBy: by },
          $inc: { __v: 1 },
        },
        { session },
      ).exec();
      if (deleted.matchedCount !== 1) throw new StaleDocumentError();
    });
    await auditService.record({
      entityRef: standardLoadRef(id),
      action: 'delete',
      changes: diffChanges(snapshot(current), {}),
    });
  }
}

export const atmStandardLoadService = new AtmStandardLoadService();
