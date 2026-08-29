// The feature's public surface (ADR-003). Cross-feature callers reach Performance through here and
// never into its files — the barrel is what lets the inside be rearranged without a search.
export { performanceCycleService } from './cycles/performance-cycle.service';
export { performanceReviewService } from './reviews/performance-review.service';
export { performanceGoalService } from './goals/performance-goal.service';
export {
  performanceCycleRepository,
  performanceGoalRepository,
  performanceReviewRepository,
} from './performance.repository';
export {
  toPerformanceCycleDto,
  toPerformanceGoalDto,
  toPerformanceReviewDto,
} from './performance.mapper';
export {
  buildPerformanceCyclesRouter,
  buildPerformanceGoalsRouter,
  buildPerformanceReviewsRouter,
} from './performance.routes';
export { canTransition, isEditable, isOnScale, scopeFilterOf } from './cycles/cycle-rules';
export { type PerformanceCycleDoc } from './cycles/performance-cycle.model';
export { type PerformanceReviewDoc } from './reviews/performance-review.model';
export { type PerformanceGoalDoc } from './goals/performance-goal.model';
