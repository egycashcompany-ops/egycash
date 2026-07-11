// Public surface of the Interviews feature (Stage 3). The HR manifest, the seed, and tests
// import from here; internal files are not reached across the feature boundary.
export { buildInterviewsRouter, buildInterviewStagesRouter } from './interview.routes';
export { interviewService } from './interview.service';
export { interviewStageService } from './interview-stage.service';
export { type InterviewDoc } from './interview.model';
export { type InterviewStageDoc } from './interview-stage.model';
