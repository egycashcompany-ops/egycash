// Who holds an asset — an employee, or a department at a place signed for by its responsible
// person («في عهدة إدارة … — الموقع …», 2026-11-19). Pure, so every rule is asserted on its answer.
//
// What is pinned: an interval from before department custody reads as an employee's; a department
// is never the employee who signs for it; changing the department, the place or the signer is a
// new holder; and the history, audit and interval keys say exactly the holder — never the text
// "null" where a department has no employee.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '../../../shared/errors';
import {
  departmentHolderOf,
  employeeHolderId,
  holderAuditChanges,
  holderHistory,
  holderOfInterval,
  holderOfRequest,
  intervalHolderFields,
  sameHolder,
  signerOf,
  type CustodyHolder,
} from './custody-holder';

const id = (): string => String(new Types.ObjectId());

const EMPLOYEE = id();
const OTHER = id();
const IT = id();
const SERVER_ROOM = id();
const CAMERA_ROOM = id();
const SIGNER = id();

const employee = (employeeId = EMPLOYEE): CustodyHolder => ({ kind: 'employee', employeeId });
const department = (
  over: Partial<Extract<CustodyHolder, { kind: 'department' }>> = {},
): CustodyHolder => ({
  kind: 'department',
  departmentId: IT,
  locationId: SERVER_ROOM,
  responsibleEmployeeId: SIGNER,
  ...over,
});

describe('the holder of a stored interval', () => {
  it('is the employee of an interval from before department custody — no `holderKind` at all', () => {
    expect(
      holderOfInterval({ assignedToEmployeeId: new Types.ObjectId(EMPLOYEE) } as never),
    ).toEqual(employee());
    expect(
      holderOfInterval({
        holderKind: 'employee',
        assignedToEmployeeId: new Types.ObjectId(EMPLOYEE),
      }),
    ).toEqual(employee());
  });

  it('is the department, the place and the signer of a department interval', () => {
    expect(
      holderOfInterval({
        holderKind: 'department',
        assignedToEmployeeId: null,
        departmentId: new Types.ObjectId(IT),
        locationId: new Types.ObjectId(SERVER_ROOM),
        responsibleEmployeeId: new Types.ObjectId(SIGNER),
      }),
    ).toEqual(department());
  });
});

describe('the holder a request names', () => {
  it('is the employee, or the department — exactly one', () => {
    expect(holderOfRequest({ employeeId: EMPLOYEE })).toEqual(employee());
    expect(
      holderOfRequest({
        department: { departmentId: IT, locationId: SERVER_ROOM, responsibleEmployeeId: SIGNER },
      }),
    ).toEqual(department());
    expect(() => holderOfRequest({})).toThrow(BusinessRuleError);
    expect(() =>
      holderOfRequest({
        employeeId: EMPLOYEE,
        department: { departmentId: IT, locationId: SERVER_ROOM, responsibleEmployeeId: SIGNER },
      }),
    ).toThrow(BusinessRuleError);
  });

  it('spells every id as the database does — `objectId()` admits upper-case hex', () => {
    expect(holderOfRequest({ employeeId: EMPLOYEE.toUpperCase() })).toEqual(employee());
    expect(
      departmentHolderOf({
        departmentId: IT.toUpperCase(),
        locationId: SERVER_ROOM.toUpperCase(),
        responsibleEmployeeId: SIGNER.toUpperCase(),
      }),
    ).toEqual(department());
  });
});

describe('whether two holders are the same custody', () => {
  it('compares employees by id', () => {
    expect(sameHolder(employee(), employee())).toBe(true);
    expect(sameHolder(employee(), employee(OTHER))).toBe(false);
  });

  it('is a NEW holder when the department, the place or the signer changes', () => {
    expect(sameHolder(department(), department())).toBe(true);
    expect(sameHolder(department(), department({ locationId: CAMERA_ROOM }))).toBe(false);
    expect(sameHolder(department(), department({ departmentId: id() }))).toBe(false);
    // Signing again after the responsible person left is a new holder too.
    expect(sameHolder(department(), department({ responsibleEmployeeId: OTHER }))).toBe(false);
  });

  it('never takes a department for the employee who signs for it', () => {
    const signedBy = department({ responsibleEmployeeId: EMPLOYEE });
    expect(sameHolder(signedBy, employee())).toBe(false);
    expect(sameHolder(employee(), signedBy)).toBe(false);
  });
});

