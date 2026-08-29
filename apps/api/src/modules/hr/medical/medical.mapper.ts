// Documents → DTOs.
//
// EVERY FIELD IS RETURNED, and there is no «summary» shape. A masked or partial clinical DTO would
// be a second answer to «who may see what», sitting beside the permission that already answers it —
// and the two would drift. The gate is the key (D3); once through it, the record is the record.
import { type MedicalEventDto, type MedicalProfileDto } from '@ecms/contracts';
import { type MedicalProfileDoc } from './profiles/medical-profile.model';
import { type MedicalEventDoc } from './events/medical-event.model';

export const toMedicalProfileDto = (doc: MedicalProfileDoc): MedicalProfileDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  employeeName: doc.employeeName,
  bloodType: doc.bloodType,
  chronicConditions: doc.chronicConditions,
  allergies: doc.allergies,
  hasDisability: doc.hasDisability,
  disabilityNote: doc.disabilityNote,
  note: doc.note,
  updatedAt: doc.updatedAt.toISOString(),
  version: doc.__v,
});

/**
 * The event, with its document passed in rather than read off the row.
 *
 * The row holds no file link (D9 — it can never be written after it is recorded), so the caller
 * resolves the document by entity and hands it here. An explicit argument rather than a lookup
 * inside the mapper, because a mapper that queried would make rendering a list of twenty events
 * twenty round trips.
 */
export const toMedicalEventDto = (
  doc: MedicalEventDoc,
  document: { id: string; name: string } | null,
): MedicalEventDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  employeeName: doc.employeeName,
  type: doc.type,
  occurredOn: doc.occurredOn.toISOString(),
  provider: doc.provider,
  verdict: doc.verdict,
  restriction: doc.restriction,
  validUntil: doc.validUntil === null ? null : doc.validUntil.toISOString(),
  note: doc.note,
  documentFileId: document?.id ?? null,
  documentFileName: document?.name ?? null,
  recordedAt: doc.createdAt.toISOString(),
  version: doc.__v,
});
