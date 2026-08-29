// Documents → DTOs.
//
// EVERY FIELD IS RETURNED, and there is no «summary» shape. A masked or partial clinical DTO would
// be a second answer to «who may see what», sitting beside the permission that already answers it —
// and the two would drift. The gate is the key (D3); once through it, the record is the record.
import { type MedicalProfileDto } from '@ecms/contracts';
import { type MedicalProfileDoc } from './profiles/medical-profile.model';

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
