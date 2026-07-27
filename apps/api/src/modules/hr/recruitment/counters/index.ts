// Public surface of the recruitment stage-counters feature (RW15). The HR manifest and tests
// import from here; internal files are not reached across the feature boundary (ADR-003).
export { buildRecruitmentCountersRouter } from './stage-counts.routes';
export { stageCountsService } from './stage-counts.service';
