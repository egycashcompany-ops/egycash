// Quick selection by TYPE — «قراءة فقط .. تعديل فقط .. وهكذا» — beside the role's permission tree.
//
// The tree answers "what may this role do on that screen"; an administrator building a role also
// asks the other question, "may it only read?", across many screens at once. Every permission the
// registry declares already carries an `action` (`view`, `create`, `edit`, `approve`, …, 99 of them
// on 2026-11-25), so the type is read from the registry, never inferred from a key's spelling.
//
// **Organizational, never authorizational** — the same standing as the page layer. A group is a
// shortcut for ticking its boxes one by one: it goes through the matrix's own `applyBulk`, so it
// reaches only what the administrator may grant, and the server's guards still decide.
//
// **What a type includes is the screen's promise, so the two that grant more than their name says
// are kept out of every other type:**
//   • SENSITIVE reads — pay, national IDs, machine keys and combinations, a fuel card's password.
//     «العرض» (read only) must not hand out the safe-door combination because its action is
//     spelled `viewSecrets`.
//   • BREAK-GLASS keys (`breakGlass: true` in the registry) — permanent deletion, forced sign-out,
//     a setup link. Whatever their action, they sit only in their own type and are ticked only on
//     purpose.
//
// An action this table does not name falls to OTHER — the workflow steps (close, send, receive,
// plan, …), never a silent upgrade into a broader type. A new module's actions therefore land
// somewhere safe on day one, and moving one into a named type is a deliberate edit here.
import { type PermissionDto } from '@ecms/contracts';
import { type MatrixRow } from './permission-selection';

/** The types, in the order the panel lists them: the everyday four first, the guarded two last. */
export const ACTION_GROUPS = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'import',
  'approve',
  'manage',
  'other',
  'sensitive',
  'breakGlass',
] as const;

export type ActionGroupId = (typeof ACTION_GROUPS)[number];

/** `action` → type, for every action that is not OTHER. Break-glass is decided by the flag, below. */
const GROUP_OF_ACTION: Readonly<Record<string, Exclude<ActionGroupId, 'other' | 'breakGlass'>>> = {
  // Reading — and nothing that reads more than the screen shows everybody.
  view: 'view',
  viewLog: 'view',
  viewLedger: 'view',
  // Reading what a plain «عرض» must never include.
  viewSensitive: 'sensitive',
  viewCompensation: 'sensitive',
  viewInsurance: 'sensitive',
  viewOfficer: 'sensitive',
  viewNationalId: 'sensitive',
  viewSecrets: 'sensitive',
  reveal: 'sensitive',
  // Adding a record.
  create: 'create',
  record: 'create',
  recordPunch: 'create',
  registerDirect: 'create',
  upload: 'create',
  request: 'create',
  requestForOthers: 'create',
  requestRegularization: 'create',
  capture: 'create',
  // Changing a record that exists.
  edit: 'edit',
  editPersonal: 'edit',
  amend: 'edit',
  changeCode: 'edit',
  changeStatus: 'edit',
  correct: 'edit',
  reorder: 'edit',
  moveArea: 'edit',
  locate: 'edit',
  reassign: 'edit',
  adjustBalances: 'edit',
  // Removing one. Permanent deletion is break-glass in the registry, and goes there.
  delete: 'delete',
  // Taking data out.
  export: 'export',
  print: 'export',
  download: 'export',
  // Bringing data in from a file.
  import: 'import',
  importRoster: 'import',
  importPunches: 'import',
  // Deciding.
  approve: 'approve',
  approveOvertime: 'approve',
  decide: 'approve',
  decideApprove: 'approve',
  decideRegularization: 'approve',
  confirm: 'approve',
  finalize: 'approve',
  review: 'approve',
  evaluate: 'approve',
  assess: 'approve',
  verifyIdentity: 'approve',
  override: 'approve',
  // Running a list or a setting as a whole — what many modules name their one write permission.
  manage: 'manage',
  manageBatch: 'manage',
  manageActions: 'manage',
  manageCompensation: 'manage',
  manageInsurance: 'manage',
  manageOfficer: 'manage',
  manageTypes: 'manage',
  manageShifts: 'manage',
  manageWorkingHours: 'manage',
  manageSessions: 'manage',
  configure: 'manage',
  assign: 'manage',
};

/** The type one permission belongs to. Break-glass wins over every action. */
export const actionGroupOf = (
  permission: Pick<PermissionDto, 'action' | 'breakGlass'>,
): ActionGroupId =>
  permission.breakGlass ? 'breakGlass' : (GROUP_OF_ACTION[permission.action] ?? 'other');

/**
 * The rows of one type inside a scope (`null` = every module). A key the registry no longer knows
 * has no action, so it belongs to no type — it stays where the tree shows it, removable one by one.
 */
export const rowsOfGroup = (
  rows: readonly MatrixRow[],
  group: ActionGroupId,
  moduleId: string | null,
): MatrixRow[] =>
  rows.filter(
    (row) =>
      row.definition !== undefined &&
      (moduleId === null || row.definition.moduleId === moduleId) &&
      actionGroupOf(row.definition) === group,
  );
