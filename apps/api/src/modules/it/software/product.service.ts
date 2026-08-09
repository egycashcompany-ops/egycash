// The software catalogue (design §2.8) — reference data: audited, no events.
//
// Its whole job is deduplicating free-text names, so the uniqueness check is the feature and not a
// formality. Products ARCHIVE rather than delete (FR-11): installations and licences point at them
// forever, and a deleted product would leave both unable to say what they are about.
import {
  type CreateItSoftwareProduct,
  type ListItSoftwareProductsQuery,
  type Paginated,
  type UpdateItSoftwareProduct,
} from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { itSoftwareProductRepository } from './product.repository';
import { type ItSoftwareProductDoc } from './product.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'softwareProduct', entityId: id });

const snapshot = (doc: ItSoftwareProductDoc) => ({
  name: doc.name,
  publisher: doc.publisher,
  active: doc.active,
});

class ItSoftwareProductService {
  async create(input: CreateItSoftwareProduct, ctx: AuthContext): Promise<ItSoftwareProductDoc> {
    const clash = await itSoftwareProductRepository.findByName(input.name);
    if (clash !== null) throw new ConflictError(`a product named "${input.name}" already exists`);

    const doc = await itSoftwareProductRepository.create(
      { name: input.name, publisher: input.publisher ?? null, active: true },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListItSoftwareProductsQuery): Promise<Paginated<ItSoftwareProductDoc>> {
    return itSoftwareProductRepository.listFiltered(query);
  }

  async getById(id: string): Promise<ItSoftwareProductDoc> {
    return itSoftwareProductRepository.getById(id);
  }

  async update(
    id: string,
    input: UpdateItSoftwareProduct,
    ctx: AuthContext,
  ): Promise<ItSoftwareProductDoc> {
    const before = await itSoftwareProductRepository.getById(id);
    if (input.name !== undefined && input.name !== before.name) {
      const clash = await itSoftwareProductRepository.findByName(input.name);
      if (clash !== null && String(clash._id) !== id) {
        throw new ConflictError(`a product named "${input.name}" already exists`);
      }
    }
    const set: Partial<ItSoftwareProductDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.publisher !== undefined) set.publisher = input.publisher;
    if (input.active !== undefined) set.active = input.active;

    const updated = await itSoftwareProductRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: input.active === false && before.active ? 'archive' : 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const itSoftwareProductService = new ItSoftwareProductService();
