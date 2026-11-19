// WHO HOLDS AN ASSET — an employee, or a department kept at a place and signed for by its
// responsible person («في عهدة إدارة … — الموقع …», 2026-11-19). Pure: no database, no request.
//
// Every custody site that used to read `String(open.assignedToEmployeeId)` asks this module
// instead. That is the point of it: an interval held by a department has NO employee holder, and
// `String(null)` is the text "null" — it compiles, and it would have named «null» the holder, the
// recipient and the leaver on every screen. The type below has no employee id for a department to
// be mistaken for one, and the signer is a separate question (`signerOf`), never the holder.
//
// A department's custody is the department, the place AND the signer together: changing any one
// of the three is a new holder — a new paper, nothing carried over (custody's transfer).
import { Types } from 'mongoose';
import { type AuditChange, type ItCustodianDepartmentInput } from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { type ItAssetAssignmentDoc } from './assignment.model';

export type CustodyHolder =
  | { kind: 'employee'; employeeId: string }
  | {
      kind: 'department';
      departmentId: string;
      locationId: string;
      responsibleEmployeeId: string;
    };

export type DepartmentHolder = Extract<CustodyHolder, { kind: 'department' }>;

/** The interval fields that name its holder. */
export type IntervalHolderFields = Pick<
  ItAssetAssignmentDoc,
  'holderKind' | 'assignedToEmployeeId' | 'departmentId' | 'locationId' | 'responsibleEmployeeId'
>;

/** An id as the database spells it — `objectId()` admits upper-case hex. Empty for none. */
const idText = (id: Types.ObjectId | string | null | undefined): string =>
  id == null ? '' : String(id).toLowerCase();

/**
 * The holder of a stored interval. An interval written before department custody carries no
 * `holderKind` and is an employee's — the `requiresCounterReading ?? false` precedent: a lean read
 * applies no schema default, and nothing was migrated.
 */
export const holderOfInterval = (doc: IntervalHolderFields): CustodyHolder =>
  (doc.holderKind ?? 'employee') === 'department'
    ? {
        kind: 'department',
        departmentId: idText(doc.departmentId),
        locationId: idText(doc.locationId),
        responsibleEmployeeId: idText(doc.responsibleEmployeeId),
      }
    : { kind: 'employee', employeeId: idText(doc.assignedToEmployeeId) };

/** A department as a request names it (`department` on a hand-over, `toDepartment` on a transfer). */
export const departmentHolderOf = (input: ItCustodianDepartmentInput): DepartmentHolder => ({
  kind: 'department',
  departmentId: idText(input.departmentId),
  locationId: idText(input.locationId),
  responsibleEmployeeId: idText(input.responsibleEmployeeId),
});

/**
 * The holder a hand-over names — exactly one of the two, which the contract already holds
 * (`refineOneHolder`); a caller that slipped past it is refused rather than guessed at.
 */
export const holderOfRequest = (input: {
  employeeId?: string | undefined;
  department?: ItCustodianDepartmentInput | undefined;
}): CustodyHolder => {
  if (input.department !== undefined && input.employeeId === undefined) {
    return departmentHolderOf(input.department);
  }
  if (input.employeeId !== undefined && input.department === undefined) {
    return { kind: 'employee', employeeId: idText(input.employeeId) };
  }
  throw new BusinessRuleError('a hand-over names an employee or a department — exactly one');
};

/**
 * Whether two holders are the same custody. A department is the same only with the same place
 * and the same signer: a move to another room, or the department signing again after its
 * responsible person left, is a new holder. A department is never the employee who signs for it.
 */
export const sameHolder = (a: CustodyHolder, b: CustodyHolder): boolean => {
  if (a.kind === 'employee' && b.kind === 'employee') return a.employeeId === b.employeeId;
  if (a.kind === 'department' && b.kind === 'department') {
    return (
      a.departmentId === b.departmentId &&
      a.locationId === b.locationId &&
      a.responsibleEmployeeId === b.responsibleEmployeeId
    );
  }
  return false;
};

