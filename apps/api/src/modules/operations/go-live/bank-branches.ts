// The owner's four banks' branch lists, loaded into «البيانات المرجعية» once, by the deploy
// (Round 29b). «عاوز اضيف دول فى البيانات المرجعية تبع (الفروع والبنوك والمناطق) ملحوظه هتلاقى area دى
// ضيفها ل منطقة العمليات و منطقة الحسابات تمام ؟» — and, offered the upload screen Round 29 built
// beside «إضافة فرع» or the deploy's own load: «انا عاوز الداتا اللى باعتهالك دى تتضاف … نفذها».
//
// THE DATA is `assets/operations-go-live/bank-branches-<bank>-2026-11.json`, one file per bank: the
// rows of his sheet as the import's own reader read them (`read-branch-sheet.ts`), and, apart, the
// rows left out with why — the two of «بنك مصر» whose name Excel had turned into a date (the name
// as typed is lost; they are added by hand). This step logs them on every load.
//
// THE RULES ARE THE IMPORT'S, run by the import's own code. Each file is planned by
// `planBranchImport` against the bank's branches and «المناطق» as they are inside the transaction,
// and written by `writeBranchImport` — the very path «تأكيد الاستيراد» writes through: the sheet's
// area into both «منطقة العمليات» and «منطقة الحسابات»; an area «المناطق» lacks created (Arabic name
// and English `nameEn`), a held one reused by its folded name and its empty English name filled; a
// branch the bank holds by name given the sheet's code and area (an empty cell never wipes; an
// address only where it has none); a repeated code «-2», «-3», … past every suffix in use; names
// tidied. What the planner refuses (a name twice, a new branch with no code …) is not written, and
// is in the log and the run row.
//
// WHAT NOBODY HAS LOOKED AT IS NOT WRITTEN (`bank-branches-plan.ts`, Round 29b critic). The import's
// screen shows a person the rows that may be a branch the bank already holds — its name spelt
// another way, its code on a branch of another name — before «تأكيد الاستيراد»; the deploy has no
// one to show them to, so it holds them back, and lists each with the held branch it may be. A
// person adds them through «استيراد من شيت», where the same file shows them again. Every held
// branch the load edits is kept in the run row with what it held before — the sheet's area
// replaces both of a held branch's areas (the owner's «حدّث الكود والمنطقة»), and `areasReplaced`
// counts the ones that had an area.
//
// THE BANK is found by name (`bank-branches-banks.ts`): exactly one → that bank; none, and none
// that looks like it → created; anything a person must settle — two banks, one another file's names
// find too, a look-alike («بنك مصر إيران», «NBE FOREX»), a stopped bank → the file is SKIPPED,
// writing nothing but its run row (`status: 'skipped'`, why, and the banks). That is final: no
// later boot loads the file, so a sheet of November never lands months later over what operators
// have kept since (Round 29b critic). The sheet goes through «استيراد من شيت», with its preview.
//
// ONCE PER DATABASE, PER BANK, ALL OR NOTHING (`go-live-run.model.ts`). Each bank is ONE
// transaction — the bank created if missing, its new areas first, the English names filled, the
// edits, the new branches — whose last write is that bank's run row. They commit together or not at
// all: a failure leaves neither the row nor any of the data. Once the row is in, no later boot
// touches the bank's file again, so a branch or an area an operator edits or deletes afterwards
// stays exactly as he left it. The banks go one after another, so a later file reuses the areas an
// earlier one created. A second process racing the first meets it on the run row's unique key; its
// transaction is retried, finds the row, and writes nothing.
//
// A FAILURE IS TRIED AGAIN FOR A WEEK, THEN NEVER. A bank whose load throws (or whose file this
// build lacks) is counted under `<key>:failed` — when it first failed, how often, the last error —
// and tried again on the next boot; the first boot `BANK_BRANCHES_RETRY_DAYS` after its first
// failure gives up instead, writing the run row `status: 'gaveUp'`. A failure that clears months
// later loads nothing.
//
// WHO WROTE IT: nobody — `by: null`, the platform's system actor every boot step writes as (the
// audit trail shows no person). The trail follows each commit, as the import's does: the bank's
// add when it was created, then the catalog's own add and edit entries, each marked with the run.
//
// THE API ONLY, unlike the Fleet and IT loads: one process is enough for a few thousand rows of
// reference data, and it never races itself on an ordinary deploy. The run row settles one anyway.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService, type AuditEntry } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsAreaRepository } from '../areas/area.repository';
import { operationsBankBranchRepository } from '../bank-branches/bank-branch.repository';
import {
  branchImportAudits,
  heldAreaOf,
  heldBranchOf,
  writeBranchImport,
  type BranchImportWritten,
} from '../bank-branches/import/branch-import.service';
import { OperationsBankModel, type OperationsBankDoc } from '../banks/bank.model';
import { operationsBankRepository } from '../banks/bank.repository';
import { bankEntityRef, bankSnapshot } from '../banks/bank.service';
import {
  OPERATIONS_BRANCH_LOAD_BANKS,
  nextBankCode,
  parseBankBranchesFile,
  resolveLoadBank,
  type BankBranchesFile,
  type LiveBank,
  type OperationsBranchLoadBank,
  type OperationsBranchLoadBankKey,
} from './bank-branches-banks';
import {
  planBankLoad,
  type BankLoadAreaNoteRow,
  type BankLoadChangedRow,
  type BankLoadHeldBackRow,
  type BankLoadPlan,
} from './bank-branches-plan';
import {
  ensureOperationsGoLiveRunIndexes,
  isOperationsGoLiveRunDone,
  operationsGoLiveFailuresOf,
  recordOperationsGoLiveFailure,
  recordOperationsGoLiveRun,
  recordOperationsGoLiveRunAlone,
} from './go-live-run.model';

