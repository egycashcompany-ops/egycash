// What a warehouse's writes leave behind, after the write (design §9.1, §10.1–§10.2, §19.6): one
// audit row per act under its §10.2 verb, and — after EVERY act, whatever its verb — one `update`
// signal WITH the warehouse's branch.
//
// Why a signal after every act: the audit row announces itself to the organization-wide room only
// (it names no branch), and a branch-scoped reader joins only their branch's room, so a store
// created, edited or retired in their branch would refresh nobody's screen there. `activate` and
// `deactivate` are not broadcast at all. The one signal with the branch reaches both rooms — IT's
// `signalConsumable` precedent, here for every act rather than movements only.
import { auditService } from '../../../../platform/audit';
import { publishAuditedChange } from '../../../../platform/realtime';
import { diffChanges } from '../../../../shared/utils/diff';
import { MASTER_DATA_AUDIT_ACTION, masterDataEditAct } from '../../shared/master-data';
import { type AdministrationWarehouseDoc } from './warehouse.model';

/** The audited warehouse — a LITERAL pair, so the realtime registry's scan can classify it. */
export const warehouseEntityRef = (id: string) => ({
  moduleId: 'administration',
  entityType: 'warehouse',
  entityId: id,
});

/**
 * The warehouse's facts as the trail compares them: references as ids (their names are read at
 * read time, never copied — the keeper's above all), the name split by language, and `nameKey`
 * left out, being the Arabic name folded. The branch is in the `create` row and never changes.
 */
export const warehouseSnapshot = (doc: AdministrationWarehouseDoc): Record<string, unknown> => ({
  code: doc.code,
  'name.ar': doc.name.ar,
  'name.en': doc.name.en,
  branchId: String(doc.branchId),
  type: doc.type,
  departmentId: doc.departmentId === null ? null : String(doc.departmentId),
  responsibleEmployeeId:
    doc.responsibleEmployeeId === null ? null : String(doc.responsibleEmployeeId),
  location: doc.location,
  notes: doc.notes,
  isActive: doc.isActive,
});

/** The warehouse's topic, WITH its branch: the organization room and that branch's room both. */
export const signalWarehouse = (id: string, branchId: string): void => {
  publishAuditedChange({
    entityRef: warehouseEntityRef(id),
    action: 'update',
    at: new Date().toISOString(),
    branchId,
  });
};

export const auditWarehouseCreated = async (doc: AdministrationWarehouseDoc): Promise<void> => {
  const id = String(doc._id);
  await auditService.record({
    entityRef: warehouseEntityRef(id),
    action: MASTER_DATA_AUDIT_ACTION.create,
    changes: diffChanges({}, warehouseSnapshot(doc)),
  });
  signalWarehouse(id, String(doc.branchId));
};

/** An edit, a retirement or a reactivation: one row and its signal; nothing if nothing changed. */
export const auditWarehouseEdited = async (
  before: AdministrationWarehouseDoc,
  after: AdministrationWarehouseDoc,
): Promise<void> => {
  const changes = diffChanges(warehouseSnapshot(before), warehouseSnapshot(after));
  if (changes.length === 0) return;
  const id = String(after._id);
  await auditService.record({
    entityRef: warehouseEntityRef(id),
    action: MASTER_DATA_AUDIT_ACTION[masterDataEditAct(before, after)],
    changes,
  });
  signalWarehouse(id, String(after.branchId));
};
