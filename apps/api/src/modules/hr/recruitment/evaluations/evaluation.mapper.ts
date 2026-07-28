// Evaluation + phase DTO mapping. Dates are ISO strings; ids are stringified.
import {
  type EvaluationDto,
  type EvaluationFileDto,
  type EvaluationPhaseDto,
} from '@ecms/contracts';
import {
  attemptMarkerDto,
  placementDto,
  placementDtoOrNull,
  placementLabelDto,
} from '../workflow/stage-mapper';
import { type EvaluationPhaseDoc } from './evaluation-phase.model';
import { type EvaluationDoc, type EvaluationFile } from './evaluation.model';

export const toEvaluationPhaseDto = (doc: EvaluationPhaseDoc): EvaluationPhaseDto => ({
  id: String(doc._id),
  key: doc.key,
  name: doc.name,
  order: doc.order,
  active: doc.active,
  driversOnly: doc.applicability === 'driversOnly' || doc.driversOnly,
  kind: doc.kind ?? 'individual',
  applicability: doc.applicability ?? (doc.driversOnly ? 'driversOnly' : 'all'),
  permissionResource: doc.permissionResource ?? 'evaluation',
  appointmentEnabled: doc.appointmentEnabled ?? false,
  requiresResultDocument: doc.requiresResultDocument ?? false,
  route: `/evaluations/phase/${doc.key}`,
  version: doc.__v,
});

const fileDto = (f: EvaluationFile): EvaluationFileDto => ({
  fileId: String(f.fileId),
  fileName: f.fileName,
  note: f.note,
  uploadedBy: f.uploadedBy === null ? null : String(f.uploadedBy),
  uploadedAt: f.uploadedAt.toISOString(),
});

export const toEvaluationDto = (doc: EvaluationDoc): EvaluationDto => ({
  id: String(doc._id),
  applicantId: String(doc.applicantId),
  applicantCode: doc.applicantCode,
  applicantName: doc.applicantName ?? '',
  branchId: doc.branchId === null ? null : String(doc.branchId),
  phaseId: String(doc.phaseId),
  phaseKey: doc.phaseKey,
  phaseName: doc.phaseName,
  placement: placementDto(doc.placementSnapshot),
  placementLabel: placementLabelDto(doc.placementSnapshotLabel),
  recommendedPlacement: placementDtoOrNull(doc.recommendedPlacement),
  recommendationNote: doc.recommendationNote ?? null,
  batchId: doc.batchId == null ? null : String(doc.batchId),
  batchCode: doc.batchCode ?? null,
  appointmentAt: doc.appointmentAt == null ? null : doc.appointmentAt.toISOString(),
  ...attemptMarkerDto(doc),
  phaseOrder: doc.phaseOrder,
  phaseKind: doc.phaseKind ?? 'individual',
  status: doc.status,
  reason: doc.reason,
  files: doc.files.map(fileDto),
  decidedBy: doc.decidedBy === null ? null : String(doc.decidedBy),
  decidedAt: doc.decidedAt === null ? null : doc.decidedAt.toISOString(),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
