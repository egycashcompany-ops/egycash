// Record DTO mapping. Every field is a copy the record already holds — nothing is resolved here,
// which is the whole of D8 restated at the edge: what this returns cannot depend on a course or a
// session still existing under the name it had.
import { type TrainingRecordDto } from '@ecms/contracts';
import { type TrainingRecordDoc } from './training-record.model';

export const toTrainingRecordDto = (doc: TrainingRecordDoc): TrainingRecordDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  employeeName: doc.employeeName,
  courseId: String(doc.courseId),
  courseKey: doc.courseKey,
  courseNameAr: doc.courseNameAr,
  courseNameEn: doc.courseNameEn,
  sessionId: String(doc.sessionId),
  sessionCode: doc.sessionCode,
  trainerName: doc.trainerName,
  startedAt: doc.startedAt.toISOString(),
  completedAt: doc.completedAt.toISOString(),
  expiresAt: doc.expiresAt === null ? null : doc.expiresAt.toISOString(),
  certificateFileId: doc.certificateFileId === null ? null : String(doc.certificateFileId),
  certificateFileName: doc.certificateFileName,
  note: doc.note,
  createdAt: doc.createdAt.toISOString(),
});