describe('the signer, and the employee holder', () => {
  it('signs as the employee, or as the department’s responsible person', () => {
    expect(signerOf(employee())).toBe(EMPLOYEE);
    expect(signerOf(department())).toBe(SIGNER);
  });

  it('is nobody’s personal custody for a department', () => {
    expect(employeeHolderId(employee())).toBe(EMPLOYEE);
    expect(employeeHolderId(department())).toBeNull();
  });
});

describe('a new interval’s holder fields', () => {
  it('names the employee, the other kind’s fields null', () => {
    const fields = intervalHolderFields(employee());
    expect(fields).toMatchObject({
      holderKind: 'employee',
      departmentId: null,
      locationId: null,
      responsibleEmployeeId: null,
    });
    expect(String(fields.assignedToEmployeeId)).toBe(EMPLOYEE);
  });

  it('names the department, the place and the signer — no employee holder', () => {
    const fields = intervalHolderFields(department());
    expect(fields.holderKind).toBe('department');
    expect(fields.assignedToEmployeeId).toBeNull();
    expect(
      [fields.departmentId, fields.locationId, fields.responsibleEmployeeId].map(String),
    ).toEqual([IT, SERVER_ROOM, SIGNER]);
  });
});

describe('the holder on a history entry', () => {
  it('keeps the employee keys every reader knows', () => {
    expect(holderHistory(employee())).toEqual({ employeeId: EMPLOYEE });
    expect(holderHistory(employee(), 'from')).toEqual({ fromEmployeeId: EMPLOYEE });
    expect(holderHistory(employee(), 'to')).toEqual({ toEmployeeId: EMPLOYEE });
  });

  it('names a department’s three ids — and its kind on an assigned or returned entry', () => {
    expect(holderHistory(department())).toEqual({
      holderKind: 'department',
      departmentId: IT,
      locationId: SERVER_ROOM,
      responsibleEmployeeId: SIGNER,
    });
    expect(holderHistory(department(), 'to')).toEqual({
      toDepartmentId: IT,
      toLocationId: SERVER_ROOM,
      toResponsibleEmployeeId: SIGNER,
    });
    expect(holderHistory(department(), 'from')).toEqual({
      fromDepartmentId: IT,
      fromLocationId: SERVER_ROOM,
      fromResponsibleEmployeeId: SIGNER,
    });
  });
});

describe('the holder in the audit trail', () => {
  it('is the one `holder` change between employees — a same-hands branch move included', () => {
    expect(holderAuditChanges(null, employee())).toEqual([
      { field: 'holder', old: null, new: EMPLOYEE },
    ]);
    expect(holderAuditChanges(employee(), null)).toEqual([
      { field: 'holder', old: EMPLOYEE, new: null },
    ]);
    expect(holderAuditChanges(employee(), employee(OTHER))).toEqual([
      { field: 'holder', old: EMPLOYEE, new: OTHER },
    ]);
    expect(holderAuditChanges(employee(), employee())).toEqual([
      { field: 'holder', old: EMPLOYEE, new: EMPLOYEE },
    ]);
  });

  it('names a department’s kind, department, place and signer in place of `holder`', () => {
    expect(holderAuditChanges(null, department())).toEqual([
      { field: 'holderKind', old: null, new: 'department' },
      { field: 'departmentId', old: null, new: IT },
      { field: 'locationId', old: null, new: SERVER_ROOM },
      { field: 'responsibleEmployeeId', old: null, new: SIGNER },
    ]);
    expect(holderAuditChanges(department(), null)).toEqual([
      { field: 'holderKind', old: 'department', new: null },
      { field: 'departmentId', old: IT, new: null },
      { field: 'locationId', old: SERVER_ROOM, new: null },
      { field: 'responsibleEmployeeId', old: SIGNER, new: null },
    ]);
  });

  it('says only what changed between two departments, and both sides between the kinds', () => {
    expect(holderAuditChanges(department(), department({ locationId: CAMERA_ROOM }))).toEqual([
      { field: 'locationId', old: SERVER_ROOM, new: CAMERA_ROOM },
    ]);
    expect(holderAuditChanges(department(), employee())).toEqual([
      { field: 'holder', old: null, new: EMPLOYEE },
      { field: 'holderKind', old: 'department', new: null },
      { field: 'departmentId', old: IT, new: null },
      { field: 'locationId', old: SERVER_ROOM, new: null },
      { field: 'responsibleEmployeeId', old: SIGNER, new: null },
    ]);
  });
});
