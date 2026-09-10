// The employees screen's upload button, on the HTTP side.
//
// ONE endpoint and a `preview` flag rather than two, because a preview that walked a different code
// path from the apply would be reassuring about something nobody is going to do — the same rule the
// CLI's dry run already follows. The browser holds the file and posts it twice: once to see what
// would happen, once to make it happen. Nothing is stored between the two, so there is no token to
// expire, no cache to depend on, and no window in which a half-agreed import can be resumed.
//
// THE BOOT GUARD IS NOT REPEATED HERE, and that is deliberate. `HR_PROVISION_MISSING_LOGINS=true`
// makes the API send a setup link to every employee without a login at BOOT — long before this
// route can be called. A check at this point would be theatre: the messages are already gone. The
// guard lives where the damage is done (`workforce-boot-guard.ts`), and the CLI, which starts its
// own process, is where it has something to protect.
import { type Request, type Response } from 'express';
import { type RosterImportReportDto } from '@ecms/contracts';
import { ok } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { AppError } from '../../../../shared/errors';
import { ErrorCodes } from '@ecms/contracts';
import {
  ALL_IMPORT_ACTIONS,
  runImport,
  UPDATE_SAMPLE,
  type ImportAction,
  type ImportReport,
} from '../../../../workforce-import/run';

/** Excel only. A 3,000-row roster is well under this; the cap is against a mistake, not a size. */
export const ROSTER_MAX_MB = 20;

/**
 * Which kinds of write the caller agreed to.
 *
 * A multipart field arrives as a string, so it is read as one: a comma-separated list of the action
 * names. ANYTHING UNRECOGNISED IS DROPPED rather than treated as "all" — the default has to be the
 * harmless one, so a malformed request previews instead of writing to two thousand records.
 */
const requestedActions = (raw: unknown): Set<ImportAction> => {
  const names = String(raw ?? '')
    .split(',')
    .map((s) => s.trim());
  return new Set(ALL_IMPORT_ACTIONS.filter((a) => names.includes(a)));
};

const toDto = (report: ImportReport): RosterImportReportDto => ({
  mode: report.applied.length > 0 ? 'applied' : 'preview',
  applied: report.applied,
  counts: {
    rowsRead: report.counts.rowsRead,
    people: report.counts.people,
    imported: report.counts.imported,
    unchanged: report.counts.unchanged,
    updated: report.counts.updated,
    exits: report.counts.exits,
    failed: report.counts.failed,
    branchesCreated: report.counts.branchesCreated,
    departmentsCreated: report.counts.departmentsCreated,
    sectionsCreated: report.counts.sectionsCreated,
    jobTitlesCreated: report.counts.jobTitlesCreated,
  },
  // Said out loud rather than left for the reader to infer from a list that stops: a screen showing
  // 200 of 2,600 changes without saying so reads as "these are all of them".
  sampled:
    report.counts.updated > UPDATE_SAMPLE ||
    report.counts.imported > UPDATE_SAMPLE ||
    report.counts.exits > UPDATE_SAMPLE,
  updates: report.updates,
  additions: report.additions,
  exits: report.exits,
  refused: report.refused,
  rejected: report.rejected.map((r) => ({
    sheet: String(r.sheet),
    rowNumber: r.rowNumber,
    code: r.code,
    reason: r.reason,
  })),
  orgProblems: report.orgProblems,
});

export const importEmployeeRoster = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const file = (req as Request & { file?: { buffer: Buffer } }).file;
  if (file === undefined) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, 422, 'no workbook was uploaded');
  }
  // The default is the harmless one: with nothing named, nothing is written.
  const apply = requestedActions((req.body as { apply?: unknown }).apply);

  let report: ImportReport;
  try {
    report = await runImport({ file: { buffer: file.buffer }, apply, actorId: ctx.userId });
  } catch (error) {
    // A workbook with the wrong sheets or headers is the caller's file, not a server fault — it
    // has to come back as something the screen can show next to the upload button.
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(ErrorCodes.VALIDATION_FAILED, 422, message);
  }
  ok(res, toDto(report));
};
