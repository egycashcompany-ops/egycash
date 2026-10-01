// «لما ادوس على الزرار دا يجيب اللى ف مخالفات تتحملها الشركة وفلتر بيهم ... ولما ادوس عليه وينقل
// الداتا يتشال ولما ازود عربيات عند الشركه تانى يظهر تانى».

/**
 * Is «عربيات الشركة» offered on the drivers' car filter? While the company half is narrowed to cars
 * and the drivers' half is not already narrowed to exactly those — so it disappears once pressed,
 * and comes back the moment the company half's cars change again.
 */
export const offersCompanyCars = (
  company: readonly string[],
  drivers: readonly string[],
): boolean => {
  if (company.length === 0) return false;
  const mine = new Set(drivers);
  const theirs = new Set(company);
  return mine.size !== theirs.size || [...theirs].some((code) => !mine.has(code));
};
