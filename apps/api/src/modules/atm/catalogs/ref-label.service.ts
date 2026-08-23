// Add / remove for the two label lists — the checkment2/3 (add) and checkment8/9 (remove)
// branches of the legacy /data_edit_atm POST (contad_app.js:2471-2527). Configuration, not
// domain facts: audited, no events (the operations bank precedent).
import { Types, type FilterQuery } from 'mongoose';
import {
  type CreateAtmRefLabel,
  type ListAtmRefLabelsQuery,
  type Paginated,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { type AuthContext, scopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { BaseRepository } from '../../../shared/base/base.repository';
import { resolveAtmBranchId } from '../shared/atm-context';
import { AtmRefLabelModel, type AtmRefLabelDoc, type AtmRefLabelKind } from './ref-label.model';

class AtmRefLabelRepository extends BaseRepository<AtmRefLabelDoc> {
  constructor() {
    super(AtmRefLabelModel, { branchField: 'branchId' });
  }
}

export const atmRefLabelRepository = new AtmRefLabelRepository();

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'refLabel', entityId: id });

class AtmRefLabelService {
  async list(
    kind: AtmRefLabelKind,
    query: ListAtmRefLabelsQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AtmRefLabelDoc>> {
    const filter: FilterQuery<AtmRefLabelDoc> = { kind };
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    return atmRefLabelRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['name', 'createdAt'],
      scope: scopeSelector(ctx, 'atmMachine.view'),
    });
  }

  async create(
    kind: AtmRefLabelKind,
    input: CreateAtmRefLabel,
    ctx: AuthContext,
  ): Promise<AtmRefLabelDoc> {
    const branchId = await resolveAtmBranchId(ctx);
    // The unique index turns the legacy's read-then-push duplicate check (:2473, :2485) into a
    // ConflictError the client renders as "already exists" — same rule, no race.
    const doc = await atmRefLabelRepository.create(
      { branchId: new Types.ObjectId(branchId), kind, name: input.name.trim(), isActive: true },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, { kind, name: doc.name, branchId }),
    });
    return doc;
  }

  /** Legacy `$pull` (:2514, :2523) — the name leaves the list; machines keep their strings. */
  async remove(id: string, ctx: AuthContext): Promise<void> {
    const doc = await atmRefLabelRepository.softDeleteById(id, {
      by: ctx.userId,
      scope: scopeSelector(ctx, 'atmMachine.manage'),
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges({ kind: doc.kind, name: doc.name }, {}),
    });
  }
}

export const atmRefLabelService = new AtmRefLabelService();
