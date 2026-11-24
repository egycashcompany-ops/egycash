// What a supplier's writes leave behind, after the write (design §10.1–§10.2, §11.4, §19.6): one
// audit row per act under its §10.2 verb; for a (de)activation, whose verbs the realtime layer does
// not broadcast, one `update` signal, so every open supplier screen reads again; and for a paper
// linked or removed, one `update` row naming it — a broadcast verb, which reaches the organization
// room by itself, since a supplier has no branch (§9.3).
import { ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY } from '@ecms/contracts';
import { auditService } from '../../../../platform/audit';
import { publishAuditedChange } from '../../../../platform/realtime';
import { diffChanges } from '../../../../shared/utils/diff';
import {
  MASTER_DATA_AUDIT_ACTION,
  masterDataEditAct,
  needsExplicitSignal,
} from '../../shared/master-data';
import { type AdministrationSupplierDoc } from './supplier.model';

/**
 * The audited supplier — a LITERAL pair, so the realtime registry's scan can classify it. Its
 * papers are filed under the same pair, so they need no classification of their own (§11.1).
 */
export const supplierEntityRef = (id: string) => ({
  moduleId: 'administration',
  entityType: 'supplier',
  entityId: id,
});

/**
 * The supplier's facts as the trail compares them: categories as ids (their names are read at
 * read time, never copied), the name split by language, and `nameKey` left out, being the Arabic
 * name folded. The code is in the `create` row and never changes after it. The papers are not
 * here: each link is its own row (§11.4).
 */
export const supplierSnapshot = (doc: AdministrationSupplierDoc): Record<string, unknown> => ({
  code: doc.code,
  'name.ar': doc.name.ar,
  'name.en': doc.name.en,
  phone: doc.phone,
  email: doc.email,
  address: doc.address,
  contacts: doc.contacts,
  categoryIds: doc.categoryIds.map(String),
  taxNumber: doc.taxNumber,
  commercialRegistry: doc.commercialRegistry,
  vatStatus: doc.vatStatus,
  paymentTerms: doc.paymentTerms,
  notes: doc.notes,
  isActive: doc.isActive,
});

/** The supplier's topic, organization-wide: a supplier has no branch, so the signal names none. */
export const signalSupplier = (id: string): void => {
  publishAuditedChange({
    entityRef: supplierEntityRef(id),
    action: 'update',
    at: new Date().toISOString(),
  });
};

export const auditSupplierCreated = async (doc: AdministrationSupplierDoc): Promise<void> => {
  await auditService.record({
    entityRef: supplierEntityRef(String(doc._id)),
    action: MASTER_DATA_AUDIT_ACTION.create,
    changes: diffChanges({}, supplierSnapshot(doc)),
  });
};

/** An edit, a deactivation or a reactivation — one row, and nothing at all when nothing changed. */
export const auditSupplierEdited = async (
  before: AdministrationSupplierDoc,
  after: AdministrationSupplierDoc,
): Promise<void> => {
  const changes = diffChanges(supplierSnapshot(before), supplierSnapshot(after));
  if (changes.length === 0) return;
  const act = masterDataEditAct(before, after);
  const id = String(after._id);
  await auditService.record({
    entityRef: supplierEntityRef(id),
    action: MASTER_DATA_AUDIT_ACTION[act],
    changes,
  });
  if (needsExplicitSignal(act)) signalSupplier(id);
};

/** The `attachment` pseudo-field's value (§11.4): the purpose the paper was filed under, and its label. */
const paperOf = (label: string): string =>
  `${ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY}:${label}`;

/** A paper linked: one `update` row, `attachment` from nothing to the paper. */
export const auditSupplierPaperAdded = async (id: string, label: string): Promise<void> => {
  await auditService.record({
    entityRef: supplierEntityRef(id),
    action: MASTER_DATA_AUDIT_ACTION.edit,
    changes: [{ field: 'attachment', old: null, new: paperOf(label) }],
  });
};

/** A paper's link removed: one `update` row, `attachment` from the paper to nothing. */
export const auditSupplierPaperRemoved = async (id: string, label: string): Promise<void> => {
  await auditService.record({
    entityRef: supplierEntityRef(id),
    action: MASTER_DATA_AUDIT_ACTION.edit,
    changes: [{ field: 'attachment', old: paperOf(label), new: null }],
  });
};
