// Documents → DTOs. Dates as ISO strings, ids as strings, and the scale reassembled.
//
// THE SCALE IS STORED FLAT AND READ AS AN OBJECT, and the seam is here rather than in the model
// because Mongo indexes and validates flat fields better than nested ones while a caller wants the
// scale as the single thing it is. The union the scope is stored as gets the same treatment:
// three columns in, one discriminated value out.
import {
  type PerformanceCycleDto,
  type PerformanceGoalDto,
  type PerformanceCycleScope,
  type PerformanceReviewDto,
  type PerformanceScale,
} from '@ecms/contracts';
import { type PerformanceCycleDoc } from './cycles/performance-cycle.model';
import { type PerformanceReviewDoc } from './reviews/performance-review.model';
import { type PerformanceGoalDoc } from './goals/performance-goal.model';

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

const scaleOf = (doc: PerformanceCycleDoc): PerformanceScale => ({
  min: doc.scaleMin,
  max: doc.scaleMax,
  ...(doc.scaleLabels.length > 0
    ? { labels: doc.scaleLabels.map((label) => ({ value: label.value, name: label.name })) }
    : {}),
});

/**
 * The scope, back as the union it was given as.
 *
 * `everyone` is reconstructed from `scopeKind` and NOT from «both lists are empty» — the two would
 * usually agree, and the day they did not, a filter that had lost its criteria would read back as
 * the whole company. That is precisely the mistake `PerformanceCycleScopeSchema` refuses on the way
 * in, and it would be pointless to refuse it there and reintroduce it here.
 */
const scopeOf = (doc: PerformanceCycleDoc): PerformanceCycleScope =>
  doc.scopeKind === 'everyone'
    ? { kind: 'everyone' }
    : {
        kind: 'filter',
        ...(doc.scopeBranchIds.length > 0 ? { branchIds: doc.scopeBranchIds.map(String) } : {}),
        ...(doc.scopeDepartmentIds.length > 0
          ? { departmentIds: doc.scopeDepartmentIds.map(String) }
          : {}),
      };

export const toPerformanceCycleDto = (doc: PerformanceCycleDoc): PerformanceCycleDto => ({
  id: String(doc._id),
  name: doc.name,
  periodStart: doc.periodStart.toISOString(),
  periodEnd: doc.periodEnd.toISOString(),
  status: doc.status,
  scope: scopeOf(doc),
  scale: scaleOf(doc),
  dueAt: iso(doc.dueAt),
  note: doc.note,
  openedAt: iso(doc.openedAt),
  reviewCount: doc.reviewCount,
  closedAt: iso(doc.closedAt),
  version: doc.__v,
});

export const toPerformanceReviewDto = (doc: PerformanceReviewDoc): PerformanceReviewDto => ({
  id: String(doc._id),
  cycleId: String(doc.cycleId),
  cycleName: doc.cycleName,
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  employeeName: doc.employeeName,
  evaluatorId: doc.evaluatorId === null ? null : String(doc.evaluatorId),
  evaluatorName: doc.evaluatorName,
  status: doc.status,
  rating: doc.rating,
  strengths: doc.strengths,
  improvements: doc.improvements,
  returnedReason: doc.returnedReason,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  departmentId: doc.departmentId === null ? null : String(doc.departmentId),
  submittedAt: iso(doc.submittedAt),
  finalizedAt: iso(doc.finalizedAt),
  excusedAt: iso(doc.excusedAt),
  excusedReason: doc.excusedReason,
  version: doc.__v,
});

/**
 * The goal.
 *
 * NOTHING IS DERIVED HERE. There is no `progressPercent` computed from `currentValue` over
 * `targetValue`, and its absence is D9 in the mapper: a percentage is a rating wearing a different
 * unit, and the moment one exists somebody puts it beside an assessment. The screen shows the two
 * numbers side by side and lets the reader do the arithmetic they are qualified to do.
 */
export const toPerformanceGoalDto = (doc: PerformanceGoalDoc): PerformanceGoalDto => ({
  id: String(doc._id),
  reviewId: String(doc.reviewId),
  cycleId: String(doc.cycleId),
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  employeeName: doc.employeeName,
  title: doc.title,
  description: doc.description,
  targetValue: doc.targetValue,
  currentValue: doc.currentValue,
  unit: doc.unit,
  status: doc.status,
  dueAt: iso(doc.dueAt),
  lastNote: doc.lastNote,
  progressedAt: iso(doc.progressedAt),
  closedAt: iso(doc.closedAt),
  version: doc.__v,
});
