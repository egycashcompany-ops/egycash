// Evaluation + phase DTO mapping. Dates are ISO strings; ids are stringified.
import {
  type EvaluationDecisionEventDto,
  type EvaluationDto,
  type EvaluationFileDto,
  type EvaluationPhaseDto,
} from '@ecms/contracts';
import { type EvaluationPhaseDoc } from './evaluation-phase.model';
import { type EvaluationDecisionEvent, type EvaluationDoc, type EvaluationFile } from './evaluation.model';

const decisionEventDto = (e: EvaluationDecisionEvent): EvaluationDecisionEventDto => ({
  at: e.at.toISOString(),
  from: e.from,
  to: e.to,
  reason: e.reason,
  by: e.by === null ? null : String(e.by),
});

export const toEvaluationPhaseDto = (doc: EvaluationPhaseDoc): EvaluationPhaseDto => ({
  id: String(doc._id),
  key: doc.key,
  name: doc.name,
  order: doc.order,
  active: doc.active,
  driversOnly: doc.driversOnly,
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
  branchId: doc.branchId === null ? null : String(doc.branchId),
  phaseId: String(doc.phaseId),
  phaseKey: doc.phaseKey,
  phaseName: doc.phaseName,
  phaseOrder: doc.phaseOrder,
  status: doc.status,
  reason: doc.reason,
  files: doc.files.map(fileDto),
  decidedBy: doc.decidedBy === null ? null : String(doc.decidedBy),
  decidedAt: doc.decidedAt === null ? null : doc.decidedAt.toISOString(),
  decisionHistory: (doc.decisionHistory ?? []).map(decisionEventDto),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