/** Who signs the paper — the employee, or the department's responsible person. */
export const signerOf = (holder: CustodyHolder): string =>
  holder.kind === 'employee' ? holder.employeeId : holder.responsibleEmployeeId;

/** The employee holder's id, or null for a department — what «his own custody» reads. */
export const employeeHolderId = (holder: CustodyHolder): string | null =>
  holder.kind === 'employee' ? holder.employeeId : null;

/** The interval's holder fields for a new interval — the other kind's are null. */
export const intervalHolderFields = (
  holder: CustodyHolder,
): Required<IntervalHolderFields> =>
  holder.kind === 'employee'
    ? {
        holderKind: 'employee',
        assignedToEmployeeId: new Types.ObjectId(holder.employeeId),
        departmentId: null,
        locationId: null,
        responsibleEmployeeId: null,
      }
    : {
        holderKind: 'department',
        assignedToEmployeeId: null,
        departmentId: new Types.ObjectId(holder.departmentId),
        locationId: new Types.ObjectId(holder.locationId),
        responsibleEmployeeId: new Types.ObjectId(holder.responsibleEmployeeId),
      };

/** `employeeId` → `fromEmployeeId` / `toEmployeeId`. */
const prefixed = (prefix: '' | 'from' | 'to', key: string): string =>
  prefix === '' ? key : `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;

/**
 * The holder's keys on a history entry — only those that apply. An employee's are the keys every
 * reader already knows (`employeeId`; a transfer's `fromEmployeeId` / `toEmployeeId`, which
 * `movementOfEvent` and the history list read); a department's are its three ids, and on an
 * `assigned` / `returned` entry (no prefix) `holderKind: 'department'` too.
 */
export const holderHistory = (
  holder: CustodyHolder,
  prefix: '' | 'from' | 'to' = '',
): Record<string, string> => {
  if (holder.kind === 'employee') return { [prefixed(prefix, 'employeeId')]: holder.employeeId };
  return {
    ...(prefix === '' ? { holderKind: 'department' } : {}),
    [prefixed(prefix, 'departmentId')]: holder.departmentId,
    [prefixed(prefix, 'locationId')]: holder.locationId,
    [prefixed(prefix, 'responsibleEmployeeId')]: holder.responsibleEmployeeId,
  };
};

/** A holder as the audit trail names it: `holder` for an employee, the four keys for a department. */
const auditFields = (holder: CustodyHolder | null): Record<string, string> => {
  if (holder === null) return {};
  if (holder.kind === 'employee') return { holder: holder.employeeId };
  return {
    holderKind: 'department',
    departmentId: holder.departmentId,
    locationId: holder.locationId,
    responsibleEmployeeId: holder.responsibleEmployeeId,
  };
};

const AUDIT_ORDER = ['holder', 'holderKind', 'departmentId', 'locationId', 'responsibleEmployeeId'];

/**
 * The audit changes of a custody act's holder: from `before` (null — nobody, a hand-over) to
 * `after` (null — nobody, a return). Between two employees, the one `holder` change it always was
 * (a branch-only transfer included, which names the same holder twice); otherwise every key that
 * differs — a department's `holderKind`, `departmentId`, `locationId` and `responsibleEmployeeId`
 * in place of `holder`.
 */
export const holderAuditChanges = (
  before: CustodyHolder | null,
  after: CustodyHolder | null,
): AuditChange[] => {
  if (before?.kind === 'employee' && after?.kind === 'employee') {
    return [{ field: 'holder', old: before.employeeId, new: after.employeeId }];
  }
  const from = auditFields(before);
  const to = auditFields(after);
  return AUDIT_ORDER.flatMap((field) => {
    const old = from[field] ?? null;
    const next = to[field] ?? null;
    return old === next ? [] : [{ field, old, new: next }];
  });
};
