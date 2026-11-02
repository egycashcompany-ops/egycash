// Stable, machine-readable error codes (API Standards §5).
// Clients branch on codes, never on message text. Adding a code = PR to this catalog.

export const ErrorCodes = {
  // auth
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  /** No account matches the identifier that was typed. Distinct from a wrong password by the
   * owner's decision — see the note in `auth.service.login()`. */
  AUTH_IDENTIFIER_UNKNOWN: 'AUTH_IDENTIFIER_UNKNOWN',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  AUTH_SESSION_IDLE: 'AUTH_SESSION_IDLE',
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
  /** ADR-035 — passkey sign-in is switched off (`auth.passkeys.enabled`). */
  AUTH_PASSKEYS_DISABLED: 'AUTH_PASSKEYS_DISABLED',
  /**
   * Any refused passkey: unknown credential, bad signature, an account that may not use one. One
   * code, so none of those can be told apart.
   */
  AUTH_PASSKEY_INVALID: 'AUTH_PASSKEY_INVALID',
  /**
   * The challenge the device signed is unknown, expired or already used — checked before any
   * account is looked at, so it says nothing about one. Not a failed sign-in: fetch a new one.
   */
  AUTH_PASSKEY_EXPIRED: 'AUTH_PASSKEY_EXPIRED',
  /** This account may not add a passkey (an external account whose module did not opt in). */
  AUTH_PASSKEY_NOT_ALLOWED: 'AUTH_PASSKEY_NOT_ALLOWED',
  /** The account already holds `PASSKEYS_PER_ACCOUNT` passkeys. */
  AUTH_PASSKEY_LIMIT: 'AUTH_PASSKEY_LIMIT',

  // generic
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE: 'DUPLICATE',
  STALE_DOCUMENT: 'STALE_DOCUMENT',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  /** 413 — a request body past its path's limit (1mb; a custody memo's write, 8mb). */
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
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

  // recruitment (hr module)
  /**
   * The applicant's documents folder is a KEPT RECORD and refuses deletion: they were hired, an
   * employee row was created from them, or they hold an accepted offer and are about to be.
   *
   * Its own code rather than a bare `BUSINESS_RULE_VIOLATION` because the screen has one thing to
   * say back («تم تعيين هذا المتقدم…») and a bulk delete reports it per applicant — a caller that
   * has to read the message to find out which rule refused cannot do either.
   */
  APPLICANT_FOLDER_KEPT_RECORD: 'APPLICANT_FOLDER_KEPT_RECORD',

  // files
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_BLOCKED: 'FILE_BLOCKED',
  /** A scanner is registered and has not answered for this file yet — the bytes are withheld. */
  FILE_SCAN_PENDING: 'FILE_SCAN_PENDING',
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

  // ── ATM operations (docs/12-planning/atm-operations-port.md) ──────────────────────────────────
  /**
   * The owner's rule (2026-10-13, «مينفعش أضيف ماكينة مرتين»; per Cairo day since 2026-10-27;
   * maintenance only since 2026-11-01 — port doc OD-1b): the machine code already has an OPEN
   * maintenance that day — at most one per machine code and day, company-wide. Answered by the
   * maintenance reopen and by an edit moving its open time; the batch open and the mail accept
   * report such codes instead. No replenishment path answers it: a machine may have several open.
   */
  ATM_OPERATION_ALREADY_OPEN: 'ATM_OPERATION_ALREADY_OPEN',

  // ── ATM efficiency register (docs/12-planning/atm-efficiency-register.md) ─────────────────────
  /** D6: the machine code already has an OPEN custody period somewhere in the company. */
  ATM_REGISTER_OPEN_PERIOD_EXISTS: 'ATM_REGISTER_OPEN_PERIOD_EXISTS',
  /** DEC-9: an ACTIVE Operations machine with this code exists in another branch. */
  ATM_REGISTER_CODE_ACTIVE_ELSEWHERE: 'ATM_REGISTER_CODE_ACTIVE_ELSEWHERE',
  /**
   * DEC-10: no register code resolves to the branch — the register settings map none to it, nor to
   * a branch linked to work as it (`atm.branchLinks`).
   */
  ATM_REGISTER_BRANCH_UNMAPPED: 'ATM_REGISTER_BRANCH_UNMAPPED',
  /** DEC-12: a branch-less (imported) pending entry cannot be received. */
  ATM_REGISTER_BRANCH_REQUIRED: 'ATM_REGISTER_BRANCH_REQUIRED',
  /** D6: an area is required to couple the entry to the Operations list. */
  ATM_REGISTER_AREA_REQUIRED: 'ATM_REGISTER_AREA_REQUIRED',
  ATM_REGISTER_NOT_OPEN: 'ATM_REGISTER_NOT_OPEN',
  ATM_REGISTER_NOT_PENDING: 'ATM_REGISTER_NOT_PENDING',
  ATM_REGISTER_NOT_ENDED: 'ATM_REGISTER_NOT_ENDED',
  /** A field that cannot change in the entry's current state (e.g. the ATM ID once linked). */
  ATM_REGISTER_IMMUTABLE_FIELD: 'ATM_REGISTER_IMMUTABLE_FIELD',
  /** DEC-30: the entry already has its Operations machine. */
  ATM_REGISTER_ALREADY_LINKED: 'ATM_REGISTER_ALREADY_LINKED',
  /** The workbook is not the expected `ATMs` layout, or is too large to read. */
  ATM_REGISTER_IMPORT_LAYOUT: 'ATM_REGISTER_IMPORT_LAYOUT',
  /** Apply refused: the preview carries blockers (details name them). */
  ATM_REGISTER_IMPORT_BLOCKED: 'ATM_REGISTER_IMPORT_BLOCKED',
  /** The applied bytes are not the previewed bytes (`fileSha256`). */
  ATM_REGISTER_IMPORT_FILE_CHANGED: 'ATM_REGISTER_IMPORT_FILE_CHANGED',
  /** One running import at a time (DEC-15). */
  ATM_REGISTER_IMPORT_RUNNING: 'ATM_REGISTER_IMPORT_RUNNING',

  // ── ATM bank catalog (DEC-35; atm-efficiency-register.md) ─────────────────────────────────────
  /** A catalog bank already holds this code (409). Codes are never reused: they key stored data. */
  ATM_BANK_CODE_TAKEN: 'ATM_BANK_CODE_TAKEN',
  /**
   * The Operations label is already a bank's — another catalog bank's current or former label, or
   * a branch spelling mapped to a bank (409). Two banks sharing a label would make a machine's
   * bank text mean either.
   */
  ATM_BANK_LABEL_TAKEN: 'ATM_BANK_LABEL_TAKEN',
  /** Another catalog bank already has this Arabic or English name, case ignored (409). */
  ATM_BANK_NAME_TAKEN: 'ATM_BANK_NAME_TAKEN',

  // ── ATM machine map and zones (docs/12-planning/atm-map-zones.md) ─────────────────────────────
  /** DM-7: the branch's zone set moved since the editor loaded it (409); nothing was written. */
  ATM_MAP_ZONES_STALE: 'ATM_MAP_ZONES_STALE',
  /** DM-45: approve while the register text the review pin came from has moved — sync first (409). */
  ATM_MAP_SOURCE_CHANGED: 'ATM_MAP_SOURCE_CHANGED',
  /** DM-45: a text placement whose server parse moved away from the previewed point (409). */
  ATM_MAP_PARSE_CHANGED: 'ATM_MAP_PARSE_CHANGED',
  /** Approve on a location that is not waiting for review (422). */
  ATM_MAP_NOT_UNDER_REVIEW: 'ATM_MAP_NOT_UNDER_REVIEW',

  // ── ATM settlements, preparation, control (docs/12-planning/atm-settlements-phase1.md §6.1) ───
  /** DS-22: no work branch can be resolved (422); details carry CHOOSE_BRANCH or NO_BRANCH. */
  ATM_WORK_BRANCH_REQUIRED: 'ATM_WORK_BRANCH_REQUIRED',
  /** DS-24: the bank is not in `atm.settlements.banks` (422). */
  ATM_SETTLEMENT_BANK_NOT_ENABLED: 'ATM_SETTLEMENT_BANK_NOT_ENABLED',
  /** §5.1: a sheet or header is missing, or the master workbook is beyond a limit (422). */
  ATM_LAYOUT_IMPORT_LAYOUT: 'ATM_LAYOUT_IMPORT_LAYOUT',
  /** §5.2: the bank has no master import profile (422). */
  ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK: 'ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK',
  /** §5.4: the applied bytes are not the previewed bytes (409). */
  ATM_LAYOUT_IMPORT_FILE_CHANGED: 'ATM_LAYOUT_IMPORT_FILE_CHANGED',
  /** §5.4: another apply of this branch × bank is running (409). */
  ATM_LAYOUT_IMPORT_RUNNING: 'ATM_LAYOUT_IMPORT_RUNNING',
  /** A standard load is deleted while live layouts or draft lines point at it (409). */
  ATM_STANDARD_LOAD_IN_USE: 'ATM_STANDARD_LOAD_IN_USE',
  /** DS-1: a plan for this branch × bank × date already exists (409); the detail carries its id. */
  ATM_PLAN_EXISTS: 'ATM_PLAN_EXISTS',
  /** DS-30: more than 400 non-cancelled lines (422). */
  ATM_PLAN_FULL: 'ATM_PLAN_FULL',
  /** The action does not fit the line's status (409); the detail carries `{ status }`. */
  ATM_PLAN_LINE_STATE: 'ATM_PLAN_LINE_STATE',
  /** Reopening a line whose preparation holds a value, or changed since it was read (409). */
  ATM_PLAN_LINE_HAS_CAPTURES: 'ATM_PLAN_LINE_HAS_CAPTURES',
  /** Issue with line errors (422); details `{ field: 'lines[i]', code }`. */
  ATM_PLAN_ISSUE_BLOCKED: 'ATM_PLAN_ISSUE_BLOCKED',
  /** Saving captures on a prepared (or cancelled) line (409). */
  ATM_PREPARATION_LOCKED: 'ATM_PREPARATION_LOCKED',
  /** DS-16: mark prepared with values missing (422); details name bags or slots, never values. */
  ATM_PREPARATION_INCOMPLETE: 'ATM_PREPARATION_INCOMPLETE',

  // ── ATM settings: moving a linked source's data (atm-settings.ts) ─────────────────────────────
  /**
   * The move refused (409) before the run wrote anything: its preview carries blockers — another
   * move running among them. The details name each one (`{ field: 'blockers', code: <kind> }`);
   * nothing was moved.
   */
  ATM_BRANCH_MOVE_BLOCKED: 'ATM_BRANCH_MOVE_BLOCKED',
  /**
   * A run stopped part-way (409): a step's re-check met a blocker that appeared after the run
   * began. What the steps before it moved stays moved (the run ends `failed`, and its audit row
   * counts it); the details name the blockers as above, and running the move again carries on.
   */
  ATM_BRANCH_MOVE_STOPPED: 'ATM_BRANCH_MOVE_STOPPED',
  /**
   * The move refused (409) because the link it would follow is no longer the one the reader
   * confirmed (`expectedTargetBranchId`): another administrator re-pointed it. Nothing moved.
   */
  ATM_BRANCH_MOVE_TARGET_CHANGED: 'ATM_BRANCH_MOVE_TARGET_CHANGED',
  /**
   * A write that would make or change what a running «نقل البيانات» re-files waits for it (423
   * Locked — never 409, which the data-edit dialogs read as "already exists"): a register receipt,
   * coupling or import, a machine or label save, an operation opened or reopened, a mail accepted.
   * Retried after the move; a run left 30 minutes (its process died) no longer holds them.
   */
  ATM_BRANCH_MOVE_RUNNING: 'ATM_BRANCH_MOVE_RUNNING',
  /**
   * 422 — the machines file cannot be compared: no sheet with a Bank / ID / ATM Name / Area header
   * row, or over a cap. `details` name the missing column or the cap, never a cell's content.
   */
  ATM_MACHINE_SYNC_LAYOUT: 'ATM_MACHINE_SYNC_LAYOUT',
  /** 409 — the machines file applied is not the one compared (its hash differs); nothing written. */
  ATM_MACHINE_SYNC_FILE_CHANGED: 'ATM_MACHINE_SYNC_FILE_CHANGED',
  /**
   * 409 — the branch changed since the machines file was compared (a machine edited, added,
   * archived or moved): the comparison is no longer the one the reader approved. Nothing written.
   */
  ATM_MACHINE_SYNC_PLAN_CHANGED: 'ATM_MACHINE_SYNC_PLAN_CHANGED',

  // ── Fleet fuel-card sheet reconciliation («مطابقة أرصدة الكروت») ─────────────────────────────
  /** 422 — the sheet is not the company's layout (a header is missing, no sheet), or over a cap. */
  FLEET_FUEL_SHEET_LAYOUT: 'FLEET_FUEL_SHEET_LAYOUT',
  /**
   * 409 — a named card changed after the sheet was read; nothing was written. One detail per card:
   * `{ field: 'cardIds', code: 'CARD_CHANGED', message: <cardId> }`.
   */
  FLEET_FUEL_RECONCILE_CARD_CHANGED: 'FLEET_FUEL_RECONCILE_CARD_CHANGED',
  /**
   * 409 — a named card was already decided in this session; nothing was written. One detail per
   * card: `{ field: 'cardIds', code: 'DECIDED', message: <cardId> }`.
   */
  FLEET_FUEL_RECONCILE_DECIDED: 'FLEET_FUEL_RECONCILE_DECIDED',

  // ── Crew roster (B3) ──────────────────────────────────────────────────────────────────────────
  /** The employee holds no operations requirements row, so is not on the crew roster. */
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
