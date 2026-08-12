// Public surface of the Payroll sub-module (ADR-003 barrels per feature).
//
// PY-1 ships the pay-item catalog; PY-2 adds what an item is worth to one employee over one dated
// interval; PY-3 turns those into compensation LINES for a period; PY-4 prices the quantity-based
// ones from frozen attendance; PY-6 adds the RUN that freezes a period's facts in the first place.
// Still no payslip, and no tax or insurance rule — each arrives with the phase that uses it.
export * from './pay-items';
export * from './employee-pay-items';
export * from './compensation';
export * from './runs';