/** A bank's run key — versioned, so loading a file again is a decision, never a redeploy's accident. */
export const bankBranchesLoadMark = (bank: OperationsBranchLoadBankKey): string =>
  `go-live:operations-bank-branches-2026-11:${bank}:v1`;

/** How long a bank whose load fails is tried again, from its first failure: then never. */
export const BANK_BRANCHES_RETRY_DAYS = 7;
const RETRY_MS = BANK_BRANCHES_RETRY_DAYS * 24 * 60 * 60 * 1000;

/**
 * Where the committed files sit at run time: beside the bundle in the deployed image (`tsup`'s
 * `publicDir` copies `assets/` into `dist/`), four levels up under `tsx` — the IT steps' two places,
 * each checked before it is used.
 */
const DATA_DIR_CANDIDATES = ['operations-go-live', '../../../../assets/operations-go-live'];

export const resolveBankBranchesFile = (file: string, dataDir?: string): string | null => {
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs =
    dataDir === undefined ? DATA_DIR_CANDIDATES.map((dir) => join(here, dir)) : [dataDir];
  for (const dir of dirs) {
    const path = join(dir, file);
    if (existsSync(path)) return path;
  }
  return null;
};

/** What one bank's load wrote — the run row's outcome, and the log line. */
export interface BankBranchesLoadReport {
  bank: OperationsBranchLoadBankKey;
  bankId: string;
  bankName: string;
  bankCreated: boolean;
  /** The sheet's branch rows the reader read, the left-out ones included. */
  rowsRead: number;
  /** Rows the file leaves out (a date for a name) — never planned. */
  leftOut: { row: number; problem: string; code: string | null }[];
  new: number;
  updated: number;
  unchanged: number;
  /** «كود معدَّل» — the suffixed codes written (`counts.suffixed`). */
  suffixed: number;
  /** Rows the planner refused, written nothing. */
  problems: number;
  problemRows: { row: number; problem: string }[];
  /** Rows that may be a branch the bank holds — written nothing, for a person (`bank-branches-plan.ts`). */
  heldBack: BankLoadHeldBackRow[];
  areasCreated: number;
  areasFilled: number;
  /** Every held branch edited, with what it held before. */
  changed: BankLoadChangedRow[];
  /** Of `changed`, the branches whose «منطقة العمليات» or «منطقة الحسابات» had a value, now replaced. */
  areasReplaced: number;
  /** Rows whose area is a held one found by its English name, or whose English is another's. */
  areaNotes: BankLoadAreaNoteRow[];
}

