// Cross-layer identity seams (frozen auth design 4.3/4.4 — OQ-30 stub pattern): the platform
// cannot import HR, so the HR module registers these at load time. Absent registration, the
// platform degrades gracefully (no employee-code login; resets always generate random).
type EmployeeCodeResolver = (code: string) => Promise<string | null>;
type TempPasswordSource = (userId: string) => Promise<string | null>;

let employeeCodeResolver: EmployeeCodeResolver | null = null;
let tempPasswordSource: TempPasswordSource | null = null;

/** HR registers: employee code → linked userId (login identifier kind `employeeCode`). */
export const registerEmployeeCodeResolver = (fn: EmployeeCodeResolver): void => {
  employeeCodeResolver = fn;
};
export const resolveEmployeeCode = async (code: string): Promise<string | null> =>
  employeeCodeResolver === null ? null : employeeCodeResolver(code);

/** HR registers: userId → the linked employee's National ID (temp-password policy, D3). */
export const registerTempPasswordSource = (fn: TempPasswordSource): void => {
  tempPasswordSource = fn;
};
export const resolveTempPassword = async (userId: string): Promise<string | null> =>
  tempPasswordSource === null ? null : tempPasswordSource(userId);
