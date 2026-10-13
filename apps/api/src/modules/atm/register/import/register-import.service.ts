// The register workbook import, end to end (spec §6): read → parse → plan, and — only when the
// caller named categories — apply, then plan again so the screen shows where things now stand.
//
// ONE endpoint, preview unless categories are named, the browser posting the same file twice and
// nothing kept on the server between the two calls — the roster import's shape
// (hr/employee-management/employees/employee-roster-import.ts). The preview and the apply walk the
// same code; `fileSha256` from the preview is what proves the applied bytes are the previewed ones.
//
// The upload's bytes live in this request only: no file is written, the run keeps the file's
// name, its hash and the header fills, and nothing about a row but its number and its outcome.
import { createHash } from 'node:crypto';
import {
  ErrorCodes,
  type AtmRegisterImportCategory,
  type AtmRegisterImportResultDto,
  type AtmRegisterImportRunDto,
} from '@ecms/contracts';
import { AppError, ConflictError, ForbiddenError } from '../../../../shared/errors';
import { hasPermission, type AuthContext } from '../../../../shared/types';
import { cairoDateString } from '../../shared/cairo-time';
import { applyRegisterImport, type ApplyImportResult } from './apply-import';
import { parseRegisterRows, type ParsedRegisterFile } from './parse-rows';
import { loadPlanWorld, planRegisterImport, type ImportPlan } from './plan-import';
import { readRegisterWorkbook } from './read-register-workbook';
import {
  AtmRegisterImportRunModel,
  type AtmRegisterImportRunDoc,
} from './register-import-run.model';

export interface RegisterImportRequest {
  buffer: Buffer;
  fileName: string;
  /** Empty → preview. Unknown names were already dropped by the controller. */
  apply: AtmRegisterImportCategory[];
  /** The preview's hash — required to apply. */
  fileSha256: string | null;
  reportOverride: boolean;
}

const toResult = (
  mode: 'preview' | 'applied',
  request: RegisterImportRequest,
  fileSha256: string,
  parsed: ParsedRegisterFile,
  plan: ImportPlan,
  applied: ApplyImportResult | null,
): AtmRegisterImportResultDto => ({
  mode,
  fileName: request.fileName,
  fileSha256,
  sheet: { firstDataRow: 3, lastDataRow: parsed.lastDataRow, sentinelRow: parsed.sentinelRow },
  counts: plan.counts,
  blockers: plan.blockers,
  report: plan.report,
  issues: plan.issues,
  branches: plan.branches,
  categories: plan.categories,
  applied:
    applied === null
      ? null
      : {
          runId: applied.runId,
          categories: request.apply,
          reportOverride: request.reportOverride,
          counts: applied.counts,
        },
});

const toRunDto = (doc: Omit<AtmRegisterImportRunDoc, 'rows'>): AtmRegisterImportRunDto => ({
  id: String(doc._id),
  fileName: doc.fileName,
  fileSha256: doc.fileSha256,
  state: doc.state,
  startedAt: doc.startedAt.toISOString(),
  finishedAt: doc.finishedAt === null ? null : doc.finishedAt.toISOString(),
  actorName: doc.actorName,
  categories: doc.categories as AtmRegisterImportCategory[],
  reportOverride: doc.reportOverride,
  counts: doc.counts,
});

class AtmRegisterImportService {
  async run(request: RegisterImportRequest, ctx: AuthContext): Promise<AtmRegisterImportResultDto> {
    const applying = request.apply.length > 0;
    // DEC-7: an apply writes key values and combinations, so it needs the key that reads them.
    // Per-branch reach is the plan's `secretsOutOfReach`; this is the "not at all" case.
    if (applying && !hasPermission(ctx, 'atmRegister.viewSecrets')) {
      throw new ForbiddenError('applying the register import needs atmRegister.viewSecrets');
    }
    const fileSha256 = createHash('sha256').update(request.buffer).digest('hex');
    if (applying && request.fileSha256 !== fileSha256) {
      throw new ConflictError(
        'the file changed since the preview — preview it again',
        ErrorCodes.ATM_REGISTER_IMPORT_FILE_CHANGED,
      );
    }

    const read = await readRegisterWorkbook(request.buffer);
    const parsed = parseRegisterRows(read, { today: cairoDateString(new Date()) });
    const world = await loadPlanWorld(parsed, ctx);
    const plan = planRegisterImport(parsed, world, ctx);
    if (!applying) return toResult('preview', request, fileSha256, parsed, plan, null);

    // Every blocker stops the apply; only the report mismatch can be overridden, and only
    // explicitly (D8).
    const standing = plan.blockers.filter((b) => b !== 'reportMismatch' || !request.reportOverride);
    if (standing.length > 0) {
      throw new AppError(
        ErrorCodes.ATM_REGISTER_IMPORT_BLOCKED,
        422,
        'the import cannot be applied yet',
        { details: standing.map((code) => ({ field: 'blockers', code, message: code })) },
      );
    }

    const applied = await applyRegisterImport(
      plan,
      world.settings,
      {
        categories: request.apply,
        reportOverride: request.reportOverride,
        fileName: request.fileName,
        fileSha256,
      },
      parsed.headerFills,
      ctx,
    );
    const after = planRegisterImport(parsed, await loadPlanWorld(parsed, ctx), ctx);
    return toResult('applied', request, fileSha256, parsed, after, applied);
  }

  /** GET /runs — newest first, at most 50, never the per-row outcomes. */
  async listRuns(): Promise<AtmRegisterImportRunDto[]> {
    const docs = await AtmRegisterImportRunModel.find({}, { rows: 0 })
      .sort({ startedAt: -1 })
      .limit(50)
      .lean<Omit<AtmRegisterImportRunDoc, 'rows'>[]>()
      .exec();
    return docs.map(toRunDto);
  }
}

export const atmRegisterImportService = new AtmRegisterImportService();
