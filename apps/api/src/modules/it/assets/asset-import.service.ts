// «رفع جماعي» — the asset register's bulk upload, as the screen asks it (design §12): a preview
// that writes nothing, then an apply of the lines the reviewer kept. «في الأصول عايز زرار Bulk Upload
// للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول للى هيتضاف ويوضح لو فى تكرار أو تضارب مع بيانات
// موجوده وهكذا» (2026-11-16).
//
// The decisions are `asset-import-plan.ts` (the go-live's planner); the writing is the go-live's
// own write path (`writeCustody` / `recordCustodyWritten`), with the caller as its actor. What this
// file adds is the live facts: the branch (active, and one the caller's `itAsset.create` reaches),
// the categories, the whole register, and how far each of the caller's grants reaches over the
// devices the plan touches.
//
// THE APPLY IS THE PREVIEW THAT WAS SEEN. It reads the same file again, plans again against the
// live register inside ONE transaction, and refuses (409) when the file or the plan's hash is not
// the preview's — somebody registered, moved or filled a device in between — and (422) when a row
// asked for is not a line of the file or cannot be written. Each device is written only as it was
// read in that transaction, so a save in between rolls the whole apply back. Audit rows and
// events follow the commit.
import { Types, type ClientSession } from 'mongoose';
import {
  ItAssetImportFieldsSchema,
  ItAssetImportKindCategoriesSchema,
  ItAssetImportRowsSchema,
  type ItAssetImportFields,
  type ItAssetImportPreviewDto,
  type ItAssetImportResultDto,
  type ItMoveTargetsDto,
} from '@ecms/contracts';
import {
  BusinessRuleError,
  ForbiddenError,
  StaleDocumentError,
  ValidationError,
} from '../../../shared/errors';
import {
  hasPermission,
  keyReachesBranch,
  scopeSelector,
  type AuthContext,
} from '../../../shared/types';
import { branchRepository } from '../../../platform/organization';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { ItCatalogItemModel } from '../catalog-items/catalog-item.model';
import {
  custodyAssetOf,
  readCustodyRegister,
  recordCustodyWritten,
  writeCustody,
  type CustodyNewAsset,
  type CustodyUpdate,
} from '../go-live/branch-custody';
import { newAssetSpecs, writesAsset } from '../go-live/branch-custody-import';
import type { LiveBranch, LiveCategory } from '../go-live/inventory-import';
import { itMaintenanceOrderRepository } from '../maintenance/order.repository';
import { itAssetRepository } from './asset.repository';
import { moveTargetBranchIds } from './asset-move';
import {
  assetImportPreview,
  importFileName,
  importRowsOf,
  importWords,
  kindCategoriesFor,
  kindsOf,
  moveCandidateIds,
  planAssetImport,
  planHashOf,
  plannedAssetIds,
  rowsToWrite,
  sha256Of,
  suggestedBranchOf,
  type AssetImportScope,
  type ImportPlannedLine,
} from './asset-import-plan';
import { isXlsxName, readAssetImportWorkbook, type AssetImportLine } from './asset-import-sheet';

/** What the audit rows name as the change's source — with the upload's own name. */
export const IT_ASSET_IMPORT_SOURCE = 'it:assets-import';

/** The upload as the controller hands it over: the bytes, their original name, the text fields. */
export interface AssetImportUpload {
  buffer: Buffer;
  fileName: string;
  fields: unknown;
}

export type AssetImportOutcome =
  | { kind: 'preview'; preview: ItAssetImportPreviewDto }
  | { kind: 'applied'; result: ItAssetImportResultDto };

/**
 * The active branches the caller's `itAsset.create` reaches as a whole — where an upload may
 * register, and so the only ones the sheet's name may suggest. The move's own list, asked of
 * another grant (`moveTargetBranchIds`).
 */
const creatableBranchIds = (
  ctx: AuthContext,
  branches: readonly { _id: unknown; status: 'active' | 'inactive' }[],
): string[] =>
  moveTargetBranchIds(
    ctx,
    'itAsset.create',
    branches.map((branch) => ({ id: String(branch._id), status: branch.status })),
  );

/** The history's actor, as custody's own entries name theirs. */
const actorNameOf = (ctx: AuthContext): string =>
  ctx.identity?.displayName?.[ctx.locale === 'ar' ? 'ar' : 'en'] ?? '';

/** A JSON text field, parsed and checked — a malformed one is the request's 400, never a guess. */
const jsonField = <T>(
  field: string,
  raw: string | undefined,
  parse: (value: unknown) => { success: true; data: T } | { success: false },
): T | undefined => {
  if (raw === undefined) return undefined;
  const refuse = (): never => {
    throw new ValidationError([
      { field, code: 'INVALID', message: `${field} is not valid JSON of its shape` },
    ]);
  };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return refuse();
  }
  const parsed = parse(value);
  return parsed.success ? parsed.data : refuse();
};

