// Which HR screen owns which of the driver's HR-owned facts, and what a caller must hold to be
// sent there.
//
// This is a table rather than three `can(...)` calls buried in JSX because it encodes a rule that
// has to stay true: every HR fact the drivers screen DISPLAYS is either delegated to the HR screen
// that can change it, or is knowingly not changeable anywhere. A field added to the dialog without
// an entry here is a field with no owner, and the test over this table is what catches that.
//
// Fleet writes none of these. FR-11 stands: the delegation is a LINK, not a write path.

/** One group of HR facts, the screen that owns them, and the grants needed to get there. */
export interface HrDelegationGroup {
  /** Tab on the HR employee profile — the existing `/employees/:id?tab=…` convention. */
  readonly tab: 'personal' | 'employment';
  /** The permission the HR screen's OWN edit action requires. No grant → no link offered. */
  readonly permission: string;
  /**
   * What the DESTINATION ROUTE itself demands, which is a separate question.
   *
   * `/employees/:id` is wrapped in `RequirePermission permission="employee.view"`, and the
   * permission catalogue has no implication mechanism — holding `employee.editPersonal` does not
   * confer `employee.view`. A link offered on the edit grant alone would therefore walk some users
   * straight into a permission wall, so both are required before it is shown.
   */
  readonly routePermission: string;
  /** The driver-table columns this group covers, by their i18n key suffix. */
  readonly fields: readonly string[];
}

export const HR_DELEGATION = {
  /** `PATCH /hr/employees/:id/personal` — ordinary field edits on the person's own data. */
  personal: {
    tab: 'personal',
    permission: 'employee.editPersonal',
    routePermission: 'employee.view',
    fields: ['driver', 'phone', 'address', 'governorate'],
  },
  /**
   * `POST /hr/employees/:id/actions` — NOT field edits. Job title moves by a promotion, branch by
   * a transfer, hire date by a dated correction; each carries an effective date and a reason and
   * lands in the employee's timeline. That is why these are a separate group with a separate
   * grant: writing them as plain fields would be a personnel change with no record of itself.
   */
  employment: {
    tab: 'employment',
    permission: 'employee.manageActions',
    routePermission: 'employee.view',
    fields: ['jobTitle', 'branch', 'hiredAt'],
  },
} as const satisfies Record<string, HrDelegationGroup>;

/**
 * The employee code is deliberately in NO group.
 *
 * It is `<BranchCodeAtHire><employeeNumber>`, composed once when the employee is created and frozen
 * from then on (ADR-017) — no endpoint in the system writes it, and nothing, not even a transfer,
 * changes it. Offering an edit action for it would promise something nothing can deliver, so it is
 * named here as an explicit non-target.
 */
export const HR_UNDELEGATED_FIELDS = ['employeeCode'] as const;

/** The HR profile tab that owns a group — the existing route, not a new one. */
export const hrProfileHref = (employeeId: string, tab: HrDelegationGroup['tab']): string =>
  `/employees/${employeeId}?tab=${tab}`;

/** May this caller be sent to the screen that owns this group? Both grants, never just one. */
export const mayDelegateTo = (
  group: HrDelegationGroup,
  can: (permission: string) => boolean,
): boolean => can(group.permission) && can(group.routePermission);
