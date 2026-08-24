// Owners of the metal — companies, funds and institutions (gold `controllers/company.controller.js`).
// Reference data: audited, soft-deleted, no events. The rules are the gold rules: a name is
// required, type and status come from closed vocabularies, and delete is a soft delete so the
// bars, receipts and transfers that name the owner keep reading.
import {
  type CreateGoldCompany,
  type ListGoldCompaniesQuery,
  type Paginated,
  type UpdateGoldCompany,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { goldCompanyRepository } from './company.repository';
import { type GoldCompanyDoc } from './company.model';

const entityRef = (id: string) => ({ moduleId: 'gold', entityType: 'company', entityId: id });

const snapshot = (doc: GoldCompanyDoc) => ({
  name: doc.name,
  type: doc.type,
  phone: doc.phone,
  email: doc.email,
  status: doc.status,
  notes: doc.notes,
  logoFileId: doc.logoFileId === null ? null : String(doc.logoFileId),
});

const oid = (value: string | null | undefined): Types.ObjectId | null =>
  value === null || value === undefined ? null : new Types.ObjectId(value);

class GoldCompanyService {
  async create(input: CreateGoldCompany, by: string): Promise<GoldCompanyDoc> {
    const doc = await goldCompanyRepository.create(
      {
        name: input.name,
        type: input.type,
        phone: input.phone ?? null,
        email: input.email ?? null,
        status: input.status,
        notes: input.notes ?? null,
        logoFileId: oid(input.logoFileId),
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

  async getById(id: string): Promise<GoldCompanyDoc> {
    return goldCompanyRepository.getById(id);
  }

  async list(query: ListGoldCompaniesQuery): Promise<Paginated<GoldCompanyDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.type !== undefined) filter.type = { $in: query.type };
    if (query.status !== undefined) filter.status = { $in: query.status };
    if (query.search !== undefined && query.search !== '') {
      // Same three fields the gold search box covered: name, email, phone.
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
    }
    return goldCompanyRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'name', 'type', 'status'],
    });
  }

  async update(id: string, input: UpdateGoldCompany, by: string): Promise<GoldCompanyDoc> {
    const before = await goldCompanyRepository.getById(id);
    const set: Partial<GoldCompanyDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.type !== undefined) set.type = input.type;
    if (input.phone !== undefined) set.phone = input.phone ?? null;
    if (input.email !== undefined) set.email = input.email ?? null;
    if (input.status !== undefined) set.status = input.status;
    if (input.notes !== undefined) set.notes = input.notes ?? null;
    if (input.logoFileId !== undefined) set.logoFileId = oid(input.logoFileId);
    const updated = await goldCompanyRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /**
   * Soft delete — the gold behaviour, and the only safe one: bars, receipts and transfers store
   * the owner's id, and a hard delete would leave every one of those documents unable to say whose
   * metal it moved.
   */
  async remove(id: string, by: string): Promise<void> {
    await goldCompanyRepository.getById(id);
    await goldCompanyRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete', changes: [] });
  }
}

export const goldCompanyService = new GoldCompanyService();
