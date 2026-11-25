// What an item's writes leave behind, after the write (design §10.1–§10.2, §19.6): one audit row
// per act under its §10.2 verb, and — for a (de)activation, whose verbs the realtime layer does not
// broadcast — one `update` signal, so every open item screen reads again.
import { auditService } from '../../../../platform/audit';
import { publishAuditedChange } from '../../../../platform/realtime';
import { diffChanges } from '../../../../shared/utils/diff';
import {
  MASTER_DATA_AUDIT_ACTION,
  masterDataEditAct,
  needsExplicitSignal,
} from '../../shared/master-data';
import { type AdministrationItemDoc } from './item.model';

/** The audited item — a LITERAL pair, so the realtime registry's scan can classify it. */
export const itemEntityRef = (id: string) => ({
  moduleId: 'administration',
  entityType: 'item',
  entityId: id,
});

/**
 * The item's facts as the trail compares them: references as ids (their names are read at read
 * time, never copied), the name split by language, and `nameKey` left out, being the Arabic name
 * folded. The code is in the `create` row and never changes after it.
 */
export const itemSnapshot = (doc: AdministrationItemDoc): Record<string, unknown> => ({
  code: doc.code,
  barcode: doc.barcode,
  'name.ar': doc.name.ar,
  'name.en': doc.name.en,
  categoryId: String(doc.categoryId),
  unitId: String(doc.unitId),
  minQty: doc.minQty,
  reorderPointQty: doc.reorderPointQty,
  maxQty: doc.maxQty,
  description: doc.description,
  notes: doc.notes,
  isActive: doc.isActive,
});

/** The item's topic, organization-wide: an item has no branch, so the signal names none. */
export const signalItem = (id: string): void => {
  publishAuditedChange({
    entityRef: itemEntityRef(id),
    action: 'update',
    at: new Date().toISOString(),
  });
};

export const auditItemCreated = async (doc: AdministrationItemDoc): Promise<void> => {
  await auditService.record({
    entityRef: itemEntityRef(String(doc._id)),
    action: MASTER_DATA_AUDIT_ACTION.create,
    changes: diffChanges({}, itemSnapshot(doc)),
  });
};

/** An edit, a deactivation or a reactivation — one row, and nothing at all when nothing changed. */
export const auditItemEdited = async (
  before: AdministrationItemDoc,
  after: AdministrationItemDoc,
): Promise<void> => {
  const changes = diffChanges(itemSnapshot(before), itemSnapshot(after));
  if (changes.length === 0) return;
  const act = masterDataEditAct(before, after);
  const id = String(after._id);
  await auditService.record({
    entityRef: itemEntityRef(id),
    action: MASTER_DATA_AUDIT_ACTION[act],
    changes,
  });
  if (needsExplicitSignal(act)) signalItem(id);
};
