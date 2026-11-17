// Public surface of the Day Decisions feature (ADR-003 barrel).
export { decisionService, toDecisionDto, type DecisionCallerFlags } from './decision.service';
export { buildAttendanceDecisionsRouter } from './decision.routes';
export { decisionRepository } from './decision.repository';
export { AttendanceDecisionModel, type AttendanceDecisionDoc } from './decision.model';
export { liveDecisionFor, type LiveDecision } from './live-decision';
export {
  approveProblem,
  dayProblem,
  daysBack,
  decideProblem,
  landsPendingHr,
  revokeProblem,
} from './decision-rules';