export type BankBranchesSkipReason =
  'severalBanks' | 'anotherFilesBank' | 'lookalikeBanks' | 'bankStopped' | 'notInThisBuild';

export type BankBranchesLoadOutcome =
  | { status: 'alreadyDone'; bank: OperationsBranchLoadBankKey }
  | {
      status: 'skipped';
      bank: OperationsBranchLoadBankKey;
      reason: BankBranchesSkipReason;
      banks: { id: string; opsName: string }[];
    }
  | {
      status: 'gaveUp';
      bank: OperationsBranchLoadBankKey;
      failures: number;
      firstFailedAt: Date;
      lastError: string;
    }
  | ({ status: 'done' } & BankBranchesLoadReport);

export interface BankBranchesLoadOptions {
  /** Where the files are read from — the build's own place when omitted (a test passes its own). */
  dataDir?: string;
  /** The boot's clock — now when omitted (a test passes a later day). */
  now?: Date;
}

const liveBankOf = (doc: OperationsBankDoc): LiveBank => ({
  id: String(doc._id),
  opsName: doc.opsName,
  name: { ar: doc.name.ar, en: doc.name.en },
  isActive: doc.isActive,
});

const reportOf = (
  target: OperationsBranchLoadBank,
  bank: OperationsBankDoc,
  bankCreated: boolean,
  file: BankBranchesFile,
  load: BankLoadPlan,
  written: BranchImportWritten,
): BankBranchesLoadReport => ({
  bank: target.key,
  bankId: String(bank._id),
  bankName: bank.opsName,
  bankCreated,
  rowsRead: file.rowsRead,
  leftOut: file.leftOut.map(({ row, problem, code }) => ({ row, problem, code })),
  new: written.branchesCreated.length,
  updated: written.branchesUpdated.length,
  unchanged: load.plan.counts.unchanged,
  suffixed: load.plan.counts.suffixed,
  problems: load.problemRows.length,
  problemRows: load.problemRows,
  heldBack: load.heldBack,
  areasCreated: written.areasCreated.length,
  areasFilled: written.areasFilled.length,
  changed: load.changed,
  areasReplaced: load.areasReplaced,
  areaNotes: load.areaNotes,
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** One more failed try, counted — never the reason a boot fails. */
const countFailure = async (mark: string, error: string, at: Date): Promise<void> => {
  try {
    await recordOperationsGoLiveFailure(mark, error, at);
  } catch (err) {
    logger.error({ err, mark }, 'operations go-live: a failed try could not be counted');
  }
};

/**
 * Load one bank's file, once. Exported so a test can drive it against a real database. Throws when
 * the transaction fails — nothing of it is kept, the failure is counted, and the next boot tries
 * again until its days are past.
 */
export const loadBankBranches = async (
  target: OperationsBranchLoadBank,
  options: BankBranchesLoadOptions = {},
): Promise<BankBranchesLoadOutcome> => {
  const mark = bankBranchesLoadMark(target.key);
  const now = options.now ?? new Date();
  // A run that is over is asked first, outside any transaction, so a boot after it reads nothing
  // else. The check inside the transaction still settles two processes racing.
  if (await isOperationsGoLiveRunDone(mark)) return { status: 'alreadyDone', bank: target.key };

  // Failing since more than its days: give up, for good — whatever cleared it since.
  const failures = await operationsGoLiveFailuresOf(mark);
  if (failures !== null && now.getTime() - failures.firstFailedAt.getTime() >= RETRY_MS) {
    const gaveUp = {
      status: 'gaveUp' as const,
      bank: target.key,
      failures: failures.failures,
      firstFailedAt: failures.firstFailedAt,
      lastError: failures.lastError,
    };
    await ensureOperationsGoLiveRunIndexes();
    const wrote = await recordOperationsGoLiveRunAlone(mark, { ...gaveUp });
    return wrote ? gaveUp : { status: 'alreadyDone', bank: target.key };
  }

  const path = resolveBankBranchesFile(target.file, options.dataDir);
  if (path === null) {
    await countFailure(mark, 'notInThisBuild: its file is not in this build', now);
    return { status: 'skipped', bank: target.key, reason: 'notInThisBuild', banks: [] };
  }

  let run;
  try {
    const file = parseBankBranchesFile(JSON.parse(await readFile(path, 'utf8')));
    if (file.bank !== target.key) throw new Error(`${target.file} is another bank's file`);
    await ensureOperationsGoLiveRunIndexes();
    run = await unitOfWork(async (session) => {
      if (await isOperationsGoLiveRunDone(mark, session)) return { kind: 'alreadyDone' as const };

      // «البنوك» as it is now, inside the transaction — deleted banks only for the next code.
      const banks = await OperationsBankModel.find({})
        .sort({ _id: 1 })
        .session(session)
        .lean<OperationsBankDoc[]>()
        .exec();
      const live = banks.filter((bank) => !bank.isDeleted);
      const resolution = resolveLoadBank(target, live.map(liveBankOf));
      const skip =
        resolution.kind === 'ambiguous'
          ? {
              reason: resolution.reason,
              banks: resolution.banks.map(({ id, opsName }) => ({ id, opsName })),
            }
          : resolution.kind === 'found' && !resolution.bank.isActive
            ? {
                reason: 'bankStopped' as const,
                banks: [{ id: resolution.bank.id, opsName: resolution.bank.opsName }],
              }
            : null;
      if (skip !== null) {
        // Final: the file is never loaded by a later boot — the run row says why, and which banks.
        await recordOperationsGoLiveRun(
          mark,
          { status: 'skipped', bank: target.key, rowsRead: file.rowsRead, ...skip },
          session,
        );
        return { kind: 'skipped' as const, ...skip };
      }

      const meta = { by: null, session };
      const bankCreated = resolution.kind === 'missing';
      const bank =
        resolution.kind === 'found'
          ? (live.find((doc) => String(doc._id) === resolution.bank.id) as OperationsBankDoc)
          : await operationsBankRepository.create(
              {
                code: nextBankCode(banks.map((doc) => doc.code)),
                name: { ...target.create.name },
                opsName: target.create.opsName,
                slogan: null,
                sortOrder: null,
                isActive: true,
              },
              meta,
            );
      const bankId = String(bank._id);

      // One read after the other: a transaction's session runs one operation at a time.
      const branchDocs = await operationsBankBranchRepository.liveOfBank(bankId, session);
      const areaDocs = await operationsAreaRepository.liveAll(session);
      const load = planBankLoad(file, branchDocs.map(heldBranchOf), areaDocs.map(heldAreaOf));
      const written = await writeBranchImport(
        bankId,
        load.plan,
        {
          branches: new Map(branchDocs.map((doc) => [String(doc._id), doc])),
          areas: new Map(areaDocs.map((doc) => [String(doc._id), doc])),
        },
        meta,
      );
      const report = reportOf(target, bank, bankCreated, file, load, written);
      // The last write: the run row commits with the data or not at all.
      await recordOperationsGoLiveRun(mark, { status: 'done', ...report }, session);
      return { kind: 'done' as const, bank, bankCreated, written, report };
    });
  } catch (error) {
    await countFailure(mark, messageOf(error), now);
    throw error;
  }

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone', bank: target.key };
  if (run.kind === 'skipped') {
    return { status: 'skipped', bank: target.key, reason: run.reason, banks: run.banks };
  }

  // After the commit: the bank's add when it was created, then the catalog's own entries — each
  // marked with the run that wrote it.
  const source = { field: 'source', old: null, new: mark };
  const entries: AuditEntry[] = [
    ...(run.bankCreated
      ? [
          {
            entityRef: bankEntityRef(String(run.bank._id)),
            action: 'create' as const,
            changes: diffChanges({}, bankSnapshot(run.bank)),
          },
        ]
      : []),
    ...branchImportAudits(run.written),
  ].map((entry) => ({ ...entry, changes: [...(entry.changes ?? []), source] }));
  await auditService.recordMany(entries);
  return { status: 'done', ...run.report };
};

/** Why a skipped bank was skipped, for the log. */
const SKIP_REASONS: Record<BankBranchesSkipReason, string> = {
  severalBanks:
    'more than one bank in «البنوك» answers to its names — which one is meant is a person’s call',
  anotherFilesBank: 'the bank its names find is another file’s bank too',
  lookalikeBanks:
    'a bank in «البنوك» looks like it without being it by name — which one is meant is a person’s call',
  bankStopped: 'its bank is stopped («موقوف») — the import loads no stopped bank',
  notInThisBuild: 'its file is not in this build',
};

/** The done line: the counts, the lists by their length (the run row keeps them whole). */
const logLineOf = (report: BankBranchesLoadReport): Record<string, unknown> => ({
  ...report,
  heldBack: report.heldBack.length,
  changed: report.changed.length,
  areaNotes: report.areaNotes.length,
});

type BankBranchesRunOutcome =
  BankBranchesLoadOutcome | { status: 'failed'; bank: OperationsBranchLoadBankKey };

/**
 * Load the four, one after another, and say what each came to. A bank that fails is logged and the
 * others still load; it is tried again on the next boot, for its days. Exported so a test can await
 * it.
 */
export const runOperationsBankBranchesGoLive = async (
  options: BankBranchesLoadOptions = {},
  targets: readonly OperationsBranchLoadBank[] = OPERATIONS_BRANCH_LOAD_BANKS,
): Promise<BankBranchesRunOutcome[]> => {
  const outcomes: BankBranchesRunOutcome[] = [];
  for (const target of targets) {
    let outcome: BankBranchesLoadOutcome;
    try {
      outcome = await loadBankBranches(target, options);
    } catch (error) {
      logger.error(
        { err: error, bank: target.key },
        `operations go-live: loading a bank’s branches failed — unless its run row is in operations_go_live_runs (a commit whose answer was lost), nothing of it was written; the next boot tries again, for ${String(BANK_BRANCHES_RETRY_DAYS)} days after its first failure`,
      );
      outcomes.push({ status: 'failed', bank: target.key });
      continue;
    }
    outcomes.push(outcome);
    if (outcome.status === 'skipped' && outcome.reason === 'notInThisBuild') {
      logger.error(
        { bank: target.key },
        `operations go-live: a bank’s branches were NOT loaded — ${SKIP_REASONS.notInThisBuild}; the next boot tries again, for ${String(BANK_BRANCHES_RETRY_DAYS)} days after its first failure`,
      );
    } else if (outcome.status === 'skipped') {
      logger.error(
        { bank: target.key, reason: outcome.reason, banks: outcome.banks },
        `operations go-live: a bank’s branches were NOT loaded — ${SKIP_REASONS[outcome.reason]}; nothing was written, and no later boot loads this file: its sheet goes through «استيراد من شيت»`,
      );
    } else if (outcome.status === 'gaveUp') {
      logger.error(
        outcome,
        `operations go-live: a bank’s branches were NOT loaded — its load failed on every boot for ${String(BANK_BRANCHES_RETRY_DAYS)} days; no later boot loads this file: its sheet goes through «استيراد من شيت»`,
      );
    } else if (outcome.status === 'done') {
      logger.warn(
        logLineOf(outcome),
        'operations go-live: a bank’s branches were loaded into «البيانات المرجعية» — done, and never again',
      );
      if (outcome.heldBack.length > 0) {
        logger.error(
          { bank: target.key, heldBack: outcome.heldBack },
          'operations go-live: rows that may be a branch the bank already holds were NOT added — a person adds them through «استيراد من شيت»',
        );
      }
    }
  }
  return outcomes;
};

/**
 * What the api calls: start the load and carry on. Not awaited, cannot reject, and skipped under
 * test — the IT steps' terms.
 */
export const startOperationsBankBranchesGoLive = (): void => {
  if (isTest) return;
  runOperationsBankBranchesGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'operations go-live: loading the banks’ branches failed — no boot was harmed',
    );
  });
};
