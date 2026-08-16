// Public surface of the Payroll sub-module (ADR-003 barrels per feature).
//
// PY-1 ships the pay-item catalog; PY-2 adds what an item is worth to one employee over one dated
// interval; PY-3 turns those into compensation LINES for a period; PY-4 prices the quantity-based
// ones from frozen attendance; PY-5 charges what leave was not paid; PY-6 adds the RUN that
// freezes a period's facts; PY-7 writes the result down as a payslip.
// P-HR-04 adds the one-off decision — a bonus or a penalty for a single month.
// Still no tax and no insurance rule — each arrives with the phase that is given it.
export * from './pay-items';
export * from './employee-pay-items';
export * from './compensation';
export * from './runs';
export * from './payslips';
export * from './adjustments';
export * from './reconciliation';
export * from './cost-breakdown';
export * from './cost-report';
