// POST /atm/machines/sync — a machines file compared with the branch the top bar points at, and on
// `apply` the branch made to match it (contracts: «Machines from a file»).
//
// The owner: «ضرورى جداً اتأكد إن الماكينات دى متضافه على السيستم لفرع المهندسين» — «البنك
// والكود والأسم والمنطقة». The compare is the plan (plan-machine-sync.ts) over the branch's machines
// read now; the apply walks that plan row by row with the writes the data-edit page already makes:
//   · add / reactivate → the data-edit add (`recordOperationsIntake`): the master, the register
//     entry it couples with (DEC-36), a refusal for a code active or open elsewhere;
//   · update → the machine edit (`writeMaster`): the file's bank, name and area on the master, the
//     area following onto its open register entries (DEC-4), one `update` audit per machine.
// AN APPLY WRITES ONLY WHAT THE READER SAW. The same `File` is posted twice; the compare's
// `fileSha256` comes back with the apply (the register import's rule: 409 if the bytes are not the
// ones looked at), and so does its `planDigest` — the comparison itself, the branch included. The
// apply compares again and writes nothing (409 `ATM_MACHINE_SYNC_PLAN_CHANGED`) unless it is the
// same comparison: a machine an operator moved after the compare is never put back silently, and a
// row that was `same` never becomes a write nobody was shown (review finding). Each row is then its
// own unit, so one refusal does not undo the rest; a row somebody changes WHILE the apply runs is
// left as they made it (`skipped`). Nothing is deleted. After an apply the file is compared again,
// so the answer shows the branch as it now is. `atmMachine.manage` must reach the acting branch, and
// an organization-wide holder picks the branch in the top bar (GM-20) — the bulk add's own rules.
import { createHash } from 'node:crypto';
import {
  ErrorCodes,
  normalizeAtmMachineCode,
  type AtmBankCode,
  type AtmMachineBulkRefusal,
  type AtmMachineSyncAppliedDto,
  type AtmMachineSyncDto,
} from '@ecms/contracts';
import { branchRepository } from '../../../../platform/organization';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { ConflictError, ValidationError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { assertNoBranchMoveRunning } from '../../branch-links/move-fence';
import { ensureAreaLabels } from '../../catalogs/area-labels';
import { loadBranchBankSpellings, pickBankOfLabel } from '../../catalogs/bank-catalog';
import {
  IntakeRefusal,
  recordOperationsIntake,
  resolveIntakeBank,
} from '../../register/operations-intake';
import { isPlaceholderMachineCode } from '../../register/register-coupling';
import { atmRegisterEntryRepository } from '../../register/register.repository';
import { resolveRegisterSettings, type RegisterSettings } from '../../register/register-settings';
import { atmMachineRepository } from '../machine.repository';
import { addBranchOf, settleMasterWrite, writeMaster } from '../machine.service';
import {
  changesOf,
  planDigestOf,
  planMachineSync,
  type SyncBankCatalog,
  type SyncPlan,
  type SyncPlanRow,
} from './plan-machine-sync';
import { readMachineFile, type MachineFileRow } from './read-machine-file';

export interface MachineSyncRequest {
  buffer: Buffer;
  fileName: string;
  apply: boolean;
  fileSha256: string | null;
  /** The compare's `planDigest` — required with `apply`. */
  planDigest: string | null;
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

const emptyApplied = (): AtmMachineSyncAppliedDto => ({
  added: [],
  reactivated: [],
  updated: [],
  refused: [],
  skipped: [],
  register: { created: [], received: [], linked: [], existing: [], notRecorded: [] },
});

class AtmMachineSyncService {
  async run(request: MachineSyncRequest, ctx: AuthContext): Promise<AtmMachineSyncDto> {
    const branchId = await addBranchOf(ctx);
    const fileSha256 = sha256(request.buffer);
    if (request.apply && request.fileSha256 !== fileSha256) {
      throw new ConflictError(
        'the file changed since it was compared — compare it again',
        ErrorCodes.ATM_MACHINE_SYNC_FILE_CHANGED,
      );
    }
    const fileRows = await readMachineFile(request.buffer);
    const settings = await resolveRegisterSettings();
    let plan = await this.plan(branchId, fileRows, settings);
    let applied: AtmMachineSyncAppliedDto | null = null;
    if (request.apply) {
      if (request.planDigest !== sha256(planDigestOf(branchId, plan))) {
        throw new ConflictError(
          'the branch changed since the file was compared — compare it again',
          ErrorCodes.ATM_MACHINE_SYNC_PLAN_CHANGED,
        );
      }
      applied = await this.apply(branchId, plan, settings, ctx);
      plan = await this.plan(branchId, fileRows, settings);
    }
    const [branch] = await branchRepository.findByIdsSystem([branchId]);
    return {
      fileName: request.fileName,
      fileSha256,
      planDigest: sha256(planDigestOf(branchId, plan)),
      branchId,
      branchName:
        branch === undefined || branch.isDeleted
          ? null
          : { ar: branch.name.ar, en: branch.name.en },
      counts: plan.counts,
      rows: plan.rows
        .filter((row) => row.status !== 'same')
        .map(({ machineId: _machineId, ...row }) => row),
      extra: plan.extra.map((machine) => ({
        machineCode: machine.machineCode,
        bank: machine.bankName,
        name: machine.name,
        area: machine.area,
      })),
      applied,
    };
  }

  /** The branch's machines and the bank catalog as they are now, against the file. */
  private async plan(
    branchId: string,
    fileRows: readonly MachineFileRow[],
    settings: RegisterSettings,
  ): Promise<SyncPlan> {
    const [docs, spellings] = await Promise.all([
      atmMachineRepository.listForSync(branchId),
      loadBranchBankSpellings(branchId),
    ]);
    const machines = docs.map((doc) => ({
      id: String(doc._id),
      machineCode: doc.machineCode,
      bankName: doc.bankName,
      name: doc.name,
      area: doc.area,
      isActive: doc.isActive,
    }));
    // The codes an add or a reactivation would write: not working here (missing, or archived).
    const working = new Set(machines.filter((m) => m.isActive).map((m) => m.machineCode));
    const candidates = [
      ...new Set(
        fileRows
          .map((row) => normalizeAtmMachineCode(row.code))
          .filter((code) => code !== '' && !working.has(code)),
      ),
    ];
    const elsewhere = await this.elsewhereOf(branchId, candidates);
    return planMachineSync(fileRows, machines, elsewhere, this.catalogOf(settings, spellings));
  }

  /**
   * Why each of these codes cannot work here — the data-edit add's two refusals, read in two
   * queries: ACTIVE in another branch (DEC-9), else an OPEN register period held by another branch
   * or by none (D6; `openElsewhereOf`). A placeholder code is "no real code" to the register.
   */
  private async elsewhereOf(
    branchId: string,
    codes: readonly string[],
  ): Promise<Map<string, AtmMachineBulkRefusal>> {
    const out = new Map<string, AtmMachineBulkRefusal>();
    if (codes.length === 0) return out;
    const [active, open] = await Promise.all([
      atmMachineRepository.activeCodesElsewhere(branchId, codes),
      atmRegisterEntryRepository.findOpenByCodes(
        codes.filter((code) => !isPlaceholderMachineCode(code)),
      ),
    ]);
    for (const [code, rows] of open) {
      if (rows.some((row) => row.branchId === null || String(row.branchId) !== branchId)) {
        out.set(code, 'openElsewhere');
      }
    }
    for (const code of active) out.set(code, 'activeElsewhere');
    return out;
  }

  private catalogOf(
    settings: RegisterSettings,
    spellings: Awaited<ReturnType<typeof loadBranchBankSpellings>>,
  ): SyncBankCatalog {
    const { catalog } = settings;
    return {
      codeOfLabel: (label) => pickBankOfLabel(label.trim(), catalog, spellings)?.code ?? null,
      labelOf: (code: AtmBankCode) => catalog.opsLabel(code),
      isActive: (code: AtmBankCode) => catalog.byCode.get(code)?.isActive ?? true,
    };
  }

  /** Each row its own unit, in the file's order; nothing deleted. */
  private async apply(
    branchId: string,
    plan: SyncPlan,
    settings: RegisterSettings,
    ctx: AuthContext,
  ): Promise<AtmMachineSyncAppliedDto> {
    await assertNoBranchMoveRunning();
    const out = emptyApplied();
    const areas = new Set<string>();
    const spellings = await loadBranchBankSpellings(branchId);
    const catalog = this.catalogOf(settings, spellings);
    for (const row of plan.rows) {
      if (row.status !== 'add' && row.status !== 'reactivate' && row.status !== 'update') continue;
      // Per row as well: an apply begun before a branch move stops at its next row.
      await assertNoBranchMoveRunning();
      if (row.status === 'update') await this.updateOne(branchId, row, catalog, ctx, out);
      else if (await this.addOne(branchId, row, settings, ctx, out)) areas.add(row.file.area);
    }
    if (areas.size > 0) {
      await ensureAreaLabels(
        [...areas].map((area) => ({ branchId, area })),
        { actorId: ctx.userId, origin: 'machine' },
      );
    }
    return out;
  }

  /** The data-edit add for one row — true when a machine now works here with the file's data. */
  private async addOne(
    branchId: string,
    row: SyncPlanRow,
    settings: RegisterSettings,
    ctx: AuthContext,
    out: AtmMachineSyncAppliedDto,
  ): Promise<boolean> {
    try {
      const bank = await resolveIntakeBank(branchId, row.file.bank, settings.catalog);
      const added = await recordOperationsIntake(
        {
          branchId,
          machineCode: row.machineCode,
          name: row.file.name,
          area: row.file.area,
          bankName: row.file.bank,
          bank,
        },
        ctx,
        settings,
      );
      (added.reactivated ? out.reactivated : out.added).push(row.machineCode);
      const { action, reason } = added.register;
      if (action === 'none') {
        out.register.notRecorded.push({ machineCode: row.machineCode, reason: reason ?? 'noBank' });
      } else {
        out.register[action].push(row.machineCode);
      }
      return true;
    } catch (error) {
      if (error instanceof IntakeRefusal && error.reason !== 'activeHere') {
        out.refused.push({ machineCode: row.machineCode, reason: error.reason });
        return false;
      }
      // Added here by somebody else since the compare, or a bank archived since: left as it is.
      if (error instanceof ConflictError || error instanceof ValidationError) {
        out.skipped.push(row.machineCode);
        return false;
      }
      throw error;
    }
  }

  /** The machine edit for one row — the fields that still differ from the file, read again now. */
  private async updateOne(
    branchId: string,
    row: SyncPlanRow,
    catalog: SyncBankCatalog,
    ctx: AuthContext,
    out: AtmMachineSyncAppliedDto,
  ): Promise<void> {
    const before =
      row.machineId === null ? null : await atmMachineRepository.findById(row.machineId);
    const bankCode = catalog.codeOfLabel(row.file.bank);
    if (
      before === null ||
      bankCode === null ||
      !before.isActive ||
      String(before.branchId) !== branchId ||
      before.machineCode !== row.machineCode
    ) {
      out.skipped.push(row.machineCode);
      return;
    }
    const changes = changesOf(catalog, row.file, bankCode, {
      id: String(before._id),
      machineCode: before.machineCode,
      bankName: before.bankName,
      name: before.name,
      area: before.area,
      isActive: before.isActive,
    });
    if (changes.length === 0) return;
    const set: Record<string, unknown> = {};
    if (changes.includes('bank')) set.bankName = row.file.bank;
    if (changes.includes('name')) set.name = row.file.name;
    if (changes.includes('area')) set.area = row.file.area;
    try {
      const { updated, audits } = await unitOfWork((session) =>
        writeMaster(before, set, {
          by: ctx.userId,
          // A legacy row read before its backfill carries no `__v`; the backfill sets 0 (DEC-23).
          version: (before as Partial<typeof before>).__v ?? 0,
          session,
        }),
      );
      await settleMasterWrite(before, updated, audits, ctx.userId);
      out.updated.push(row.machineCode);
    } catch (error) {
      // Edited by somebody else since it was read: left as they made it.
      if (error instanceof ConflictError) {
        out.skipped.push(row.machineCode);
        return;
      }
      throw error;
    }
  }
}

export const atmMachineSyncService = new AtmMachineSyncService();
