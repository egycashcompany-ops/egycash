// Public surface of the recruitment-timeline feature (ADR-003). Every stage feature writes
// history through `recruitmentTimelineService` and reads it through these helpers — nothing
// reaches into the model or repository directly.
// NOTE: the HTTP layer is deliberately NOT re-exported here. The workflow consumers import this
// barrel, and the controller reads Applicants — re-exporting it would close the cycle
// timeline → applicants → workflow → timeline and leave half-initialised modules at boot. The HR
// manifest imports the router from its own file instead.
export { recruitmentTimelineService, type RecordTimelineInput } from './recruitment-timeline.service';
export { timelineEntryDto, timelineSummaryDto } from './recruitment-timeline.mapper';
export { newCorrelationId, newEventId, timelineSourceKey } from './recruitment-timeline.keys';
export {
  type RecruitmentTimelineDoc,
  type TimelinePlacement,
  type TimelinePlacementLabel,
} from './recruitment-timeline.model';
export { type TimelineListFilter } from './recruitment-timeline.repository';
