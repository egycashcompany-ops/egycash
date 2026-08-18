// Stable, machine-readable error codes (API Standards §5).
// Clients branch on codes, never on message text. Adding a code = PR to this catalog.

export const ErrorCodes = {
  // auth
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_ACCOUNT_NOT_ACTIVE: 'AUTH_ACCOUNT_NOT_ACTIVE',
  /** §15.3 — the account exists but its setup link was never completed (invited). */
  AUTH_ACCOUNT_NOT_ACTIVATED: 'AUTH_ACCOUNT_NOT_ACTIVATED',
  AUTH_TOTP_REQUIRED: 'AUTH_TOTP_REQUIRED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  AUTH_TOTP_INVALID: 'AUTH_TOTP_INVALID',
  AUTH_TOTP_ENROLLMENT_REQUIRED: 'AUTH_TOTP_ENROLLMENT_REQUIRED',
  AUTH_TOTP_ALREADY_ENABLED: 'AUTH_TOTP_ALREADY_ENABLED',
  AUTH_PASSWORD_POLICY: 'AUTH_PASSWORD_POLICY',
  AUTH_ACTIVATION_TOKEN_INVALID: 'AUTH_ACTIVATION_TOKEN_INVALID',

  // generic
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE: 'DUPLICATE',
  STALE_DOCUMENT: 'STALE_DOCUMENT',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  INTEGRATION_UNAVAILABLE: 'INTEGRATION_UNAVAILABLE',
  INTERNAL: 'INTERNAL',

  // settings
  SETTING_UNKNOWN_KEY: 'SETTING_UNKNOWN_KEY',
  SETTING_SCOPE_NOT_ALLOWED: 'SETTING_SCOPE_NOT_ALLOWED',
  SETTING_INVALID_VALUE: 'SETTING_INVALID_VALUE',

  // organization
  ORG_UNIT_HAS_CHILDREN: 'ORG_UNIT_HAS_CHILDREN',

  // applications
  APPLICATION_CATEGORY_IN_USE: 'APPLICATION_CATEGORY_IN_USE',
  /** A section still holding applications refuses deletion — nothing is orphaned silently. */
  APPLICATION_SECTION_IN_USE: 'APPLICATION_SECTION_IN_USE',

  // rbac
  ROLE_PROTECTED: 'ROLE_PROTECTED',
  PERMISSION_UNKNOWN: 'PERMISSION_UNKNOWN',

  // contracts (hr module — frozen design §8/§9)
  /** A4/§15 — signed/archived contracts refuse every direct modification. */
  CONTRACT_IMMUTABLE: 'CONTRACT_IMMUTABLE',
  /** A16 — generation refused; details carry the structured validation report. */
  CONTRACT_VARIABLES_MISSING: 'CONTRACT_VARIABLES_MISSING',
  /** A17 — only a PUBLISHED template version can generate. */
  CONTRACT_TEMPLATE_NOT_PUBLISHED: 'CONTRACT_TEMPLATE_NOT_PUBLISHED',

  // files
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_BLOCKED: 'FILE_BLOCKED',
  FILE_SIGNATURE_INVALID: 'FILE_SIGNATURE_INVALID',
  FILE_CATEGORY_INACTIVE: 'FILE_CATEGORY_INACTIVE',

  // operations (cash transfer — design docs/12-planning/operations-module-design.md)
  /** A normalized ref (string→ObjectId NORMALIZE) points at a missing or inactive bank. */
  OPERATIONS_UNKNOWN_BANK: 'OPERATIONS_UNKNOWN_BANK',
  OPERATIONS_UNKNOWN_BRANCH: 'OPERATIONS_UNKNOWN_BRANCH',
  OPERATIONS_UNKNOWN_CURRENCY: 'OPERATIONS_UNKNOWN_CURRENCY',
  /** The legacy client-side branch-per-bank picker filter, made a domain rule (main_ops.ejs:477). */
  OPERATIONS_BRANCH_BANK_MISMATCH: 'OPERATIONS_BRANCH_BANK_MISMATCH',
  /** Legacy parity: a daily shipment hardcodes del_date "" (contad_app.js:353). */
  OPERATIONS_DAILY_HAS_NO_DELIVERY_DATE: 'OPERATIONS_DAILY_HAS_NO_DELIVERY_DATE',
  /** Q30 NORMALIZE: transitions follow the observed lifecycle, not the unguarded legacy toggle. */
  OPERATIONS_INVALID_SHIPMENT_TRANSITION: 'OPERATIONS_INVALID_SHIPMENT_TRANSITION',
  /** The operating day walks planning → open → closed, forward only (design §16.1). */
  OPERATIONS_INVALID_DAY_TRANSITION: 'OPERATIONS_INVALID_DAY_TRANSITION',
  /**
   * §9.4 anchor: crew is planned only for a vehicle on the Fleet roster for that date — the
   * normalized form of the legacy car_lock gate (tashghela listed only car_lock'd vehicles,
   * contad_app.js:2255).
   */
  OPERATIONS_FLEET_DUTY_REQUIRED: 'OPERATIONS_FLEET_DUTY_REQUIRED',
  /** Q2 NORMALIZE — the dual-control rule the legacy schema described and never enforced. */
  OPERATIONS_CUSTODY_DUAL_CONTROL_REQUIRED: 'OPERATIONS_CUSTODY_DUAL_CONTROL_REQUIRED',
  OPERATIONS_CUSTODY_NOT_HELD: 'OPERATIONS_CUSTODY_NOT_HELD',
  OPERATIONS_NOT_A_SECURED_SHIPMENT: 'OPERATIONS_NOT_A_SECURED_SHIPMENT',
  /** The crew row must sit on the shipment's own delivery day. */
  OPERATIONS_CREW_DAY_MISMATCH: 'OPERATIONS_CREW_DAY_MISMATCH',
  OPERATIONS_CREW_CAPTAIN_MISMATCH: 'OPERATIONS_CREW_CAPTAIN_MISMATCH',
  /** Dispatching without an assigned leg 2 is what let legacy complete with a blank leader2. */
  OPERATIONS_DELIVERY_LEG_REQUIRED: 'OPERATIONS_DELIVERY_LEG_REQUIRED',
  /** A reorder named an assignment outside the captain-day-leg it claims to order. */
  OPERATIONS_ASSIGNMENT_NOT_IN_SET: 'OPERATIONS_ASSIGNMENT_NOT_IN_SET',
  /** A reorder omitted assignments — accepting it would strand them at stale positions. */
  OPERATIONS_INCOMPLETE_ORDER: 'OPERATIONS_INCOMPLETE_ORDER',

  // ── Captain execution (OP-7, NEW — no legacy counterpart) ─────────────────────────────────────
  /** The action is not legal from the stop's current execution state (start/pickup/deliver/complete). */
  OPERATIONS_INVALID_EXECUTION_TRANSITION: 'OPERATIONS_INVALID_EXECUTION_TRANSITION',
  /** The sequential lock: an earlier stop on this captain's route is not finished yet. */
  OPERATIONS_EXECUTION_OUT_OF_SEQUENCE: 'OPERATIONS_EXECUTION_OUT_OF_SEQUENCE',
  /** Nothing left to execute here — the stop is already settled. */
  OPERATIONS_EXECUTION_ALREADY_SETTLED: 'OPERATIONS_EXECUTION_ALREADY_SETTLED',
  /** Someone else moved this stop first; the transition's precondition no longer holds. */
  OPERATIONS_EXECUTION_CONFLICT: 'OPERATIONS_EXECUTION_CONFLICT',

  // ── Crew roster (B3) ──────────────────────────────────────────────────────────────────────────
  /** The employee holds no operations requirements row, so is not on the crew roster. */
  OPERATIONS_UNKNOWN_CREW_MEMBER: 'OPERATIONS_UNKNOWN_CREW_MEMBER',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
