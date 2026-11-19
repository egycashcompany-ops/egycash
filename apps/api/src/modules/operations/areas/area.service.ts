// Operational-area reference admin — the legacy `/data_edit` city section (contad_app.js:2033).
// Audited, no events (the fleet-catalog precedent every other Operations catalog follows).
//
// The legacy screen had one behaviour worth naming: DELETE was soft and had NO referential check
// (:2192), and because branches store the area as a STRING, deleting one orphaned nothing — it
// simply vanished from future suggestions while existing branches kept their text. That is
// PRESERVED here, and it is preserved honestly: deactivating an area takes it out of the
// suggestion list and leaves every branch that already carries the name exactly as it is. There
// is nothing to cascade, because nothing points at it.
import {
  foldOperationsAreaName,
  type CreateOperationsArea,
  type ListOperationsReferenceQuery,
  type Paginated,
  type UpdateOperationsArea,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { ConflictError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsAreaRepository } from './area.repository';
import { type OperationsAreaDoc } from './area.model';
import { containsText } from '../catalog-search';

/** The audit trail's reference — exported for the branch sheet import (Round 29). */
export const areaEntityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'area',
  entityId: id,
});
const entityRef = areaEntityRef;

/** What the audit diff compares — exported for the branch sheet import, as above. */
export const areaSnapshot = (doc: OperationsAreaDoc) => ({
  name: doc.name,
  nameEn: doc.nameEn,
  governorate: doc.governorate,
  isActive: doc.isActive,
});

class OperationsAreaService {
  async create(input: CreateOperationsArea, by: string): Promise<OperationsAreaDoc> {
    // Round 28c — «الاتجاه» on «لوحة التشغيلة» offers «إضافة «…» إلى القائمة» for a name the desk
    // typed. A name that FOLDS to a live area's (`foldOperationsAreaName` — «المعادى» beside
    // «المعادي»; an archived one too) is that area, never a second spelling of it: the direction
    // rules would read the two as one. The unique index holds the exact name only; this holds the
    // rest, with the same answer (409 `DUPLICATE`).
    const folded = foldOperationsAreaName(input.name);
    const same =
      folded === ''
        ? undefined
        : (await operationsAreaRepository.liveAll()).find(
            (area) => foldOperationsAreaName(area.name) === folded,
          );
    if (same !== undefined) {
      throw new ConflictError(
        `the area «${same.name}»${same.isActive ? '' : ' (archived)'} already has this name`,
      );
    }
    const doc = await operationsAreaRepository.create({ ...input, isActive: true }, { by });
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, areaSnapshot(doc)),
    });
    return doc;
  }

  async list(query: ListOperationsReferenceQuery): Promise<Paginated<OperationsAreaDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search !== undefined && query.search !== '') {
      filter.$or = [
        { name: containsText(query.search) },
        { nameEn: containsText(query.search) },
        { governorate: containsText(query.search) },
      ];
    }
    return operationsAreaRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['name', 'governorate', 'createdAt'],
    });
  }

  async update(id: string, input: UpdateOperationsArea, by: string): Promise<OperationsAreaDoc> {
    const before = await operationsAreaRepository.getById(id);
    const { version, ...fields } = input;
    const updated = await operationsAreaRepository.updateById(id, fields, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(areaSnapshot(before), areaSnapshot(updated)),
    });
    return updated;
  }
}

export const operationsAreaService = new OperationsAreaService();