const fieldsOf = (raw: unknown): ItAssetImportFields => {
  const parsed = ItAssetImportFieldsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  return parsed.data;
};

class ItAssetImportService {
  /**
   * How far each grant reaches over the devices the plan touches — asked of the register under
   * that grant's own scope, as every read of it is. A grant the caller does not hold reaches none.
   */
  private async scopeOf(
    ids: readonly string[],
    branchId: string,
    ctx: AuthContext,
  ): Promise<AssetImportScope> {
    const within = async (key: string): Promise<Set<string>> => {
      if (ids.length === 0 || !hasPermission(ctx, key)) return new Set();
      const found = await itAssetRepository.idsMatching(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        scopeSelector(ctx, key),
      );
      return new Set(found.map(String));
    };
    const [visible, editable, assignable] = await Promise.all([
      within('itAsset.view'),
      within('itAsset.edit'),
      within('itAsset.assign'),
    ]);
    return {
      visible,
      editable,
      assignable,
      assignReachesBranch: keyReachesBranch(ctx, 'itAsset.assign', branchId),
    };
  }

  /**
   * The plan against the register as it stands — committed, or as read in `session`. The devices it
   * would move are asked whether an active maintenance order holds them — in the same `session`, as
   * custody's guard asks — and the plan is made again holding those back: an open order leaves a
   * device in stock, but the technician has it, and no change of branch takes it from them.
   */
  private async plan(
    input: {
      lines: readonly AssetImportLine[];
      branchId: string;
      categories: ReadonlyMap<string, string | null>;
    },
    ctx: AuthContext,
    session: ClientSession | null,
  ) {
    const registered = await readCustodyRegister(session);
    const planned = {
      ...input,
      register: registered.map((row) => ({
        ...custodyAssetOf(row),
        categoryId: String(row.categoryId),
      })),
    };
    const first = planAssetImport(planned);
    const maintained = await itMaintenanceOrderRepository.activeAssetIds(
      moveCandidateIds(first),
      session ?? undefined,
    );
    const plan = maintained.size === 0 ? first : planAssetImport({ ...planned, maintained });
    const rows = importRowsOf(plan, await this.scopeOf(plannedAssetIds(plan), input.branchId, ctx));
    return { registered, plan, rows, planHash: planHashOf(input.branchId, rows) };
  }

  /**
   * The branches the caller may register in — every ACTIVE branch their `itAsset.create` reaches as
   * a whole, by the very test the upload applies to the branch it is given
   * (`moveTargetBranchIds`), so the screen's picker never offers one the upload would answer with
   * 403 or refuse as inactive. In the branch options' order (by code).
   */
  async branches(ctx: AuthContext): Promise<ItMoveTargetsDto> {
    return { branchIds: creatableBranchIds(ctx, await branchRepository.listAll()) };
  }

