// المفاتيح — handing a drawer's key to a customer's delegate (gold `controllers/keyHandover.controller.js`).
//
// ONE KEY PER DRAWER. A drawer whose key is out cannot have it handed over again until it comes
// back, and the refusal names who is holding it — which is the whole point: the operator at the
// counter needs to know who to call, not that the request failed.
import {
  type CreateGoldKeyHandover,
  type ListGoldKeysQuery,
  type Paginated,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { goldCompanyRepository } from '../companies/company.repository';
import { goldRepresentativeRepository } from '../representatives/representative.repository';
import { goldDrawerRepository } from '../vaults/drawer.repository';
import { goldKeyHandoverRepository } from './key-handover.repository';
import { type GoldKeyHandoverDoc } from './key-handover.model';

const entityRef = (id: string) => ({ moduleId: 'gold', entityType: 'keyHandover', entityId: id });

const snapshot = (doc: GoldKeyHandoverDoc) => ({
  companyId: String(doc.companyId),
  representativeId: String(doc.representativeId),
  vaultId: String(doc.vaultId),
  drawerId: String(doc.drawerId),
  status: doc.status,
  handoverDate: doc.handoverDate,
  notes: doc.notes,
});

class GoldKeyHandoverService {
  async list(
    query: ListGoldKeysQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<GoldKeyHandoverDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.vaultId !== undefined) filter.vaultId = new Types.ObjectId(query.vaultId);
    if (query.status !== undefined) filter.status = query.status;
    return goldKeyHandoverRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'handoverDate'],
      scope,
    });
  }

  async getById(id: string, scope: ScopeSelector): Promise<GoldKeyHandoverDoc> {
    return goldKeyHandoverRepository.getById(id, scope);
  }

  /** How many drawers exist, how many of their keys are out, and who holds each one. */
  async overview(scope: ScopeSelector) {
    const [totalDrawers, active] = await Promise.all([
      goldDrawerRepository.countInScope(scope),
      goldKeyHandoverRepository.findActive(scope),
    ]);
    const [holders, companies] = await Promise.all([
      goldRepresentativeRepository.namesOf(active.map((k) => String(k.representativeId))),
      goldCompanyRepository.namesOf(active.map((k) => String(k.companyId))),
    ]);
    return { totalDrawers, active, holders, companies };
  }

  async create(input: CreateGoldKeyHandover, by: string): Promise<GoldKeyHandoverDoc> {
    const existing = await goldKeyHandoverRepository.findActiveForDrawer(input.drawerId);
    if (existing !== null) {
      const [holders, companies] = await Promise.all([
        goldRepresentativeRepository.namesOf([String(existing.representativeId)]),
        goldCompanyRepository.namesOf([String(existing.companyId)]),
      ]);
      throw new ConflictError(
        `هذا المفتاح مُسلّم بالفعل إلى ${holders.get(String(existing.representativeId)) ?? '—'} (${companies.get(String(existing.companyId)) ?? '—'}) من قبل`,
      );
    }
    const drawer = await goldDrawerRepository.findById(input.drawerId);
    if (drawer === null) throw new NotFoundError('Drawer not found');

    const doc = await goldKeyHandoverRepository.create(
      {
        companyId: new Types.ObjectId(input.companyId),
        representativeId: new Types.ObjectId(input.representativeId),
        vaultId: new Types.ObjectId(input.vaultId),
        drawerId: new Types.ObjectId(input.drawerId),
        notes: input.notes ?? null,
        handedOverByUserId: new Types.ObjectId(by),
        handoverDate: new Date(),
        status: 'active',
        // The key follows the DRAWER's branch, not the operator's — the gold rule.
        branchId: drawer.branchId,
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

  async returnKey(id: string, by: string, scope: ScopeSelector): Promise<GoldKeyHandoverDoc> {
    const key = await goldKeyHandoverRepository.getById(id, scope);
    if (key.status === 'returned') throw new BusinessRuleError('هذا المفتاح مُرتجع بالفعل');
    const updated = await goldKeyHandoverRepository.updateById(
      id,
      { status: 'returned', returnedAt: new Date(), returnedByUserId: new Types.ObjectId(by) },
      { by, version: key.__v, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'return',
      changes: diffChanges({ status: 'active' }, { status: 'returned' }),
    });
    return updated;
  }

  async remove(id: string, by: string, scope: ScopeSelector): Promise<void> {
    await goldKeyHandoverRepository.getById(id, scope);
    await goldKeyHandoverRepository.softDeleteById(id, { by, scope });
    await auditService.record({ entityRef: entityRef(id), action: 'delete', changes: [] });
  }
}

export const goldKeyHandoverService = new GoldKeyHandoverService();
