// Public surface of the Payroll sub-module (ADR-003 barrels per feature).
//
// PY-1 ships the pay-item catalog and nothing else: no run, no payslip, no calculation, and no
// tax or insurance rule. Each arrives with the phase that uses it.
export * from './pay-items';
