// What a category's writes leave behind, after the write (design §10.1–§10.2, §19.6): one audit row
// per act under its §10.2 verb, and — for a (de)activation, whose verbs the realtime layer does not
// broadcast — one `update` signal, so every open catalog and item screen reads again.
import { auditService } from '../../../../platform/audit';
import { publishAuditedChange } from '../../../../platform/realtime';
import { diffChanges } from '../../../../shared/utils/diff';
import {
  MASTER_DATA_AUDIT_ACTION,
  masterDataEditAct,
  needsExplicitSignal,
} from '../../shared/master-data';
import { type AdministrationItemCategoryDoc } from './item-category.model';

/** The audited category — a LITERAL pair, so the realtime registry's scan can classify it. */
export const itemCategoryEntityRef = (id: string) => ({
  moduleId: 'administration',
  entityType: 'itemCategory',
  entityId: id,
});

/**
 * The category's facts as the trail compares them: a move is a `parentId` change, the name is
 * split by language, and `nameKey` is left out, being the Arabic name folded.
 */
export const itemCategorySnapshot = (
  doc: AdministrationItemCategoryDoc,
): Record<string, unknown> => ({
  code: doc.code,
  'name.ar': doc.name.ar,
  'name.en': doc.name.en,
  parentId: doc.parentId === null ? null : String(doc.parentId),
  description: doc.description,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
});

/** The category's topic, organization-wide: a category has no branch, so the signal names none. */
export const signalItemCategory = (id: string): void => {
  publishAuditedChange({
    entityRef: itemCategoryEntityRef(id),
    action: 'update',
    at: new Date().toISOString(),
  });
};

export const auditItemCategoryCreated = async (
  doc: AdministrationItemCategoryDoc,
): Promise<void> => {
  await auditService.record({
    entityRef: itemCategoryEntityRef(String(doc._id)),
    action: MASTER_DATA_AUDIT_ACTION.create,
    changes: diffChanges({}, itemCategorySnapshot(doc)),
  });
};

/** An edit, a move, a deactivation or a reactivation — one row, and none when nothing changed. */
export const auditItemCategoryEdited = async (
  before: AdministrationItemCategoryDoc,
  after: AdministrationItemCategoryDoc,
): Promise<void> => {
  const changes = diffChanges(itemCategorySnapshot(before), itemCategorySnapshot(after));
  if (changes.length === 0) return;
  const act = masterDataEditAct(before, after);
  const id = String(after._id);
  await auditService.record({
    entityRef: itemCategoryEntityRef(id),
    action: MASTER_DATA_AUDIT_ACTION[act],
    changes,
  });
  if (needsExplicitSignal(act)) signalItemCategory(id);
};
