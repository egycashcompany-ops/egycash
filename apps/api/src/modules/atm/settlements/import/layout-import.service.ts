// The Full list seed import, end to end (S-1; docs/12-planning/atm-settlements-phase1.md §5): read →
// plan, and — only on an apply — write, then plan again so the screen shows where things now stand.
//
// ONE endpoint, preview unless `apply` is exactly 'true', the browser posting the same file twice
// and nothing kept on the server between the two calls — the register import's shape. `fileSha256`
// from the preview proves the applied bytes are the previewed ones; `previewRevisions` proves no
// layout moved since (SEC-8). A preview writes nothing at all: no run row, no audit.
//
// THE IMPORT BRANCH is the import page's work branch (`atmCassetteLayout.view` /
// `.import`); the request names it and must agree (400 `BRANCH_MISMATCH`). Machines, layouts,
// register entries and standard loads are read in that branch only.
import { createHash } from 'node:crypto';
import {
  ErrorCodes,
  type AtmLayoutImportResultDto,
  type LayoutImportFields,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { ConflictError, ForbiddenError } from '../../../../shared/errors';
import { scopeSelector, type AuthContext } from '../../../../shared/types';
import { AtmMachineModel, type AtmMachineDoc } from '../../machines/machine.model';
import { branchScopeMatch } from '../../shared/branch-scope';
import { liveLayoutsByMachine } from '../layouts/layout.repository';
import { type AtmCassetteLayoutDoc } from '../layouts/cassette-layout.model';
import { registerRowsByMachine } from '../shared/register-bank';
import { branchMismatch, requireWorkBranch } from '../shared/settlement-context';
import { liveStandardLoads } from '../standard-loads/standard-load.service';
import { applyLayoutImport } from './apply-layout-import';
import { masterProfileOf } from './master-profiles';
import {
  planLayoutImport,
  type LayoutImportLayout,
  type LayoutImportPlan,
  type LayoutImportWorld,
} from './plan-layout-import';
import { readMasterWorkbook, type MasterWorkbookRead } from './read-master-workbook';

const VIEW = 'atmCassetteLayout.view';
const IMPORT = 'atmCassetteLayout.import';

export interface LayoutImportRequest {
  buffer: Buffer;
  fileName: string;
  fields: LayoutImportFields;
}

type WorldMachine = Pick<
  AtmMachineDoc,
  '_id' | 'machineCode' | 'name' | 'area' | 'bankName' | 'isActive'
>;

/** The world §5.3 decides against, read in the import branch only — and the layout documents. */
const loadWorld = async (
  branchId: string,
  fields: LayoutImportFields,
  ctx: AuthContext,
): Promise<{ world: LayoutImportWorld; layouts: Map<string, AtmCassetteLayoutDoc> }> => {
  const machines = await AtmMachineModel.find(
    {
      $and: [
        { isDeleted: false },
        branchScopeMatch(scopeSelector(ctx, VIEW)),
        { branchId: new Types.ObjectId(branchId) },
      ],
    } as FilterQuery<AtmMachineDoc>,
    { machineCode: 1, name: 1, area: 1, bankName: 1, isActive: 1 },
  )
    .lean<WorldMachine[]>()
    .exec();
  const ids = machines.map((m) => m._id);
  const [registerRows, layouts, loads] = await Promise.all([
    registerRowsByMachine(ids),
    liveLayoutsByMachine(ids),
    liveStandardLoads(branchId, fields.bankCode),
  ]);
  const worldLayouts = new Map<string, LayoutImportLayout>(
    [...layouts].map(([machineId, doc]) => [
      machineId,
      {
        revision: doc.revision,
        slots: doc.slots,
        typeLabel: doc.typeLabel,
        featuresLabel: doc.featuresLabel,
        hubLabel: doc.hubLabel,
        source: doc.source,
      },
    ]),
  );
  return {
    world: {
      bankCode: fields.bankCode,
      machines: machines.map((m) => ({
        id: String(m._id),
        machineCode: m.machineCode,
        name: m.name,
        area: m.area,
        bankName: m.bankName,
        isActive: m.isActive,
      })),
      registerRows,
      layouts: worldLayouts,
      standardLoads: loads.map((load) => ({ notes: load.notes })),
    },
    layouts,
  };
};

const toResult = (
  request: LayoutImportRequest,
  branchId: string,
  fileSha256: string,
  plan: LayoutImportPlan,
  applyCounts: AtmLayoutImportResultDto['applyCounts'],
): AtmLayoutImportResultDto => ({
  applied: applyCounts !== null,
  fileName: request.fileName,
  fileSha256,
  bankCode: request.fields.bankCode,
  branchId,
  counts: plan.counts,
  flags: plan.flags,
  rows: plan.rows,
  missingFromFile: plan.missingFromFile,
  standardLoads: plan.standardLoads,
  applyCounts,
});

class AtmLayoutImportService {
  /** S4 — a preview, or an apply of the previewed file. */
  async run(request: LayoutImportRequest, ctx: AuthContext): Promise<AtmLayoutImportResultDto> {
    const { fields } = request;
    const work = await requireWorkBranch(ctx, VIEW, IMPORT);
    if (fields.branchId !== work.branchId) throw branchMismatch('branchId');
    if (fields.apply && !work.canWrite) {
      throw new ForbiddenError('the import key does not reach this branch');
    }
    const profile = masterProfileOf(fields.bankCode);
    const fileSha256 = createHash('sha256').update(request.buffer).digest('hex');
    if (fields.apply && fields.fileSha256 !== fileSha256) {
      throw new ConflictError(
        'the file changed since the preview — preview it again',
        ErrorCodes.ATM_LAYOUT_IMPORT_FILE_CHANGED,
      );
    }

    const read: MasterWorkbookRead = await readMasterWorkbook(request.buffer, profile);
    const { world, layouts } = await loadWorld(work.branchId, fields, ctx);
    const plan = planLayoutImport(read, world);
    if (!fields.apply || fields.mode === undefined) {
      return toResult(request, work.branchId, fileSha256, plan, null);
    }

    const applied = await applyLayoutImport(
      plan,
      layouts,
      {
        branchId: work.branchId,
        bankCode: fields.bankCode,
        fileName: request.fileName,
        fileSha256,
        mode: fields.mode,
        standardLoads: fields.standardLoads,
        previewRevisions: fields.previewRevisions ?? [],
      },
      ctx,
    );
    const after = planLayoutImport(read, (await loadWorld(work.branchId, fields, ctx)).world);
    return toResult(request, work.branchId, fileSha256, after, applied.counts);
  }
}

export const atmLayoutImportService = new AtmLayoutImportService();
