// Cross-layer identity seams (frozen auth design 4.3 + §12 — OQ-30 stub pattern): the
// platform cannot import HR, so the HR module registers these at load time. Absent
// registration, the platform degrades gracefully (no employee-code login; credential
// messages omit the Employee Code line).
type EmployeeCodeResolver = (code: string) => Promise<string | null>;
type EmployeeCodeOfUser = (userId: string) => Promise<string | null>;

let employeeCodeResolver: EmployeeCodeResolver | null = null;
let employeeCodeOfUser: EmployeeCodeOfUser | null = null;

/** HR registers: employee code → linked userId (login identifier kind `employeeCode`). */
export const registerEmployeeCodeResolver = (fn: EmployeeCodeResolver): void => {
  employeeCodeResolver = fn;
};
export const resolveEmployeeCode = async (code: string): Promise<string | null> =>
  employeeCodeResolver === null ? null : employeeCodeResolver(code);

/** HR registers: userId → the linked employee's code (credential messages, §12 R3). */
export const registerEmployeeCodeOfUser = (fn: EmployeeCodeOfUser): void => {
  employeeCodeOfUser = fn;
};
export const resolveEmployeeCodeOfUser = async (userId: string): Promise<string | null> =>
  employeeCodeOfUser === null ? null : employeeCodeOfUser(userId);

/**
 * What to CALL the outside record an external account belongs to.
 *
 * Same contract as the two above: the platform holds an opaque back-reference and cannot read the
 * module's collections, so the module registers the one thing the platform needs to render — a
 * name. Absent registration the label is null and the shell falls back to the account's own name,
 * which is a poorer greeting, not a broken screen.
 */
type ExternalSubjectLabel = (subject: {
  moduleId: string;
  subjectType: string;
  subjectId: string;
}) => Promise<string | null>;

let externalSubjectLabel: ExternalSubjectLabel | null = null;

export const registerExternalSubjectLabel = (fn: ExternalSubjectLabel): void => {
  externalSubjectLabel = fn;
};

export const resolveExternalSubjectLabel = async (subject: {
  moduleId: string;
  subjectType: string;
  subjectId: string;
}): Promise<string | null> =>
  externalSubjectLabel === null ? null : externalSubjectLabel(subject);
