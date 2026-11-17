// Section writes from the org chart (P-ORG-3 §5.3): add a section in the ticked branches, rename it,
// stop it. Each is ONE transaction that first loads what it needs through its session, decides every
// document in memory, then writes — nothing re-reads its own uncommitted writes (§5.4). The audit
// entries and events are returned out of the transaction and sent after it commits, so a rolled-back
// write leaves no audit row and a retried transaction never audits twice.
//
// NO EXISTING ROW IS EVER LINKED HERE (§5.1). Linking a department row widens every «department
// everywhere» role grant to it; a section is added only under department rows ALREADY linked to the
// department's entry, and only those branches may be ticked.
import { Types } from 'mongoose';
import {
  ErrorCodes,
  foldOrgUnitName,
  PlatformEvents,
  type AddChartSection,
  type LocalizedString,
  type RenameChartSection,
  type StopChartSection,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError, StaleDocumentError } from '../../../shared/errors';
import { unitOfWork } from '../../kernel/unit-of-work';
import { auditService, type AuditEntry } from '../../audit';
import { emit } from '../../kernel/event-bus';
import { SectionModel } from '../sections/section.model';
import { SectionCatalogModel } from '../section-catalog/section-catalog.model';
import { sectionRowFields } from '../sections/section-row';
import { catalogNameClash } from '../shared/org-catalog-names';
import { nextFreeCode, nextFreeCodes } from '../shared/next-free-code';
import { indexOrgChart, type ChartDepartmentGroup, type ChartIndex, type ChartInput } from './org-chart.groups';
import { loadOrgChart } from './org-chart.load';

type Event = {
  unitType: 'department' | 'section' | 'departmentCatalog' | 'sectionCatalog';
  unitId: string;
  change: 'created' | 'updated' | 'deleted';
};
interface Effects {
  audits: AuditEntry[];
  events: Event[];
}

const ref = (entityType: string, id: string) => ({ moduleId: 'platform', entityType, entityId: id });

/** The Arabic name folded, else the English one — the `orgUnitGroupKeys` rule. */
const foldOf = (name: LocalizedString): string => {
  const ar = foldOrgUnitName(name.ar);
  return ar !== '' ? ar : foldOrgUnitName(name.en);
};

const notEditable = (what: string): never => {
  throw new BusinessRuleError(`${what} cannot be edited here`, ErrorCodes.ORG_UNIT_NOT_EDITABLE);
};

/** The editable department group of a department entry, or refuse. */
const editableDepartment = (index: ChartIndex, departmentCatalogId: string): ChartDepartmentGroup => {
  const department = index.departmentByEntry.get(departmentCatalogId.toLowerCase());
  if (department === undefined || !department.shown || !department.editable) return notEditable('This department');
  return department;
};

/**
 * Refuse a name another section of the department already has: the catalog's own exact rule, against
 * every section entry of the department entry in any status, and the fold, against every section
 * group of the department group (§5.3 step 1).
 */
const assertSectionNameFree = (
  input: ChartInput,
  department: ChartDepartmentGroup,
  name: LocalizedString,
  exceptEntryId?: string,
): void => {
  const departmentEntryId = department.entry?.id ?? '';
  const siblings = input.sectionEntries.filter((entry) => entry.departmentCatalogId === departmentEntryId);
  const exact = catalogNameClash(name, siblings, exceptEntryId);
  const folded = foldOf(name);
  const foldClash = department.sections.some(
    (section) =>
      section.entry?.id !== exceptEntryId &&
      (foldOf(section.name) === folded || section.rows.some((row) => foldOf(row.name) === folded)),
  );
  if (exact !== null || foldClash) {
    throw new ConflictError('This department already has a section with this name', ErrorCodes.ORG_SECTION_NAME_TAKEN);
  }
};

const flush = async (effects: Effects): Promise<void> => {
  await auditService.recordMany(effects.audits);
  for (const event of effects.events) await emit(PlatformEvents.OrgUnitChanged, event);
};

