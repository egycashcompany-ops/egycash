// A department or section row created without a `catalogId` is linked to the company list when it is
// created (P-ORG-3 §5.6, D-ORG3-5: «أيوه، يتربط تلقائيًا»).
//
// A SECOND STEP, AFTER THE ROW EXISTS. The row is created exactly as before; this then links it in
// its own transaction. Whatever goes wrong here — an ambiguous name, a clash, a code taken, a database
// error — the answer is the row as every row was before this design: unlinked. Never an entry
// without its row.
//
// ONLY NEW ROWS. Linking an EXISTING department row widens every «department everywhere» role grant
// to it (`rbac.service.ts` `resolveReach`); that stays the operator's deliberate act (§5.1). A row
// being created has nobody's reach yet — joining "that department everywhere" from the day it exists
// is what ADR-031 and ADR-032 meant a branch's copy to do.
import { Types } from 'mongoose';
import { foldOrgUnitName, type LocalizedString } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { unitOfWork } from '../../kernel/unit-of-work';
import { auditService, type AuditEntry } from '../../audit';
import { DepartmentModel, type DepartmentDoc } from '../departments/department.model';
import { SectionModel, type SectionDoc } from '../sections/section.model';
import { DepartmentCatalogModel } from '../department-catalog/department-catalog.model';
import { SectionCatalogModel } from '../section-catalog/section-catalog.model';
import { JobPlaceFillModel } from '../job-places/job-place-fill.model';
import { catalogNameClash } from '../shared/org-catalog-names';

const foldOf = (name: LocalizedString): string => {
  const ar = foldOrgUnitName(name.ar);
  return ar !== '' ? ar : foldOrgUnitName(name.en);
};

const ref = (entityType: string, id: string) => ({ moduleId: 'platform', entityType, entityId: id });

interface Entry {
  id: string;
  code: string;
  name: LocalizedString;
  status: 'active' | 'inactive';
}

/** What to do with the new row: link to an entry, create one, or leave it as today. */
type Decision = { kind: 'leave'; why: string } | { kind: 'link'; entryId: string } | { kind: 'create' };

/**
 * The decision, pure. `others` are the live rows in scope OTHER than the new one; `linkedHere` says
 * whether the new row's own parent (its branch, or its department row) already has a row linked to a
 * given entry.
 */
export const decideLink = (
  row: { name: LocalizedString },
  entries: readonly Entry[],
  others: readonly { name: LocalizedString; catalogId: string | null }[],
  linkedHere: (entryId: string) => boolean,
): Decision => {
  const fold = foldOf(row.name);
  if (fold === '') return { kind: 'leave', why: 'the name folds to nothing' };
  // An unlinked row of that name already exists: that group is the operator command's to link, and
  // it must never meet an entry it did not plan (§5.6).
  if (others.some((other) => other.catalogId === null && foldOf(other.name) === fold)) {
    return { kind: 'leave', why: 'an unlinked row of that name already exists' };
  }
  const matches = entries.filter((entry) => entry.status === 'active' && foldOf(entry.name) === fold);
  if (matches.length > 1) return { kind: 'leave', why: 'the name matches more than one entry' };
  const [match] = matches;
  if (match !== undefined) {
    return linkedHere(match.id)
      ? { kind: 'leave', why: 'this parent already has a row linked to that entry' }
      : { kind: 'link', entryId: match.id };
  }
  if (catalogNameClash(row.name, entries) !== null) {
    return { kind: 'leave', why: 'an entry already has exactly this name' };
  }
  return { kind: 'create' };
};

const toEntry = (doc: {
  _id: Types.ObjectId;
  code: string;
  name: LocalizedString;
  status: 'active' | 'inactive';
}): Entry => ({ id: String(doc._id), code: doc.code, name: doc.name, status: doc.status });

const settle = async (audits: AuditEntry[]): Promise<void> => {
  if (audits.length > 0) await auditService.recordMany(audits);
};

