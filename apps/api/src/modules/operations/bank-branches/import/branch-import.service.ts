// «استيراد فروع من شيت» (Round 29) — a bank's branch sheet compared with the bank's branches and
// «المناطق», and on «تأكيد الاستيراد» written (contracts: operations-branch-import.ts).
//
// COMPARE writes nothing: the sheet read (`read-branch-sheet.ts`), the bank's live branches and the
// live areas read now, the plan made (`plan-branch-import.ts`), and the plan hashed — `planDigest`.
//
// APPLY writes only what the reader saw. The same file is posted again with the compare's
// `fileSha256` and `planDigest`; the bytes must be the compared ones, and the plan — made again,
// now — must hash to the same digest, or nothing is written (409 `OPERATIONS_BRANCH_IMPORT_CHANGED`:
// a branch added or edited, an area added, since the compare). Then ONE transaction: the new areas,
// the English names filled, the edits, then the new branches — each held row written at the
// version just read, so an edit landing in between aborts it all (409 `STALE_DOCUMENT`).
// After the commit each row is audited as the catalog's own add and edit audit it (no events — the
// reference data emits none).
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  type OperationsBranchImportAppliedDto,
  type OperationsBranchImportCompareDto,
} from '@ecms/contracts';
import { auditService, type AuditEntry } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { AppError, BusinessRuleError, ConflictError } from '../../../../shared/errors';
import { diffChanges } from '../../../../shared/utils/diff';
import { operationsBankRepository } from '../../banks/bank.repository';
import { type OperationsAreaDoc } from '../../areas/area.model';
import { operationsAreaRepository } from '../../areas/area.repository';
import { areaEntityRef, areaSnapshot } from '../../areas/area.service';
import { type OperationsBankBranchDoc } from '../bank-branch.model';
import { operationsBankBranchRepository } from '../bank-branch.repository';
import { bankBranchEntityRef, bankBranchSnapshot } from '../bank-branch.service';
import { planBranchImport, type BranchImportPlan, type BranchUpdate } from './plan-branch-import';
import { readBranchSheet, type BranchSheetRead } from './read-branch-sheet';

export interface BranchImportUpload {
  bankId: string;
  fileName: string;
  buffer: Buffer;
}

/**
 * The code an edited branch holds for a moment inside the transaction, when the code it takes is
 * one another edited branch is leaving — never seen outside it, and no sheet's code.
 */
const TEMP_CODE_PREFIX = '__import__';

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/**
 * The plan, hashed: everything the compare SHOWS that the apply would write — each row's outcome,
 * branch, values before and after, the areas created and filled — with the bank and the file. A
 * change anywhere in it is a different plan; an edit the plan does not reach is not.
 */
export const planDigestOf = (bankId: string, fileSha256: string, plan: BranchImportPlan): string =>
  sha256(
    JSON.stringify({
      bankId,
      fileSha256,
      rows: plan.rows.map((row) => [
        row.row,
        row.outcome,
        row.problem,
        row.branchId,
        row.before,
        row.after,
      ]),
      newAreas: plan.newAreas.map((area) => [area.name, area.nameEn]),
      filledAreas: plan.filledAreas.map((area) => [area.id, area.nameEn]),
    }),
  );

const changed = (reason: 'FILE_CHANGED' | 'PLAN_CHANGED'): AppError =>
  new AppError(
    ErrorCodes.OPERATIONS_BRANCH_IMPORT_CHANGED,
    409,
    reason === 'FILE_CHANGED'
      ? 'the file is not the one compared — compare it again'
      : "the bank's branches or the areas changed since the comparison — compare again",
    {
      details: [
        {
          field: reason === 'FILE_CHANGED' ? 'fileSha256' : 'planDigest',
          code: reason,
          message: reason,
        },
      ],
    },
  );

interface Planned {
  bankName: string;
  fileSha256: string;
  sheet: BranchSheetRead;
  plan: BranchImportPlan;
  planDigest: string;
  branches: Map<string, OperationsBankBranchDoc>;
  areas: Map<string, OperationsAreaDoc>;
}

class OperationsBranchImportService {
  /** Read the sheet and plan it against the bank as it is now. Writes nothing. */
  private async planOf(input: BranchImportUpload): Promise<Planned> {
    const bank = await operationsBankRepository.findActiveById(input.bankId);
    if (bank === null) {
      throw new BusinessRuleError('unknown or inactive bank', ErrorCodes.OPERATIONS_UNKNOWN_BANK);
    }
    const fileSha256 = sha256(input.buffer);
    const sheet = await readBranchSheet(input.buffer);
    const [branchDocs, areaDocs] = await Promise.all([
      operationsBankBranchRepository.liveOfBank(input.bankId),
      operationsAreaRepository.liveAll(),
    ]);
    const plan = planBranchImport(
      sheet.rows,
      branchDocs.map((doc) => ({
        id: String(doc._id),
        name: doc.name,
        code: doc.code,
        opsAreaName: doc.opsAreaName,
        financeAreaName: doc.financeAreaName,
        location: doc.location,
        isActive: doc.isActive,
      })),
      areaDocs.map((doc) => ({ id: String(doc._id), name: doc.name, nameEn: doc.nameEn })),
    );
    return {
      bankName: bank.opsName,
      fileSha256,
      sheet,
      plan,
      planDigest: planDigestOf(input.bankId, fileSha256, plan),
      branches: new Map(branchDocs.map((doc) => [String(doc._id), doc])),
      areas: new Map(areaDocs.map((doc) => [String(doc._id), doc])),
    };
  }

