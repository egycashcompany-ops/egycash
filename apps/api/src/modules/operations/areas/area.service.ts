// Operational-area reference admin — the legacy `/data_edit` city section (contad_app.js:2033).
// Audited, no events (the fleet-catalog precedent every other Operations catalog follows).
//
// The legacy screen had one behaviour worth naming: DELETE was soft and had NO referential check
// (:2192), and because branches store the area as a STRING, deleting one orphaned nothing — it
// simply vanished from future suggestions while existing branches kept their text. That is
// PRESERVED here, and it is preserved honestly: deactivating an area takes it out of the
// suggestion list and leaves every branch that already carries the name exactly as it is. There
// is nothing to cascade, because nothing points at it.
import { type Types } from 'mongoose';
import {
  ErrorCodes,
  foldOperationsAreaName,
  type CreateOperationsArea,
  type ListOperationsReferenceQuery,
  type Paginated,
  type UpdateOperationsArea,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { AppError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsAreaRepository } from './area.repository';
import { OperationsAreaModel, type OperationsAreaDoc } from './area.model';
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

/**
 * Round 28c — the live area (active or archived) whose name FOLDS to `name`'s
 * (`foldOperationsAreaName` — «المعادى» beside «المعادي», the article off), `except` the area being
 * renamed; null for none. Read here with the model (Round 28c critic — it leaned on a repository
 * method another round added for its own use). A few hundred rows at most, names only.
 */
const areaHolding = async (
  name: string,
  except?: string,
): Promise<{ name: string; isActive: boolean } | null> => {
  const folded = foldOperationsAreaName(name);
  if (folded === '') return null;
  const live = await OperationsAreaModel.find({ isDeleted: false }, { name: 1, isActive: 1 })
    .lean<{ _id: Types.ObjectId; name: string; isActive: boolean }[]>()
    .exec();
  return (
    live.find(
      (area) => String(area._id) !== except && foldOperationsAreaName(area.name) === folded,
    ) ?? null
  );
};

/**
 * 409 `DUPLICATE` for a name `held` already answers. Round 28c critic — the detail names that
 * area and says whether it is archived (`AREA_ACTIVE` / `AREA_ARCHIVED`, the name its message), so
 * a screen says which area holds the name instead of guessing it was added meanwhile.
 */
const heldName = (held: { name: string; isActive: boolean }): AppError => {
  const message = `the area «${held.name}»${held.isActive ? '' : ' (archived)'} already has this name`;
  return new AppError(ErrorCodes.DUPLICATE, 409, message, {
    details: [
      { field: 'name', code: held.isActive ? 'AREA_ACTIVE' : 'AREA_ARCHIVED', message: held.name },
    ],
  });
};

class OperationsAreaService {
  async create(input: CreateOperationsArea, by: string): Promise<OperationsAreaDoc> {
    // Round 28c — «الاتجاه» on «لوحة التشغيلة» offers «إضافة «…» إلى القائمة» for a name the desk
    // typed. A name that FOLDS to a live area's (an archived one too) is that area, never a second
    // spelling of it: the direction rules would read the two as one. The unique index holds the
    // exact name only; this holds the rest, with the same answer (409 `DUPLICATE`).
    const held = await areaHolding(input.name);
    if (held !== null) throw heldName(held);
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
    // Round 28c critic — and a RENAME to another spelling of a live area is refused alike. Only a
    // new name is checked: an area kept under its name (its English name, archived, restored) is
    // saved whatever another area is called.
    if (fields.name !== undefined && fields.name !== before.name) {
      const held = await areaHolding(fields.name, id);
      if (held !== null) throw heldName(held);
    }
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