export const chartSections = {
  /** «إضافة قسم»: a section entry, and one linked row in each ticked branch. */
  async add(input: AddChartSection, by: string): Promise<void> {
    const effects = await unitOfWork(async (session): Promise<Effects> => {
      const chart = await loadOrgChart({ session });
      const index = indexOrgChart(chart);
      const department = editableDepartment(index, input.departmentCatalogId);
      const departmentEntryId = department.entry?.id ?? '';
      assertSectionNameFree(chart, department, input.name);

      // Each ticked branch: the department's ACTIVE row there that is linked to its entry (step 2).
      const rows = input.branchIds.map((branchId) => {
        const row = department.rows.find(
          (r) => r.branchId === branchId.toLowerCase() && r.status === 'active' && r.catalogId === departmentEntryId,
        );
        if (row === undefined) {
          throw new BusinessRuleError(
            'In one of the ticked branches the department does not exist, or is not linked to the company list',
            ErrorCodes.BRANCH_WITHOUT_DEPARTMENT,
          );
        }
        return row;
      });

      const actor = new Types.ObjectId(by);
      const entryId = new Types.ObjectId();
      const entryCode = nextFreeCode('SEC', chart.sectionEntries.map((entry) => entry.code));
      await SectionCatalogModel.create(
        [
          {
            _id: entryId,
            code: entryCode,
            name: input.name,
            description: null,
            status: 'active',
            departmentCatalogId: new Types.ObjectId(departmentEntryId),
            createdBy: actor,
            updatedBy: actor,
          },
        ],
        { session },
      );
      const codes = nextFreeCodes(
        'SEC',
        chart.sectionRows.map((row) => row.code),
        rows.length,
      );
      const created = rows.map((row, i) => {
        const _id = new Types.ObjectId();
        return {
          _id,
          code: codes[i] ?? '',
          name: input.name,
          status: 'active' as const,
          managerId: null,
          actingManager: null,
          description: null,
          createdBy: actor,
          updatedBy: actor,
          ...sectionRowFields(
            { _id: new Types.ObjectId(row.id), branchId: new Types.ObjectId(row.branchId) },
            entryId,
            _id,
          ),
        };
      });
      await SectionModel.create(created, { session, ordered: true });

      return {
        audits: [
          {
            entityRef: ref('sectionCatalog', String(entryId)),
            action: 'create',
            changes: [
              { field: 'code', old: null, new: entryCode },
              { field: 'name', old: null, new: input.name },
              { field: 'departmentCatalogId', old: null, new: departmentEntryId },
            ],
          },
          ...created.map(
            (row): AuditEntry => ({
              entityRef: ref('section', String(row._id)),
              action: 'create',
              changes: [
                { field: 'code', old: null, new: row.code },
                { field: 'name', old: null, new: row.name },
                { field: 'branchId', old: null, new: String(row.branchId) },
              ],
            }),
          ),
        ],
        events: [
          { unitType: 'sectionCatalog', unitId: String(entryId), change: 'created' },
          ...created.map((row): Event => ({ unitType: 'section', unitId: String(row._id), change: 'created' })),
        ],
      };
    });
    await flush(effects);
  },

  /** «تغيير الاسم»: the section entry and every row of its group, linked or not. */
  async rename(sectionCatalogId: string, input: RenameChartSection, by: string): Promise<void> {
    const effects = await unitOfWork(async (session): Promise<Effects> => {
      const chart = await loadOrgChart({ session });
      const index = indexOrgChart(chart);
      const found = index.sectionByEntry.get(sectionCatalogId.toLowerCase());
      if (found === undefined) throw new NotFoundError('No such section');
      if (!found.department.editable || !found.section.editable || !found.section.shown) {
        return notEditable('This section');
      }
      assertSectionNameFree(chart, found.department, input.name, found.section.entry?.id);

      const actor = new Types.ObjectId(by);
      const before = found.section.entry?.name ?? found.section.name;
      const updated = await SectionCatalogModel.findOneAndUpdate(
        { _id: new Types.ObjectId(sectionCatalogId), __v: input.version, isDeleted: false },
        { $set: { name: input.name, updatedBy: actor }, $inc: { __v: 1 } },
        { session, new: true },
      ).exec();
      if (updated === null) throw new StaleDocumentError();
      // Every row of the group follows, linked or not — an unlinked member left on the old name would
      // stop folding with the group and split away from it. `__v` is not raised: as with
      // `renameByCatalog`, an open section form is not made stale by a rename it did not make.
      const rowIds = found.section.rows.map((row) => new Types.ObjectId(row.id));
      await SectionModel.updateMany(
        { _id: { $in: rowIds }, isDeleted: false },
        { $set: { name: input.name, updatedBy: actor } },
        { session },
      ).exec();

      const unlinked = found.section.rows.filter((row) => row.catalogId !== sectionCatalogId.toLowerCase());
      return {
        audits: [
          {
            entityRef: ref('sectionCatalog', sectionCatalogId),
            action: 'update',
            changes: [
              { field: 'name', old: before, new: input.name },
              { field: 'linkedUnitsRenamed', old: null, new: rowIds.length },
            ],
          },
          ...unlinked.map(
            (row): AuditEntry => ({
              entityRef: ref('section', row.id),
              action: 'update',
              changes: [{ field: 'name', old: row.name, new: input.name }],
            }),
          ),
        ],
        events: [{ unitType: 'sectionCatalog', unitId: sectionCatalogId, change: 'updated' }],
      };
    });
    await flush(effects);
  },

  /**
   * «إيقاف القسم»: every active row of the group stops. The entry stays active, so a row restarted on
   * the sections page brings the section back editable, with its places (§5.3).
   */
  async stop(sectionCatalogId: string, input: StopChartSection, by: string): Promise<void> {
    const effects = await unitOfWork(async (session): Promise<Effects> => {
      const chart = await loadOrgChart({ session });
      const index = indexOrgChart(chart);
      const found = index.sectionByEntry.get(sectionCatalogId.toLowerCase());
      if (found === undefined) throw new NotFoundError('No such section');
      if (!found.department.editable || !found.section.editable || !found.section.shown) {
        return notEditable('This section');
      }
      const actor = new Types.ObjectId(by);
      // The entry's version is checked (and raised), so a stop over a rename it never saw is refused.
      const touched = await SectionCatalogModel.findOneAndUpdate(
        { _id: new Types.ObjectId(sectionCatalogId), __v: input.version, isDeleted: false },
        { $set: { updatedBy: actor }, $inc: { __v: 1 } },
        { session, new: true },
      ).exec();
      if (touched === null) throw new StaleDocumentError();
      const stopping = found.section.rows.filter((row) => row.status === 'active');
      // `__v` IS raised here: the rows' status changed, and an open form that still says "active"
      // must not quietly restart them on its next save.
      await SectionModel.updateMany(
        { _id: { $in: stopping.map((row) => new Types.ObjectId(row.id)) }, isDeleted: false },
        { $set: { status: 'inactive', updatedBy: actor }, $inc: { __v: 1 } },
        { session },
      ).exec();
      return {
        audits: [
          {
            entityRef: ref('sectionCatalog', sectionCatalogId),
            action: 'update',
            changes: [{ field: 'stoppedRows', old: null, new: stopping.map((row) => row.code) }],
          },
          ...stopping.map(
            (row): AuditEntry => ({
              entityRef: ref('section', row.id),
              action: 'update',
              changes: [{ field: 'status', old: 'active', new: 'inactive' }],
            }),
          ),
        ],
        events: stopping.map((row): Event => ({ unitType: 'section', unitId: row.id, change: 'updated' })),
      };
    });
    await flush(effects);
  },
};