  async run(upload: AssetImportUpload, ctx: AuthContext): Promise<AssetImportOutcome> {
    const fields = fieldsOf(upload.fields);
    const chosenCategories = jsonField('kindCategories', fields.kindCategories, (value) =>
      ItAssetImportKindCategoriesSchema.safeParse(value),
    );
    const wanted = jsonField('rows', fields.rows, (value) =>
      ItAssetImportRowsSchema.safeParse(value),
    );

    // The custody sheets are workbooks; nothing else is read.
    if (!isXlsxName(upload.fileName)) {
      throw new BusinessRuleError('only an .xlsx workbook is read — save the sheet as .xlsx');
    }
    const sheet = await readAssetImportWorkbook(upload.buffer);
    const fileSha256 = sha256Of(upload.buffer);

    // The branch: chosen on the screen, or — on a first preview — the one the sheet's name
    // suggests among those the caller may register in. Active, and reached by `itAsset.create`.
    const live = await branchRepository.listAll();
    const branches: LiveBranch[] = live.map((branch) => ({
      id: String(branch._id),
      name: branch.name,
      status: branch.status,
    }));
    const creatable = new Set(creatableBranchIds(ctx, live));
    const suggestedBranchId = suggestedBranchOf(
      sheet.sheetName,
      branches.filter((branch) => creatable.has(branch.id)),
    );
    // An id as the database spells it: `objectId()` admits upper-case hex.
    const branchId = fields.branchId?.toLowerCase() ?? suggestedBranchId;
    if (branchId === null) {
      throw new BusinessRuleError(
        "choose the branch the file is for — the sheet's name suggests none",
      );
    }
    if (!keyReachesBranch(ctx, 'itAsset.create', branchId)) {
      throw new ForbiddenError('itAsset.create does not reach this branch');
    }
    const branch = branches.find((candidate) => candidate.id === branchId);
    if (branch === undefined || branch.status !== 'active') {
      throw new ForbiddenError('the branch is not an active branch');
    }

    // Each kind's category: the one chosen — an active asset category, or the request is refused —
    // else the one matched by name.
    const liveCategories: LiveCategory[] = (
      await ItCatalogItemModel.find({ kind: 'assetCategory', isDeleted: false }).lean().exec()
    ).map((item) => ({ id: String(item._id), name: item.name, isActive: item.isActive }));
    const chosen = new Map<string, string>();
    for (const [kind, categoryId] of Object.entries(chosenCategories ?? {})) {
      const id = categoryId.toLowerCase();
      if (!liveCategories.some((category) => category.id === id && category.isActive)) {
        throw new BusinessRuleError(
          `the category chosen for «${kind}» is not an active asset category`,
        );
      }
      chosen.set(kind, id);
    }
    const categories = kindCategoriesFor(kindsOf(sheet.lines).keys(), liveCategories, chosen);
    const input = { lines: sheet.lines, branchId, categories };

    if (!fields.apply) {
      const { plan, rows } = await this.plan(input, ctx, null);
      return {
        kind: 'preview',
        preview: assetImportPreview({
          fileSha256,
          sheetName: sheet.sheetName,
          suggestedBranchId,
          plan,
          lines: sheet.lines,
          rows,
        }),
      };
    }

    const words = importWords(upload.fileName, branch.name.ar);
    const done = await unitOfWork(async (session) => {
      const { registered, rows, planHash } = await this.plan(input, ctx, session);
      const chosenRows = rowsToWrite(
        rows,
        { fileSha256: fields.fileSha256 ?? '', planHash: fields.planHash ?? '' },
        { fileSha256, planHash },
        wanted ?? [],
      );

      // Each kept row through the go-live's write path: a device found as its decision says, a
      // new line as a new asset in the branch's stock — its codes one reserved block.
      const rowOfUpdate = new Map<CustodyUpdate, number>();
      const creates: { row: number; asset: CustodyNewAsset }[] = [];
      for (const { dto, decision } of chosenRows) {
        if (decision === null) continue;
        if (decision.kind === 'create') {
          const planned = decision.row;
          creates.push({
            row: dto.row,
            asset: {
              name: planned.line.name ?? '',
              categoryId: new Types.ObjectId(dto.categoryId ?? ''),
              serialNumber: decision.serialNumber,
              externalTag: decision.externalTag,
              branchId,
              manufacturer: planned.manufacturer,
              model: planned.model,
              specs: newAssetSpecs(planned.specs),
              accessories: [...planned.accessories],
              notes: words.notes,
            },
          });
          continue;
        }
        if (!writesAsset<ImportPlannedLine>(decision)) continue;
        rowOfUpdate.set(
          {
            decision,
            updatedNote: words.updated(decision.fields),
            transferredNote: words.transferred(decision.move?.location ?? null),
          },
          dto.row,
        );
      }

      const written = await writeCustody(
        {
          register: new Map(registered.map((row) => [String(row._id), row])),
          updates: [...rowOfUpdate.keys()],
          creates: creates.map((create) => create.asset),
          at: new Date(),
          actor: { userId: ctx.userId, name: actorNameOf(ctx) },
          changed: () =>
            new StaleDocumentError('the register changed since the preview — preview again'),
        },
        session,
      );
      return { written, rowOfUpdate, creates, lines: rows.length };
    });

    // After the commit, as every registration, edit and transfer: the audit rows — the caller the
    // request's actor — and through them the realtime refresh, then the events.
    await recordCustodyWritten(
      done.written,
      `${IT_ASSET_IMPORT_SOURCE} «${importFileName(upload.fileName)}»`,
    );
    return { kind: 'applied', result: importResultOf(done) };
  }
}

/** What the apply did — its counts, and each asset written with the sheet row it came from. */
const importResultOf = (done: {
  written: Awaited<ReturnType<typeof writeCustody>>;
  rowOfUpdate: ReadonlyMap<CustodyUpdate, number>;
  creates: readonly { row: number }[];
  lines: number;
}): ItAssetImportResultDto => {
  const assets: ItAssetImportResultDto['assets'] = [
    ...done.written.assets.map((asset, index) => ({
      row: done.creates[index]?.row ?? 0,
      assetId: String(asset._id),
      assetCode: asset.assetCode,
      action: 'created' as const,
    })),
    ...done.written.updates.map(({ row, update }) => ({
      row: done.rowOfUpdate.get(update) ?? 0,
      assetId: String(row._id),
      assetCode: row.assetCode,
      action: update.decision.move === null ? ('filled' as const) : ('moved' as const),
    })),
  ].sort((a, b) => a.row - b.row);
  const count = (action: ItAssetImportResultDto['assets'][number]['action']): number =>
    assets.filter((asset) => asset.action === action).length;
  return {
    created: count('created'),
    filled: count('filled'),
    moved: count('moved'),
    unchanged: done.lines - assets.length,
    assets,
  };
};

export const itAssetImportService = new ItAssetImportService();
