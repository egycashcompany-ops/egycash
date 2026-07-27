// Public surface of the recruitment-timeline feature (ADR-003). Every stage feature writes
// history through `recruitmentTimelineService` and reads it through these helpers — nothing
// reaches into the model or repository directly.
export { recruitmentTimelineService, type RecordTimelineInput } from './recruitment-timeline.service';
export { timelineEntryDto, timelineSummaryDto } from './recruitment-timeline.mapper';
export { newCorrelationId, newEventId, timelineSourceKey } from './recruitment-timeline.keys';
export {
  type RecruitmentTimelineDoc,
  type TimelinePlacement,
  type TimelinePlacementLabel,
} from './recruitment-timeline.model';
export { type TimelineListFilter } from './recruitment-timeline.repository';