export const linkNewDepartmentRow = async (doc: DepartmentDoc, by: string): Promise<DepartmentDoc> => {
  if (doc.catalogId != null) return doc;
  try {
    const audits = await unitOfWork(async (session): Promise<AuditEntry[]> => {
      const [entries, rows] = await Promise.all([
        DepartmentCatalogModel.find({ isDeleted: false }).session(session).lean().exec(),
        DepartmentModel.find({ isDeleted: false, _id: { $ne: doc._id } }, { name: 1, catalogId: 1, branchId: 1 })
          .session(session)
          .lean()
          .exec(),
      ]);
      const decision = decideLink(
        doc,
        entries.map(toEntry),
        rows.map((row) => ({ name: row.name, catalogId: row.catalogId == null ? null : String(row.catalogId) })),
        (entryId) =>
          rows.some((row) => String(row.branchId) === String(doc.branchId) && String(row.catalogId) === entryId),
      );
      if (decision.kind === 'leave') {
        logger.info({ departmentId: String(doc._id), why: decision.why }, 'department left unlinked at creation');
        return [];
      }
      const actor = new Types.ObjectId(by);
      const out: AuditEntry[] = [];
      let entryId: Types.ObjectId;
      if (decision.kind === 'create') {
        entryId = new Types.ObjectId();
        // The row's own code: it has just claimed it among rows; `ux_code` refuses if an entry holds it,
        // and the step falls back to the unlinked row.
        await DepartmentCatalogModel.create(
          [{ _id: entryId, code: doc.code, name: doc.name, description: null, status: 'active', createdBy: actor, updatedBy: actor }],
          { session },
        );
        // A department that exists from this moment has nobody in it to fill from (§7).
        await JobPlaceFillModel.create([{ departmentCatalogId: entryId, at: new Date(), placed: 0 }], { session });
        out.push({
          entityRef: ref('departmentCatalog', String(entryId)),
          action: 'create',
          changes: [
            { field: 'code', old: null, new: doc.code },
            { field: 'name', old: null, new: doc.name },
          ],
        });
      } else {
        entryId = new Types.ObjectId(decision.entryId);
      }
      await DepartmentModel.updateOne({ _id: doc._id }, { $set: { catalogId: entryId } }, { session }).exec();
      out.push({
        entityRef: ref('department', String(doc._id)),
        action: 'update',
        changes: [{ field: 'catalogId', old: null, new: String(entryId) }],
      });
      return out;
    });
    await settle(audits);
  } catch (error) {
    logger.warn({ err: error, departmentId: String(doc._id) }, 'department left unlinked: linking at creation failed');
  }
  return (await DepartmentModel.findById(doc._id).lean<DepartmentDoc>().exec()) ?? doc;
};

export const linkNewSectionRow = async (doc: SectionDoc, by: string): Promise<SectionDoc> => {
  if (doc.catalogId != null) return doc;
  try {
    const audits = await unitOfWork(async (session): Promise<AuditEntry[]> => {
      const department = await DepartmentModel.findById(doc.departmentId).session(session).lean().exec();
      const departmentEntryId = department?.catalogId == null ? null : String(department.catalogId);
      if (departmentEntryId === null) return [];
      const departmentEntry = await DepartmentCatalogModel.findById(departmentEntryId).session(session).lean().exec();
      // The section catalog's own create refuses a stopped parent; so does this step (§5.6).
      if (departmentEntry === null || departmentEntry.status !== 'active') return [];
      const departmentRows = await DepartmentModel.find(
        { isDeleted: false, catalogId: new Types.ObjectId(departmentEntryId) },
        { _id: 1 },
      )
        .session(session)
        .lean()
        .exec();
      const [entries, rows] = await Promise.all([
        SectionCatalogModel.find({ isDeleted: false, departmentCatalogId: new Types.ObjectId(departmentEntryId) })
          .session(session)
          .lean()
          .exec(),
        SectionModel.find(
          { isDeleted: false, _id: { $ne: doc._id }, departmentId: { $in: departmentRows.map((row) => row._id) } },
          { name: 1, catalogId: 1, departmentId: 1 },
        )
          .session(session)
          .lean()
          .exec(),
      ]);
      const decision = decideLink(
        doc,
        entries.map(toEntry),
        rows.map((row) => ({ name: row.name, catalogId: row.catalogId == null ? null : String(row.catalogId) })),
        (entryId) =>
          rows.some((row) => String(row.departmentId) === String(doc.departmentId) && String(row.catalogId) === entryId),
      );
      if (decision.kind === 'leave') {
        logger.info({ sectionId: String(doc._id), why: decision.why }, 'section left unlinked at creation');
        return [];
      }
      const actor = new Types.ObjectId(by);
      const out: AuditEntry[] = [];
      let entryId: Types.ObjectId;
      if (decision.kind === 'create') {
        entryId = new Types.ObjectId();
        await SectionCatalogModel.create(
          [
            {
              _id: entryId,
              code: doc.code,
              name: doc.name,
              description: null,
              status: 'active',
              departmentCatalogId: new Types.ObjectId(departmentEntryId),
              createdBy: actor,
              updatedBy: actor,
            },
          ],
          { session },
        );
        out.push({
          entityRef: ref('sectionCatalog', String(entryId)),
          action: 'create',
          changes: [
            { field: 'code', old: null, new: doc.code },
            { field: 'name', old: null, new: doc.name },
            { field: 'departmentCatalogId', old: null, new: departmentEntryId },
          ],
        });
      } else {
        entryId = new Types.ObjectId(decision.entryId);
      }
      await SectionModel.updateOne({ _id: doc._id }, { $set: { catalogId: entryId } }, { session }).exec();
      out.push({
        entityRef: ref('section', String(doc._id)),
        action: 'update',
        changes: [{ field: 'catalogId', old: null, new: String(entryId) }],
      });
      return out;
    });
    await settle(audits);
  } catch (error) {
    logger.warn({ err: error, sectionId: String(doc._id) }, 'section left unlinked: linking at creation failed');
  }
  return (await SectionModel.findById(doc._id).lean<SectionDoc>().exec()) ?? doc;
};
