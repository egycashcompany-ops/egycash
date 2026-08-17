// Public surface of the Payroll Report Builder (scope B1).
//
// The router, the two services, and the server-side maps the payslip repository composes its
// grouping keys from. There is one model here and it stores a QUESTION — no result, no execution
// history, no owner.
export { buildReportBuilderRouter } from './report-definition.routes';
export { reportDefinitionService } from './report-definition.service';
export { reportExecutionService } from './report-execution.service';
export { composeGroupKey, planFilters, sortRows, type FilterPlan } from './report-dimensions';
