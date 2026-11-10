// Shared by the register screen (the salary section) and the server (the salary variables a
// contract or a hiring form prints), so the two can never split the same gross differently.
// The salary, split the way the company pays it — from the one figure HR types, the gross.
//
//   الراتب الثابت    70% of the gross
//   حافز الانتظام    30% of the gross
//   الأجر التأميني   the gross ÷ 1.3
//
// Rounded to the piastre. The attendance bonus is the gross LESS the fixed part rather than its own
// 30%, so the two always add back up to the gross exactly: two separately rounded halves can be a
// piastre apart from the whole, and a salary paper whose parts do not sum is a salary paper somebody
// has to explain.
export const FIXED_SHARE = 0.7;
export const INSURANCE_DIVISOR = 1.3;

const toPiastre = (value: number): number => Math.round(value * 100) / 100;

export interface SalaryBreakdown {
  gross: number;
  fixed: number;
  attendanceBonus: number;
  insurance: number;
}

/** Null when there is no usable gross — nothing typed, or not a positive number. */
export const salaryBreakdown = (gross: number | null): SalaryBreakdown | null => {
  if (gross === null || !Number.isFinite(gross) || gross <= 0) return null;
  const fixed = toPiastre(gross * FIXED_SHARE);
  return {
    gross,
    fixed,
    attendanceBonus: toPiastre(gross - fixed),
    insurance: toPiastre(gross / INSURANCE_DIVISOR),
  };
};