  async compare(input: BranchImportUpload): Promise<OperationsBranchImportCompareDto> {
    const { bankName, fileSha256, sheet, plan, planDigest } = await this.planOf(input);
    return {
      bankId: input.bankId,
      bankName,
      fileName: input.fileName,
      fileSha256,
      planDigest,
      sheetName: sheet.sheetName,
      headerRow: sheet.headerRow,
      layout: sheet.layout,
      counts: plan.counts,
      rows: plan.rows,
      newAreas: plan.newAreas,
      filledAreas: plan.filledAreas,
    };
  }

  async apply(
    input: BranchImportUpload & { fileSha256: string; planDigest: string },
    by: string,
  ): Promise<OperationsBranchImportAppliedDto> {
    if (sha256(input.buffer) !== input.fileSha256) throw changed('FILE_CHANGED');
    const planned = await this.planOf(input);
    if (planned.planDigest !== input.planDigest) throw changed('PLAN_CHANGED');
    const { plan } = planned;
    const bankId = new Types.ObjectId(input.bankId);

    const written = await unitOfWork(async (session) => {
      const meta = { by, session };
      // A retried transaction starts its lists afresh.
      const areasCreated: OperationsAreaDoc[] = [];
      const areasFilled: { before: OperationsAreaDoc; after: OperationsAreaDoc }[] = [];
      const branchesUpdated: { before: OperationsBankBranchDoc; after: OperationsBankBranchDoc }[] =
        [];
      // Areas first: a branch names its area by the name the area is created with.
      for (const area of plan.areaCreates) {
        areasCreated.push(
          await operationsAreaRepository.create(
            { name: area.name, nameEn: area.nameEn, governorate: null, isActive: true },
            meta,
          ),
        );
      }
      for (const fill of plan.filledAreas) {
        const before = planned.areas.get(fill.id) as OperationsAreaDoc;
        const after = await operationsAreaRepository.updateById(
          fill.id,
          { nameEn: fill.nameEn },
          { ...meta, version: before.__v },
        );
        areasFilled.push({ before, after });
      }
      // The edits before the new branches: a code an edited branch leaves may be a new one's. An
      // edit taking a code another edited branch leaves passes through a code of its own first.
      const versions = new Map(
        plan.branchUpdates.map((update) => [
          update.branchId,
          (planned.branches.get(update.branchId) as OperationsBankBranchDoc).__v,
        ]),
      );
      const write = async (branchId: string, set: BranchUpdate['set']) => {
        const version = versions.get(branchId) as number;
        const after = await operationsBankBranchRepository.updateById(branchId, set, {
          ...meta,
          version,
        });
        versions.set(branchId, version + 1);
        return after;
      };
      const passing = plan.branchUpdates.filter((update) => update.viaTemp);
      for (const update of passing) {
        await write(update.branchId, { code: `${TEMP_CODE_PREFIX}${update.branchId}` });
      }
      for (const update of [...plan.branchUpdates.filter((u) => !u.viaTemp), ...passing]) {
        const before = planned.branches.get(update.branchId) as OperationsBankBranchDoc;
        branchesUpdated.push({ before, after: await write(update.branchId, update.set) });
      }
      const created = await operationsBankBranchRepository.createManyUnordered(
        plan.branchCreates.map((branch) => ({
          bankId,
          name: branch.name,
          code: branch.code,
          // Both areas: «ضيفها ل منطقة العمليات و منطقة الحسابات».
          opsAreaName: branch.areaName,
          financeAreaName: branch.areaName,
          location:
            branch.address === null ? null : { addressLine: branch.address, coordinates: null },
          isActive: true,
        })),
        meta,
      );
      // The plan never writes a name or a code the bank holds; a duplicate here is a branch added
      // between the plan and the write — the whole import is refused, nothing kept.
      if (created.duplicateIndexes.length > 0) {
        throw new ConflictError(
          'a branch of this bank was added while the import was written — compare again',
          ErrorCodes.OPERATIONS_BRANCH_IMPORT_CHANGED,
        );
      }
      return {
        areasCreated,
        areasFilled,
        branchesCreated: created.inserted.map(({ doc }) => doc),
        branchesUpdated,
      };
    });

    const audits: AuditEntry[] = [
      ...written.areasCreated.map((doc) => ({
        entityRef: areaEntityRef(String(doc._id)),
        action: 'create' as const,
        changes: diffChanges({}, areaSnapshot(doc)),
      })),
      ...written.areasFilled.map(({ before, after }) => ({
        entityRef: areaEntityRef(String(after._id)),
        action: 'update' as const,
        changes: diffChanges(areaSnapshot(before), areaSnapshot(after)),
      })),
      ...written.branchesCreated.map((doc) => ({
        entityRef: bankBranchEntityRef(String(doc._id)),
        action: 'create' as const,
        changes: diffChanges({}, bankBranchSnapshot(doc)),
      })),
      ...written.branchesUpdated.map(({ before, after }) => ({
        entityRef: bankBranchEntityRef(String(after._id)),
        action: 'update' as const,
        changes: diffChanges(bankBranchSnapshot(before), bankBranchSnapshot(after)),
      })),
    ];
    await auditService.recordMany(audits);

    return {
      bankId: input.bankId,
      branchesCreated: written.branchesCreated.length,
      branchesUpdated: written.branchesUpdated.length,
      unchanged: plan.counts.unchanged,
      problems: plan.counts.problem,
      areasCreated: written.areasCreated.length,
      areasFilled: written.areasFilled.length,
    };
  }
}

export const operationsBranchImportService = new OperationsBranchImportService();
