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
  // ── The org chart and job places (P-ORG-3, ADR-038) ──────────────────────────────────────────
  /** 422 — a chart section write under a department or section with no editable group (§4.2). */
  ORG_UNIT_NOT_EDITABLE: 'ORG_UNIT_NOT_EDITABLE',
  /** 409 — «إضافة قسم» / «تغيير الاسم»: the department already has a section of that name. */
  ORG_SECTION_NAME_TAKEN: 'ORG_SECTION_NAME_TAKEN',
  /** 422 — a ticked branch has no active row of the department linked to its company entry. */
  BRANCH_WITHOUT_DEPARTMENT: 'BRANCH_WITHOUT_DEPARTMENT',
  /** 422 — a new job place in a group that is not editable, for an inactive job, or with a section
   *  outside its department. Places already stored are kept regardless. */
  JOB_PLACE_NOT_ALLOWED: 'JOB_PLACE_NOT_ALLOWED',
  /** 409 — a catalog entry that job places cite cannot be deleted. */
  ORG_CATALOG_ENTRY_IN_USE: 'ORG_CATALOG_ENTRY_IN_USE',

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
  /**
   * 422 (Round 29, «استيراد فروع من شيت») — the bank's branch sheet cannot be compared: no header row
   * naming «اسم الفرع» in its first rows, no visible sheet, or over a cap. `details` name the missing
   * column or the cap (`TOO_LARGE`), never a cell's content.
   */
  OPERATIONS_BRANCH_IMPORT_LAYOUT: 'OPERATIONS_BRANCH_IMPORT_LAYOUT',
  /**
   * 409 (Round 29) — «تأكيد الاستيراد» after the comparison went out of date: the file is not the one
   * compared (`details[0].code` 'FILE_CHANGED'), or the bank's branches or the areas changed so the
   * plan is no longer the one shown ('PLAN_CHANGED'). Nothing was written; compare again.
   */
  OPERATIONS_BRANCH_IMPORT_CHANGED: 'OPERATIONS_BRANCH_IMPORT_CHANGED',
  /**
   * The destination branch is not a branch of the destination bank (`secondaryBankId ?? mainBankId`)
   * — legacy's client-side to-branch filter (main_ops.ejs:501-503), made a domain rule. The ORIGIN
   * carries no bank rule: it may belong to any bank, the main bank being the billed one.
   */
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
   *
   * NO LONGER ANSWERED since Round 24: «مكان بدون سيارة دا لما ادوس عليه يجيب كل السيارات اللى مش
   * عليها طاقم واقدر اختار منهم» — a crew row may take ANY active vehicle with no crew that day,
   * on the roster or not (refusals: `OPERATIONS_CREW_VEHICLE_NOT_ACTIVE`, `…_IN_WORKSHOP`,
   * `…_TAKEN`). Kept so a client built before still reads it.
   */
  OPERATIONS_FLEET_DUTY_REQUIRED: 'OPERATIONS_FLEET_DUTY_REQUIRED',
  /**
   * 422 — Round 20: a crew-board save NEWLY gave a row a type («النوع») that is not an active type
   * of the `أنواع التشغيل` catalog (unknown, or archived). A row keeps a type it already holds.
   * Details: `field` 'shiftTypeId' (`message` the id refused) and `field` 'rows' (`code` 'ROW_INDEX',
   * `message` the row's index in the save).
   */
  OPERATIONS_UNKNOWN_SHIFT_TYPE: 'OPERATIONS_UNKNOWN_SHIFT_TYPE',
  /**
   * @deprecated UNUSED since Round 28 — no server sends it. Round 20 refused a crew-board save that
   * gave a row a NEW or CHANGED «الاتجاه» that was not the name of an active operations area («لازم
   * اختار من الاتجاهات اللى موجوده»); Round 28 reverses that («عاوز الاتجاه اقدر اكتبه بايدى لو مش
   * موجود فى الليست»): a hand-typed direction is stored as typed. Kept so a client built before the
   * change still reads the code, and so no other refusal reuses its name. Its details were: one per
   * part refused (`field` 'direction', `message` the part as typed), then `field` 'rows' (`code`
   * 'ROW_INDEX', `message` the row's index).
   */
  OPERATIONS_DIRECTION_NOT_AN_AREA: 'OPERATIONS_DIRECTION_NOT_AN_AREA',
  /**
   * 422 — Round 22: a crew-board save NEWLY put on a row somebody HR has as away on the board's day
   * («لو القائد غايب ... مقدرش احطه على العربيه و كذلك الاخصائيين») — the member's `availability`
   * in the pool. Someone already on that row before the save stays. Details: `field` 'employeeId'
   * (`code` 'ABSENT' or 'ON_LEAVE', `message` the employee's id), then `field` 'rows' (`code`
   * 'ROW_INDEX', `message` the row's index in the save).
   */
  OPERATIONS_CREW_MEMBER_ABSENT: 'OPERATIONS_CREW_MEMBER_ABSENT',
  /**
   * 422 — Round 23: a crew-board save, or a standing-crew save, NEWLY put somebody in a slot his
   * role does not fit (`fitsCrewSlot`): «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد
   * اخصائى». A captain-only in a specialist's slot, or a specialist — or somebody with no requirements
   * row — in the captain's; a captain-specialist fits every slot. Somebody already in that same slot
   * of that same row before the save stays. Details: `field` 'employeeId' (`code` 'NOT_A_CAPTAIN' or
   * 'NOT_A_SPECIALIST', `message` the employee's id), then `field` 'rows' (`code` 'ROW_INDEX',
   * `message` the row's index in the save).
   */
  OPERATIONS_CREW_MEMBER_WRONG_SLOT: 'OPERATIONS_CREW_MEMBER_WRONG_SLOT',
  /**
   * 422 — Round 24: a crew-board save gave a row a van the Fleet roster does not have that day, and
   * Fleet does not hold it as an ACTIVE vehicle (unknown, deleted, out of service or disposed). A
   * row that already holds its van is not asked again. Details: `field` 'vehicleId' (`code`
   * 'NOT_ACTIVE', `message` the vehicle's id), then `field` 'rows' (`code` 'ROW_INDEX', `message` the
   * row's index in the save).
   */
  OPERATIONS_CREW_VEHICLE_NOT_ACTIVE: 'OPERATIONS_CREW_VEHICLE_NOT_ACTIVE',
  /**
   * 422 — Round 24: a crew-board save gave a row a van the Fleet roster does not have that day, and
   * Fleet's workshop holds it that day (an open visit — the board's «صيانة»). A roster van is
   * Fleet's decision and is not asked; a row that already holds its van keeps it. Details: `field`
   * 'vehicleId' (`code` 'IN_WORKSHOP', `message` the vehicle's id), then `field` 'rows' (`code`
   * 'ROW_INDEX', `message` the row's index in the save).
   */
  OPERATIONS_CREW_VEHICLE_IN_WORKSHOP: 'OPERATIONS_CREW_VEHICLE_IN_WORKSHOP',
  /**
   * 409 — Round 24: a saved row was given a van («X takes V») that ANOTHER live crew row of the day
   * still holds at the end of the save (one van, one row a day — `ux_day_vehicle`). Remove that row
   * in the same save to free the van. (A ROSTER van's row emptied to nothing, with no shipment leg,
   * does not hold it: it is released in the same save.) Details: `field` 'vehicleId' (`code` 'TAKEN', `message` the
   * vehicle's id), `field` 'crewAssignmentId' (`code` 'CREW_ROW', `message` the id of the row that
   * holds it), then `field` 'rows' (`code` 'ROW_INDEX', `message` the row's index in the save).
   */
  OPERATIONS_CREW_VEHICLE_TAKEN: 'OPERATIONS_CREW_VEHICLE_TAKEN',
  /**
   * 409 — Round 24: a crew-board save would REMOVE a row that holds محصنات — live shipment legs
   * (placed on it on «توزيع المحصنات», delivered or not): removing it would strand them on a row
   * nobody sees. Take them off on «توزيع المحصنات», or give the row a van instead (it keeps its id
   * and its legs). Details: `field` 'crewAssignmentId' (`code` 'CREW_ROW', `message` the row's id),
   * `field` 'shipments' (`code` 'COUNT', `message` how many legs it holds), then `field`
   * 'removeCrewAssignmentIds' (`code` 'REMOVAL_INDEX', `message` the removal's index in the save).
   */
  OPERATIONS_CREW_ROW_HAS_SHIPMENTS: 'OPERATIONS_CREW_ROW_HAS_SHIPMENTS',
  /**
   * 422 — Round 32: a crew-board save (`POST /operations/crew-board`) named a day before today on
   * the Cairo calendar. The owner: «لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا عاوزها اظهار
   * فقط» — a past day opens on «لوحة التشغيلة» as its RECORD, view only (the read answers it with
   * `past: true`), and this keeps it so whatever a client sends: nothing of it is written, checked
   * before any row. One detail: `field` 'date', `code` 'MIN_DATE', `message` = today ('YYYY-MM-DD').
   */
  OPERATIONS_CREW_DAY_IN_PAST: 'OPERATIONS_CREW_DAY_IN_PAST',
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
  /**
   * 422 — the shipments history range holds more than `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS`
   * shipments. Refused, never cut short: totals over a silently truncated list would be wrong
   * figures. Details carry `count` and `max` (field = the name, message = the number).
   */
  OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE: 'OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE',
  /**
   * 422 — «مينفعش لما يجى يضيف شحنه يختار تاريخ فات»: a NEW shipment dated before today on the
   * Cairo calendar (its collection date, or a secured one's delivery date), or a delivery date set
   * for the first time on an edit before today. One detail: `field` = the date refused,
   * `code` = 'MIN_DATE', `message` = the earliest day allowed ('YYYY-MM-DD').
   */
  OPERATIONS_SHIPMENT_DATE_IN_PAST: 'OPERATIONS_SHIPMENT_DATE_IN_PAST',
  /**
   * 422 — «ميقدرش يحدد يوم قبل يوم اللى كانت عليه الشحنة»: an edit moving the collection date (or
   * the delivery date) EARLIER than the day the shipment is on. Later, or unchanged, is accepted.
   * Same detail shape as `OPERATIONS_SHIPMENT_DATE_IN_PAST`; `message` = the shipment's current day.
   */
  OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL: 'OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL',
  /**
   * 422 — a secured shipment's delivery date before its collection date («تاريخ التسليم تانى يوم
   * الاستلام افتراضى وممكن يغير» — it may move, never to before the collection day; the same day
   * is accepted). Checked on create and on an edit that changes either date. Same detail shape as
   * `OPERATIONS_SHIPMENT_DATE_IN_PAST`, `field` = 'deliveryDate', `message` = the collection day.
   */
  OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION: 'OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION',
  /** 409 — a restore asked for a shipment that is not deleted. */
  OPERATIONS_SHIPMENT_NOT_DELETED: 'OPERATIONS_SHIPMENT_NOT_DELETED',

  // ── The secured pickup ✓, the vault lock and the cancelled receipt (Round 10) ────────────────
  /**
   * 409 — the shipment is LOCKED: a secured shipment the vault has received (status `inVault`,
   * `dispatched` or `completed`) — «ميقدر حد من القادة او العمليات او الخزنه يعدل عليها». Refuses
   * the edit, the delete, the receipt photo, the pickup crew, and the desk's pickup ✓ / its undo.
   * The way back is the cancelled receipt (`operationsVault.cancelReceipt`).
   */
  OPERATIONS_SECURED_LOCKED: 'OPERATIONS_SECURED_LOCKED',
  /**
   * 409 — nobody has confirmed collecting this secured shipment (stage `awaitingPickup`): the
   * desk's undo has no pickup ✓ to take back. Round 10's other use — the vault's ✓ refusing a white
   * row — was lifted in Round 13 («والخزنه تستلم عادي»): the vault receives any draft.
   */
  OPERATIONS_SECURED_NOT_PICKED_UP: 'OPERATIONS_SECURED_NOT_PICKED_UP',
  /**
   * 409 — the desk's pickup ✓ on a secured shipment whose pickup is already recorded — by its
   * captain in the app or by the desk itself. The desk never stamps over the captain's ✓ (it may
   * take it back, then confirm as Operations).
   */
  OPERATIONS_SECURED_ALREADY_PICKED_UP: 'OPERATIONS_SECURED_ALREADY_PICKED_UP',
  /**
   * 409 — a cancelled receipt asked for a shipment that is not in the vault: not received yet, or
   * already dispatched or completed.
   */
  OPERATIONS_SECURED_NOT_IN_VAULT: 'OPERATIONS_SECURED_NOT_IN_VAULT',

  // ── «الشحنات المسلَّمة» — the delivery confirmed with its receipt (Round 33 B) ───────────────
  /**
   * 409 — the ✓ of «الشحنات المسلَّمة» on a shipment that has not reached its bank
   * (`isOperationsShipmentDeliveredToBank`): its captain has not confirmed delivering it to the
   * destination in the app, or — a محصنة — it has not left the vault for it.
   */
  OPERATIONS_SHIPMENT_NOT_DELIVERED: 'OPERATIONS_SHIPMENT_NOT_DELIVERED',
  /** 409 — the ✓ on a delivery already confirmed (a colleague pressed it first). */
  OPERATIONS_DELIVERY_ALREADY_CONFIRMED: 'OPERATIONS_DELIVERY_ALREADY_CONFIRMED',
  /** 409 — «إلغاء التأكيد» on a delivery that is not confirmed (taken back already). */
  OPERATIONS_DELIVERY_NOT_CONFIRMED: 'OPERATIONS_DELIVERY_NOT_CONFIRMED',
  /**
   * 422 — the ✓ with no receipt number («لازم يكون فيه رقم الايصال»): empty once trimmed. One
   * detail: `field` 'receiptNumber', `code` 'REQUIRED'.
   */
  OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED: 'OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED',
  /**
   * 422 — a receipt number longer than `OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX` once trimmed. One
   * detail: `field` 'receiptNumber', `code` 'MAX_LENGTH', `message` the most allowed.
   */
  OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG: 'OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG',
  /**
   * 422 — the ✓ without choosing whose bank is billed («يحدد البنك من او الى»). One detail: `field`
   * 'billedSide', `code` 'REQUIRED'.
   */
  OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED: 'OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED',
  /**
   * 409 — Round 33 critic: an edit that moves the shipment's «من فرع» or «إلى فرع» while its
   * delivery is CONFIRMED with its receipt. The bank billed for moving it was chosen between those
   * two branches' banks at the ✓ (`deliveryConfirmation.billedBranchId` / `billedBankId`); moving
   * either one would leave that record naming a branch the shipment no longer has. «إلغاء التأكيد»
   * first, then the edit, then the ✓ again. Every other field still edits as before.
   */
  OPERATIONS_DELIVERY_CONFIRMED_BRANCH_LOCKED: 'OPERATIONS_DELIVERY_CONFIRMED_BRANCH_LOCKED',
  /**
   * 409 — Round 21b: the vault's receipt (`POST /operations/secured/:id/receive`) names a seal the
   * vault STILL HOLDS on another محصنة. The owner: «لو موجوده عندنا لا ك محصنة يبقى مينفعش ولو دخلت
   * وخرجت واتكرر يبقى عادى» — refused while that محصنة is with us; once it has gone out (released to
   * its van, dispatched, completed) or its receipt was cancelled, the number may come again. "Held"
   * is the custody's `state: 'held'` on a receipt not cancelled — what the vault inventory lists;
   * "the same seal" is `vaultSealKey`'s (0099 = 99 = ٩٩). Nothing is written. One detail per seal
   * refused: `field` its place in THIS receipt as stored (`bagSeals.<i>` / `boxSeals.<i>`, blank
   * boxes dropped — the form sends none), `code` 'HELD_IN_VAULT', `message` the id of the held
   * shipment it is on; `POST /operations/secured/seal-check` names that محصنة (bank, branches,
   * receipt number) for a screen.
   */
  OPERATIONS_SEAL_HELD_IN_VAULT: 'OPERATIONS_SEAL_HELD_IN_VAULT',

  // ── «توزيع المحصنات» (Round 12) ─────────────────────────────────────────────────────────────
  /**
   * 422 — the distribution save (`POST /operations/secured/distribution`) named a day before today
   * on the Cairo calendar: a past day's vans have left. One detail: `field` 'date', `code`
   * 'MIN_DATE', `message` = today ('YYYY-MM-DD'). Round 30: the read (`GET`) answers such a day as
   * its record, read only — this is what keeps it so. R30 critic: `POST
   * /operations/secured/:id/assign-delivery` onto a crew row of such a day answers it too (the same
   * delivery leg), with the same detail.
   */
  OPERATIONS_DISTRIBUTION_DAY_IN_PAST: 'OPERATIONS_DISTRIBUTION_DAY_IN_PAST',
  /**
   * 409 — a distribution change named a secured shipment that is already `dispatched` or `completed`:
   * it has left the vault, and its van is history. Detail: `field` 'shipmentId', `message` its id.
   */
  OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED: 'OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED',
  /**
   * 422 — a distribution change named a shipment that is not this day's: neither due on the day
   * (draft or in the vault) nor OVERDUE in the vault (delivery date before TODAY, Cairo). A draft due
   * another day, one with no delivery date, or one in the vault due on its own day between today and
   * the day asked for. Detail: `field` 'shipmentId', `message` its id.
   */
  OPERATIONS_DISTRIBUTION_NOT_ON_DAY: 'OPERATIONS_DISTRIBUTION_NOT_ON_DAY',
  /**
   * 409 — a distribution change would move or clear a delivery leg its captain has already started
   * in the app (`executionStatus` past `pending`). Also the shipment edit's (`PATCH
   * /operations/shipments/:id`) when it would move a secured shipment's delivery date off the day of
   * such a leg, or clear it — the edit would take the stop off his van just the same; nothing is
   * written. Detail: `field` 'shipmentId', `message` its id.
   */
  OPERATIONS_DISTRIBUTION_LEG_STARTED: 'OPERATIONS_DISTRIBUTION_LEG_STARTED',
  /**
   * 422 (Round 25 — «انا عاوز اللى يظهر اللى نوعها محصنة بس») — a distribution change put a
   * shipment on a crew row whose «النوع» is not the seeded «محصنة» type (another type, or none),
   * and the shipment is not already on that row. Nothing is written. Details: `field` 'shipmentId',
   * `code` 'SHIPMENT', `message` its id; then `field` 'crewAssignmentId', `code` 'NOT_SECURED',
   * `message` the row's id.
   */
  OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED: 'OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED',
  /**
   * 422 — a dispatch (`POST /operations/secured/dispatch`, the vault's «تسليم») named a van — a crew
   * row — whose operating day is not TODAY on the Cairo calendar. A van is handed over on its own
   * day: «تسليم المحصنات» offers «تسليم» on today's vans only, and the server holds the same line, so
   * a page left open from another day, or a call made by hand, cannot release tomorrow's van today
   * (nor a past day's, which has left). Checked before any shipment; nothing is written. One
   * detail: `field` 'crewAssignmentId', `code` 'TODAY_ONLY', `message` = today ('YYYY-MM-DD').
   */
  OPERATIONS_DISPATCH_NOT_TODAY: 'OPERATIONS_DISPATCH_NOT_TODAY',

  // ── Captain execution (OP-7, NEW — no legacy counterpart) ─────────────────────────────────────
  /** The action is not legal from the stop's current execution state (start/pickup/deliver/complete). */
  OPERATIONS_INVALID_EXECUTION_TRANSITION: 'OPERATIONS_INVALID_EXECUTION_TRANSITION',
  /** The sequential lock: an earlier stop on this captain's route is not finished yet. */
  OPERATIONS_EXECUTION_OUT_OF_SEQUENCE: 'OPERATIONS_EXECUTION_OUT_OF_SEQUENCE',
  /**
   * Nothing left to execute here — the stop is already settled: the captain finished it, the back
   * office completed the shipment, or (Round 13) the vault received a secured shipment whose pickup
   * leg he never started.
   */
  OPERATIONS_EXECUTION_ALREADY_SETTLED: 'OPERATIONS_EXECUTION_ALREADY_SETTLED',
  /** Someone else moved this stop first; the transition's precondition no longer holds. */
  OPERATIONS_EXECUTION_CONFLICT: 'OPERATIONS_EXECUTION_CONFLICT',

  // ── ATM operations (docs/12-planning/atm-operations-port.md) ──────────────────────────────────
  /**
   * The owner's rule of 2026-10-13 («مينفعش أضيف ماكينة مرتين»; per Cairo day since 2026-10-27)
   * answered this: the machine code already had an OPEN operation that day. Replenishments left
   * the rule 2026-11-01 (port doc OD-1b) and maintenance 2026-11-02 (OD-1c), so NO path answers it
   * any more — a machine may have several open of either kind. Kept reserved, never reused.
   */
  ATM_OPERATION_ALREADY_OPEN: 'ATM_OPERATION_ALREADY_OPEN',
  /**
   * «قراءة الآن» while a reading of the maintenance mailbox is already running (the minute's own, or
   * another person's): one reading at a time (2026-11-13), and that one's result is what the
   * screen's last-run line will show.
   */
  ATM_MAIL_POLL_BUSY: 'ATM_MAIL_POLL_BUSY',

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
  /**
   * 422 — the sheet is not the company's layout (a header is missing, no sheet), or over a cap.
   * Also on a decision («✓ / ✗», «ربط الكروت بالسيارات», «إضافة») against a session whose sheet's
   * names are another company's — the screen's wrong-company stop, held by the server too: nothing
   * written, `{ field: 'company', code: 'WRONG_COMPANY', message: <the sheet's company> }`; and on
   * «إضافة» of a row whose own name carries another company's prefix, or a name longer than a card
   * name may be (`{ field: 'name', code: 'WRONG_COMPANY' | 'TOO_LONG', message: 'name' }`).
   */
  FLEET_FUEL_SHEET_LAYOUT: 'FLEET_FUEL_SHEET_LAYOUT',
  /**
   * 409 — a named card changed after the sheet was read; nothing was written. One detail per card:
   * `{ field: 'cardIds', code: 'CARD_CHANGED', message: <cardId> }`. Also `LINK_CHANGED` (the
   * card's car or label changed since the read) and `REQUEST_CHANGED` (an `approveRequests` card's
   * «طلب رصيد» is no longer the sheet's difference).
   */
  FLEET_FUEL_RECONCILE_CARD_CHANGED: 'FLEET_FUEL_RECONCILE_CARD_CHANGED',
  /**
   * 409 — a named card was already decided in this session; nothing was written. One detail per
   * card: `{ field: 'cardIds', code: 'DECIDED', message: <cardId> }`. Also for a link row already
   * decided and a sheet-only card already added.
   */
  FLEET_FUEL_RECONCILE_DECIDED: 'FLEET_FUEL_RECONCILE_DECIDED',
  /**
   * 422 — a charge named in `cancelCharges` cannot be cancelled by this sheet: it is not a stored
   * candidate of its line (or its card is not decided `apply`), it is already cancelled, or the
   * charges named for one card add up to more than the system's balance exceeds the sheet's.
   * Nothing was written. `{ field: 'cancelCharges', code: 'NOT_A_CANDIDATE' | 'CANCELLED' |
   * 'EXCEEDS_DIFFERENCE', message: <movementId | cardId> }`.
   */
  FLEET_FUEL_RECONCILE_CANCEL_REFUSED: 'FLEET_FUEL_RECONCILE_CANCEL_REFUSED',
  /**
   * 409 — «ربط الكروت بالسيارات»: the target car already holds a card of this company that does not
   * move away in the same decision. Nothing was written. `{ field: 'cardIds', code: 'SLOT_HELD',
   * message: <cardId> }`.
   */
  FLEET_FUEL_LINK_SLOT_HELD: 'FLEET_FUEL_LINK_SLOT_HELD',
  /**
   * 409 — the card's link is held back until the card-number repair («ضمن تصحيح الأرقام»): its
   * name and balance sit on the wrong record, so moving it by the sheet would put it on the wrong
   * car. Nothing was written. `{ field: 'cardIds', code: 'IN_REPAIR', message: <cardId> }`.
   */
  FLEET_FUEL_LINK_IN_REPAIR: 'FLEET_FUEL_LINK_IN_REPAIR',
  /**
   * 422 — «إضافة» a sheet-only card: the sheet does not print the full number and none was typed
   * (`REQUIRED`), or the typed number's last four digits (or the sheet's printed prefix) differ
   * from the sheet's (`MISMATCH`). `{ field: 'number', code: 'REQUIRED' | 'MISMATCH' }`.
   */
  FLEET_FUEL_SHEET_CARD_NUMBER: 'FLEET_FUEL_SHEET_CARD_NUMBER',
  /**
   * 409 — a balance ✓ (`apply`) names a card of the 0849 pair while «تصحيح أرقام الكروت» (6d) has not
   * run, or on a session read before it ran («ضمن تصحيح الأرقام»): the sheet is matched by name, and
   * each of the two names sits on the other car's record until the repair. Nothing was written; ✗
   * is allowed. One detail per card: `{ field: 'cardIds', code: 'IN_REPAIR', message: <cardId> }`.
   */
  FLEET_FUEL_RECONCILE_IN_REPAIR: 'FLEET_FUEL_RECONCILE_IN_REPAIR',
  /**
   * 422 — a fuel card photo's thumbnail (the multipart part `thumb`) is not a JPEG, PNG or WebP
   * (`TYPE`), is larger than `FLEET_FUEL_CARD_THUMB_MAX_SIDE` pixels on a side (`SIZE`), or than
   * `FLEET_FUEL_CARD_THUMB_MAX_BYTES` (`BYTES`), or is missing where required (`REQUIRED`). Read from
   * the file's header only. Nothing was written. `{ field: 'thumb', code: … }`.
   */
  FLEET_FUEL_CARD_THUMB_INVALID: 'FLEET_FUEL_CARD_THUMB_INVALID',

  // ── Fleet accident transfers («أخذ مبلغ من متبقي سيارة أخرى») ───────────────────────────────
  /**
   * 422 — the cars picked have less left, together, than the amount sent. Read inside the save's
   * own transaction, so it is what another clerk's take left a moment ago — the screen plans
   * within what it was shown and never sends more. Nothing was written. Two details, each figure
   * in pounds as a plain decimal string (`'1200.50'`):
   * `{ field: 'available', code: 'AVAILABLE', message }` — what the picked cars have together, and
   * `{ field: 'amount', code: 'AMOUNT', message }` — the amount sent.
   */
  FLEET_ACCIDENT_TRANSFER_SHORT: 'FLEET_ACCIDENT_TRANSFER_SHORT',
  /**
   * 422 — the amount is more than the receiving file's negative: a take brings a file up to zero
   * and never past it. The negative is the file's «المتبقي» as this save leaves its facts (a new
   * file's figures as sent; an edit's figures over the stored file, read in the transaction),
   * before the take; a file at zero or above has none. Nothing was written. Two details, in pounds
   * as plain decimal strings: `{ field: 'deficit', code: 'DEFICIT', message }` — the negative
   * (`'0.00'` when there is none), and `{ field: 'amount', code: 'AMOUNT', message }` — the amount
   * sent.
   */
  FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT: 'FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT',

  // ── IT vehicle device checks (docs/12-planning/it-vehicle-checks-design.md) ───────────────────
  /**
   * 422 — the car exists but its Fleet status is not `active` (out of service, disposed): a report
   * is filed only on an active car. Nothing was written. A missing or deleted car is 404 instead.
   */
  IT_VEHICLE_NOT_ACTIVE: 'IT_VEHICLE_NOT_ACTIVE',
  /**
   * 409 — another user already filed a report with this `clientRequestId`. Nothing was written; the
   * form makes a new id. The same reporter repeating it gets 200 with the report that exists.
   */
  IT_VEHICLE_CHECK_REQUEST_REUSED: 'IT_VEHICLE_CHECK_REQUEST_REUSED',
  /** 422 — the report already holds `IT_VEHICLE_CHECK_MAX_PHOTOS` photos; no file was stored. */
  IT_VEHICLE_CHECK_PHOTO_LIMIT: 'IT_VEHICLE_CHECK_PHOTO_LIMIT',
  /**
   * 422 — the report was filed more than `IT_VEHICLE_CHECK_PHOTO_WINDOW_HOURS` hours ago, so no
   * photo is added to it any more; no file was stored.
   */
  IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED: 'IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED',
  /**
   * 422 — a device is «لا يعمل» and the report carries no note (`vehicleCheckNeedsNotes`). Nothing
   * was written. A repeat of a report already filed is answered before this rule.
   */
  IT_VEHICLE_CHECK_NOTES_REQUIRED: 'IT_VEHICLE_CHECK_NOTES_REQUIRED',

  // ── IT consumables: the printer counter («عداد الطابعة», docs/12-planning/it-module-design.md §2.11)
  /**
   * 422 — an issue line of a type that `requiresCounterReading` («حبارات») with no printer
   * («مركّب على»), no counter reading, or a quantity other than one (one cartridge a line); or
   * «تعديل الجهاز» moving a counted issue onto a device with no reading. Nothing was written. One
   * detail per gap: `field` 'lines.<i>.assetId', 'lines.<i>.counterReading' or 'lines.<i>.qty' (the
   * issue, `<i>` the line's index in the request) or 'counterReading' (the device change); `code`
   * 'REQUIRED', or 'ONE_CARTRIDGE' on the quantity; `message` free text.
   */
  IT_CONSUMABLE_COUNTER_REQUIRED: 'IT_CONSUMABLE_COUNTER_REQUIRED',
  /**
   * 422 — the reading is not STRICTLY above the printer's previous reading (ordered by `at`, then
   * id), and the reading is not ticked «تم تصفير عداد الطابعة». Equal is refused too; only lines of
   * ONE issue on one printer share a reading. Read inside the write's transaction, under the
   * printer's lock, so it is the reading another clerk wrote a moment ago. Nothing was written. Two
   * details on the reading's field (`lines.<i>.counterReading`, or `counterReading` on «تعديل
   * الجهاز»): `{ code: 'PREVIOUS_READING', message: <that reading, a plain integer> }` and
   * `{ code: 'PREVIOUS_AT', message: <its time, ISO 8601> }`.
   */
  IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS: 'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS',
  /**
   * 422 — a backdated reading (an issue or a correction dated before a later reading of that
   * printer) is not STRICTLY below that later reading, and the later one is not a reset. Nothing was
   * written. Two details on the reading's field, as `IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS`:
   * `{ code: 'NEXT_READING', message: <that reading> }` and `{ code: 'NEXT_AT', message: <its time> }`.
   */
  IT_CONSUMABLE_COUNTER_ABOVE_NEXT: 'IT_CONSUMABLE_COUNTER_ABOVE_NEXT',

  // ── Administrative Affairs: master data (docs/12-planning/administration-module-design-flows.md §5.15)
  /**
   * 422 — an item category's parent is refused; nothing was written. One detail, `field`
   * 'parentId', `code` one of `ADMINISTRATION_CATEGORY_PARENT_PROBLEMS`: 'self' (the category
   * itself), 'cycle' (one of its own subcategories), 'tooDeep' (a subcategory: two levels, OD-06),
   * 'inactive' (a retired parent) or 'hasChildren' (a category that has subcategories never moves
   * under another).
   */
  ADMINISTRATION_CATEGORY_PARENT_INVALID: 'ADMINISTRATION_CATEGORY_PARENT_INVALID',
  /**
   * 409 — a live master row already holds this name, code or barcode; nothing was written. One
   * detail whose `field` names what clashed: 'name' (compared folded, «قطعه» = «قطعة»: the
   * `nameKey` of the Arabic name), 'code' or 'barcode' (an item's; its unique index is its only
   * check). Retired rows still hold theirs: reactivate, never recreate. The answer to the
   * service's own check and to a unique index that refused a racing write alike.
   */
  ADMINISTRATION_DUPLICATE: 'ADMINISTRATION_DUPLICATE',
  /**
   * 422 — an item's stock levels are out of order: where set, min ≤ reorder point ≤ max (OD-09),
   * judged on the row the write would leave; nothing was written. One detail per field out of
   * order, `field` one of `ADMINISTRATION_STOCK_LEVEL_FIELDS` and `code` 'outOfOrder': both ends
   * of each comparison that fails.
   */
  ADMINISTRATION_STOCK_LEVELS_ORDER: 'ADMINISTRATION_STOCK_LEVELS_ORDER',
  /**
   * 422 — an item names a retired unit or category, or a supplier a retired item category, on a
   * create or by changing it; nothing was written. A row that already names one keeps it. One
   * detail per retired reference, `code` 'inactive': an item's `field` is 'unitId' or
   * 'categoryId'; a supplier's is 'categoryIds', its `message` the retired category's id.
   */
  ADMINISTRATION_REFERENCE_INACTIVE: 'ADMINISTRATION_REFERENCE_INACTIVE',
  /**
   * 422 — an item names a category that has active subcategories: it names one of those instead
   * (OD-06 (i)), on a create or by changing its category; nothing was written. An item whose
   * category gained its first subcategory later keeps it. One detail, `field` 'categoryId', `code`
   * 'subcategoryRequired'.
   */
  ADMINISTRATION_SUBCATEGORY_REQUIRED: 'ADMINISTRATION_SUBCATEGORY_REQUIRED',
  /**
   * 422 — a warehouse is given a keeper whom HR answers as having left (IT's rule: a positive
   * `exited` only; an id the directory cannot read passes); nothing was written. A warehouse whose
   * keeper left later keeps them until the keeper is changed. One detail, `field`
   * 'responsibleEmployeeId', `code` 'exited'.
   */
  ADMINISTRATION_EMPLOYEE_EXITED: 'ADMINISTRATION_EMPLOYEE_EXITED',
  /**
   * 422 — a warehouse is retired while something still holds it (OD-70 B): stock on hand or in
   * transit, or a document not yet ended that names it; nothing was written. One detail per hold,
   * `field` 'isActive', `code` one of `ADMINISTRATION_DEACTIVATION_PROBLEMS`: 'holdsStock' or
   * 'openDocument'. Nothing can hold a warehouse before stock and documents exist (P5), so the
   * code is first met then.
   */
  ADMINISTRATION_DEACTIVATION_BLOCKED: 'ADMINISTRATION_DEACTIVATION_BLOCKED',
  /**
   * 422 — a typed attachment list already holds `ADMINISTRATION_MAX_LIST_ATTACHMENTS` (20) entries
   * (a supplier's papers, design §11.4); the file was not linked and nothing of it is kept (an
   * upload that raced past the check is withdrawn). One detail, `field` 'attachments', `code`
   * 'limit'. Remove a paper first.
   */
  ADMINISTRATION_ATTACHMENT_LIMIT: 'ADMINISTRATION_ATTACHMENT_LIMIT',

  // ── Compliance and Risks: the files page (docs/12-planning/compliance-files-design.md §8)
  /**
   * 409 — another live folder already has this name, compared through the shared `foldName`
   * («عقود الموردين» and «عقود  الموردين», «أ» and «ا» are one name); nothing was written. One
   * detail, `field` 'name', `code` 'taken'.
   */
  COMPLIANCE_FOLDER_NAME_TAKEN: 'COMPLIANCE_FOLDER_NAME_TAKEN',
  /**
   * 422 — a folder is shared with an account that is not an active employee login; nothing was
   * written. One detail per refused id, `field` 'viewerUserIds', `code` 'notEligible', `message`
   * the id. A person already on the list whose account was since suspended stays on it.
   */
  COMPLIANCE_VIEWER_INVALID: 'COMPLIANCE_VIEWER_INVALID',
  /**
   * 422 — the file's contents are not what its name says (a renamed picture called «.pdf»);
   * nothing was stored. One detail, `field` 'file', `code` 'contentMismatch'.
   */
  COMPLIANCE_FILE_CONTENT_MISMATCH: 'COMPLIANCE_FILE_CONTENT_MISMATCH',

  // ── Crew roster (B3) ──────────────────────────────────────────────────────────────────────────
  /** The employee holds no operations requirements row, so is not on the crew roster. */
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
