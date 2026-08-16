// Public surface of the Dynamic Run Cost Report (P-HR-25).
//
// The router and the service. There is no model, no repository and no migration — this feature
// stores nothing, not even the report it was asked for: the caller's axis and columns arrive with
// the request and are forgotten with the response (D-REPORT-1 = C).
export { buildCostReportRouter } from './cost-report.routes';
export { costReportService } from './cost-report.service';
