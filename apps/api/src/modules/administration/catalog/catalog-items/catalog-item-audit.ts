// What a unit's writes leave behind, after the write (design §10.1–§10.2, §19.6): one audit row per
// act under its §10.2 verb, and — for a (de)activation, whose verbs the realtime layer does not
// broadcast — one `update` signal, so every open catalog and item screen reads again.
import { auditService } from '../../../../platform/audit';
import { publishAuditedChange } from '../../../../platform/realtime';
import { diffChanges } from '../../../../shared/utils/diff';
import {
  MASTER_DATA_AUDIT_ACTION,
  masterDataEditAct,
  needsExplicitSignal,
} from '../../shared/master-data';
import { type AdministrationCatalogItemDoc } from './catalog-item.model';

/** The audited unit — a LITERAL pair, so the realtime registry's scan can classify it. */
export const catalogItemEntityRef = (id: string) => ({
  moduleId: 'administration',
  entityType: 'catalogItem',
  entityId: id,
});

/**
 * The unit's facts as the trail compares them. The name is split by language, so a renamed English
 * label is one change; `nameKey` is left out, being the Arabic name folded.
 */
export const catalogItemSnapshot = (
  doc: AdministrationCatalogItemDoc,
): Record<string, unknown> => ({
  kind: doc.kind,
  code: doc.code,
  'name.ar': doc.name.ar,
  'name.en': doc.name.en,
  description: doc.description,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
});

/**
 * The unit's topic, organization-wide: a unit has no branch, so the signal names none and reaches
 * the organization room. Best-effort, as every signal is.
 */
export const signalCatalogItem = (id: string): void => {
  publishAuditedChange({
    entityRef: catalogItemEntityRef(id),
    action: 'update',
    at: new Date().toISOString(),
  });
};

export const auditCatalogItemCreated = async (doc: AdministrationCatalogItemDoc): Promise<void> => {
  await auditService.record({
    entityRef: catalogItemEntityRef(String(doc._id)),
    action: MASTER_DATA_AUDIT_ACTION.create,
    changes: diffChanges({}, catalogItemSnapshot(doc)),
  });
};

/** An edit, a deactivation or a reactivation — one row, and nothing at all when nothing changed. */
export const auditCatalogItemEdited = async (
  before: AdministrationCatalogItemDoc,
  after: AdministrationCatalogItemDoc,
): Promise<void> => {
  const changes = diffChanges(catalogItemSnapshot(before), catalogItemSnapshot(after));
  if (changes.length === 0) return;
  const act = masterDataEditAct(before, after);
  const id = String(after._id);
  await auditService.record({
    entityRef: catalogItemEntityRef(id),
    action: MASTER_DATA_AUDIT_ACTION[act],
    changes,
  });
  if (needsExplicitSignal(act)) signalCatalogItem(id);
};
