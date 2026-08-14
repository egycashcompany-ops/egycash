// Public surface of the Run Cost Breakdown feature (P-HR-14 / U14-1).
//
// The router and the service. There is no model, no repository and no migration — this feature
// stores nothing: it groups lines the payslips already hold.
export { buildCostBreakdownRouter } from './cost-breakdown.routes';
export { costBreakdownService } from './cost-breakdown.service';
