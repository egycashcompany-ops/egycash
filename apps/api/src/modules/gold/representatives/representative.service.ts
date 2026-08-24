// المندوبون — a customer company's authorised delegates (gold `controllers/representative.controller.js`).
// The gold rules, unchanged: a delegate must belong to a company that exists, and delete is a soft
// delete because receipts and transfers name the delegate who signed.
import {
  type CreateGoldRepresentative,
  type ListGoldRepresentativesQuery,
  type Paginated,
  type UpdateGoldRepresentative,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { BusinessRuleError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { goldCompanyRepository } from '../companies/company.repository';
import { goldRepresentativeRepository } from './representative.repository';
import { type GoldRepresentativeDoc } from './representative.model';

const entityRef = (id: string) => ({
  moduleId: 'gold',
  entityType: 'representative',
  entityId: id,
});

const snapshot = (doc: GoldRepresentativeDoc) => ({
  companyId: String(doc.companyId),
  fullName: doc.fullName,
  nationalId: doc.nationalId,
  phone: doc.phone,
  jobTitle: doc.jobTitle,
  joinDate: doc.joinDate,
  status: doc.status,
  notes: doc.notes,
});

const assertCompanyExists = async (companyId: string): Promise<void> => {
  const exists = await goldCompanyRepository.exists({
    _id: new Types.ObjectId(companyId),
  } as never);
  if (!exists) throw new BusinessRuleError('Company does not exist');
};

class GoldRepresentativeService {
  async create(input: CreateGoldRepresentative, by: string): Promise<GoldRepresentativeDoc> {
    await assertCompanyExists(input.companyId);
    const doc = await goldRepresentativeRepository.create(
      {
        companyId: new Types.ObjectId(input.companyId),
        fullName: input.fullName,
        nationalId: input.nationalId ?? null,
        phone: input.phone ?? null,
        jobTitle: input.jobTitle ?? null,
        joinDate: input.joinDate ?? null,
        status: input.status,
        notes: input.notes ?? null,
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

  async getById(id: string): Promise<GoldRepresentativeDoc> {
    return goldRepresentativeRepository.getById(id);
  }

  async list(query: ListGoldRepresentativesQuery): Promise<Paginated<GoldRepresentativeDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.companyId !== undefined) filter.companyId = new Types.ObjectId(query.companyId);
    if (query.status !== undefined) filter.status = query.status;
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ fullName: pattern }, { nationalId: pattern }, { phone: pattern }];
    }
    return goldRepresentativeRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'fullName', 'status'],
    });
  }

  async update(
    id: string,
    input: UpdateGoldRepresentative,
    by: string,
  ): Promise<GoldRepresentativeDoc> {
    const before = await goldRepresentativeRepository.getById(id);
    if (input.companyId !== undefined) await assertCompanyExists(input.companyId);
    const set: Partial<GoldRepresentativeDoc> = {};
    if (input.companyId !== undefined) set.companyId = new Types.ObjectId(input.companyId);
    if (input.fullName !== undefined) set.fullName = input.fullName;
    if (input.nationalId !== undefined) set.nationalId = input.nationalId ?? null;
    if (input.phone !== undefined) set.phone = input.phone ?? null;
    if (input.jobTitle !== undefined) set.jobTitle = input.jobTitle ?? null;
    if (input.joinDate !== undefined) set.joinDate = input.joinDate ?? null;
    if (input.status !== undefined) set.status = input.status;
    if (input.notes !== undefined) set.notes = input.notes ?? null;
    const updated = await goldRepresentativeRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  async remove(id: string, by: string): Promise<void> {
    await goldRepresentativeRepository.getById(id);
    await goldRepresentativeRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete', changes: [] });
  }
}

export const goldRepresentativeService = new GoldRepresentativeService();
