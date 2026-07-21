// HR / Recruitment — Electronic Employee File (Stage 7). The final stage of the approved
// seven-stage recruitment workflow and the handoff artifact to the Employee module (BD-008):
// once an employee's hiring documents are completed, their Electronic Employee File is
// assembled — it LINKS all applicant history (screening, interviews, offer, hiring documents)
// and starts the EMPLOYEE TIMELINE from the recruitment milestones. After this, the person is
// officially an Employee and further concerns belong to the Employee module. Scope is Stage 7
// only: this stage assembles and reads; it does not own the post-hire employee lifecycle.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

export const EMPLOYEE_FILE_STATUSES = ['active', 'archived'] as const;
export const EmployeeFileStatusSchema = z.enum(EMPLOYEE_FILE_STATUSES);
export type EmployeeFileStatus = z.infer<typeof EmployeeFileStatusSchema>;

/** Milestone types the initial Employee Timeline is built from (plus free-form `note`). */
export const EMPLOYEE_TIMELINE_EVENT_TYPES = [
  'applicantRegistered',
  'screeningAccepted',
  'interviewPassed',
  'offerAccepted',
  'employeeCreated',
  'hiringDocumentsCompleted',
  'fileOpened',
  'note',
] as const;
export const EmployeeTimelineEventTypeSchema = z.enum(EMPLOYEE_TIMELINE_EVENT_TYPES);
export type EmployeeTimelineEventType = z.infer<typeof EmployeeTimelineEventTypeSchema>;

// ── Create / annotate ───────────────────────────────────────────────────────

/** Assemble the Electronic Employee File for an employee whose hiring documents are complete. */
export const CreateEmployeeFileSchema = z.object({ employeeId: objectId() }).strict();
export type CreateEmployeeFile = z.infer<typeof CreateEmployeeFileSchema>;

/** Append a free-form note to the Employee Timeline (keeps the timeline growable). */
export const AddEmployeeFileNoteSchema = z
  .object({ note: z.string().min(1).max(2000), version: z.number().int().min(0) })
  .strict();
export type AddEmployeeFileNote = z.infer<typeof AddEmployeeFileNoteSchema>;

export const ListEmployeeFilesQuerySchema = PaginationQuerySchema.extend({
  status: EmployeeFileStatusSchema.optional(),
  employeeId: objectId().optional(),
  applicantId: objectId().optional(),
  branchId: objectId().optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListEmployeeFilesQuery = z.infer<typeof ListEmployeeFilesQuerySchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface EmployeeTimelineEntryDto {
  at: string;
  type: EmployeeTimelineEventType;
  /** The linked aggregate kind/id this milestone refers to (null for `fileOpened`/`note`). */
  refType: string | null;
  refId: string | null;
  detail: string | null;
  by: string | null;
}

/** The linked recruitment history (BD-008 — "link all applicant history"). */
export interface EmployeeFileLinksDto {
  applicantId: string;
  /** null when the applicant was a direct intake with no linked Job Request. */
  jobRequisitionId: string | null;
  screeningId: string | null;
  interviewIds: string[];
  jobOfferId: string | null;
  hiringDocumentsId: string;
}

export interface EmployeeFileDto {
  id: string;
  employeeId: string;
  employeeCode: string;
  applicantId: string;
  branchId: string;
  status: EmployeeFileStatus;
  links: EmployeeFileLinksDto;
  timeline: EmployeeTimelineEntryDto[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrEmployeeFileEvents = {
  Created: 'hr.employeeFile.created',
  NoteAdded: 'hr.employeeFile.noteAdded',
} as const;
export type HrEmployeeFileEventName = (typeof HrEmployeeFileEvents)[keyof typeof HrEmployeeFileEvents];

export const EmployeeFileEventPayloadV1 = z.object({
  employeeFileId: objectId(),
  employeeId: objectId(),
  employeeCode: z.string(),
});

// ── Notification template key (seeded at boot by the HR module) ─────────────

export const HrEmployeeFileTemplates = {
  Created: 'hr.employeeFileCreated',
} as const;
