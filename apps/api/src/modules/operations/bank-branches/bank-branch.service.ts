// Bank-branch reference admin. Audited, no events (fleet-catalog precedent). Two rules beyond
// plain CRUD, both ported: the branch's bank must exist and be active (the legacy add form's
// bank picker, server-enforced now that the join is a ref), and `financeAreaName` defaults to
// `opsAreaName` on create — the verbatim legacy `area2: area2 || area` behaviour (Q24 PRESERVE,
// contad_app.js:1909).
import {
  type CreateOperationsBankBranch,
  type ListOperationsBankBranchesQuery,
  type Paginated,
  type UpdateOperationsBankBranch,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { BusinessRuleError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsBankRepository } from '../banks/bank.repository';
import { operationsBankBranchRepository } from './bank-branch.repository';
import { type OperationsBankBranchDoc } from './bank-branch.model';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'bankBranch',
  entityId: id,
});

const snapshot = (doc: OperationsBankBranchDoc) => ({
  bankId: String(doc.bankId),
  name: doc.name,
  code: doc.code,
  opsAreaName: doc.opsAreaName,
  financeAreaName: doc.financeAreaName,
  location: doc.location,
  isActive: doc.isActive,
});

const assertBankActive = async (bankId: string): Promise<void> => {
  if ((await operationsBankRepository.findActiveById(bankId)) === null) {
    throw new BusinessRuleError('unknown or inactive bank', 'OPERATIONS_UNKNOWN_BANK');
  }
};

class OperationsBankBranchService {
  async create(input: CreateOperationsBankBranch, by: string): Promise<OperationsBankBranchDoc> {
    await assertBankActive(input.bankId);
    const doc = await operationsBankBranchRepository.create(
      {
        bankId: new Types.ObjectId(input.bankId),
        name: input.name,
        code: input.code,
        opsAreaName: input.opsAreaName,
        // Q24 parity: legacy `area2: (area2 || area)` — contad_app.js:1909.
        financeAreaName: input.financeAreaName ?? input.opsAreaName,
        location: input.location,
        isActive: true,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(
    query: ListOperationsBankBranchesQuery,
  ): Promise<Paginated<OperationsBankBranchDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.bankId !== undefined) filter.bankId = query.bankId;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search !== undefined && query.search !== '') {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { code: { $regex: query.search, $options: 'i' } },
        { opsAreaName: { $regex: query.search, $options: 'i' } },
      ];
    }
    return operationsBankBranchRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['code', 'name', 'opsAreaName', 'createdAt'],
    });
  }

  async update(
    id: string,
    input: UpdateOperationsBankBranch,
    by: string,
  ): Promise<OperationsBankBranchDoc> {
    const before = await operationsBankBranchRepository.getById(id);
    if (input.bankId !== undefined && input.bankId !== String(before.bankId)) {
      await assertBankActive(input.bankId);
    }
    const { version, bankId, ...fields } = input;
    const set = {
      ...fields,
      ...(bankId === undefined ? {} : { bankId: new Types.ObjectId(bankId) }),
    };
    const updated = await operationsBankBranchRepository.updateById(id, set, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const operationsBankBranchService = new OperationsBankBranchService();
