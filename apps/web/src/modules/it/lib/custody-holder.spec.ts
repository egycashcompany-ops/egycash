// «في عهدة إدارة … — …» (2026-11-19): who holds an asset, named the one way every IT screen, file
// and paper names it — an employee by name, a department with its place, and never the signer in
// the holder's place.
import { describe, expect, it } from 'vitest';
import { type ItAssetAssignmentDto, type ItConsumableMovementDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  IT_DEPARTMENT,
  NO_DEPARTMENT,
  departmentHolder,
  employeeHolder,
} from '../custody-holder-fixtures';
import {
  bareDepartmentName,
  holderCode,
  holderLink,
  holderMain,
  holderName,
  holderOfAsset,
  holderOfAssignment,
  holderOfMovement,
  isDepartmentHolder,
  personWithCode,
  responsibleText,
} from './custody-holder';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const WALEED = employeeHolder({
  employeeId: 'e-waleed',
  employeeCode: '0100052',
  employeeName: 'وليد صفوت جلال',
});

describe('an employee holder', () => {
  const facts = holderOfAsset(WALEED);

  it('is named by the person, else the code, else the id — never a guess', () => {
    expect(holderName(facts, 'ar', t)).toBe('وليد صفوت جلال');
    expect(holderName({ ...facts, employeeName: null }, 'ar', t)).toBe('0100052');
    expect(holderName({ ...facts, employeeName: null, employeeCode: null }, 'ar', t)).toBe(
      'e-waleed',
    );
    expect(holderMain(facts, 'ar', t)).toBe('وليد صفوت جلال');
  });

  it('links to the person’s page, and its code is theirs', () => {
    expect(holderLink(facts)).toBe('/it/employees/e-waleed');
    expect(holderCode(facts)).toBe('0100052');
    expect(responsibleText(facts)).toBe('');
    expect(isDepartmentHolder(facts)).toBe(false);
  });

  it('reads a holder from before department custody — no kind — as an employee', () => {
    const old = { ...WALEED } as Partial<typeof WALEED>;
    delete old.kind;
    expect(holderOfAsset(old as typeof WALEED).kind).toBe('employee');
  });
});

describe('a department holder', () => {
  const facts = holderOfAsset(departmentHolder());

  it('is «إدارة …» with its place — the department, not the person who signed', () => {
    expect(holderName(facts, 'ar', t)).toBe('إدارة تقنية المعلومات — غرفة السيرفرات');
    expect(holderMain(facts, 'ar', t)).toBe('إدارة تقنية المعلومات');
    expect(holderName(facts, 'ar', t)).not.toContain('شريف');
    expect(isDepartmentHolder(facts)).toBe(true);
  });

  it('links to everything held at its place, and carries no employee code', () => {
    expect(holderLink(facts)).toBe('/it/assets?location=l-servers');
    expect(holderCode(facts)).toBeNull();
  });

  it('says who signed for it, with the code beside the name', () => {
    expect(responsibleText(facts)).toBe('شريف ممدوح فاروق (0100077)');
    expect(responsibleText({ ...facts, responsibleEmployeeName: null })).toBe('0100077');
  });

  it('falls back to the ids when the names could not be read', () => {
    const unnamed = { ...facts, departmentName: null, locationName: null };
    expect(holderName(unnamed, 'ar', t)).toBe('إدارة d-it — l-servers');
  });

  it('is written in the reader’s language', () => {
    const en = (key: string, params?: Record<string, string | number>): string =>
      translate('en', key, params);
    expect(holderName(facts, 'en', en)).toBe('Information Technology department — Server room');
  });
});

describe('«إدارة» is written once', () => {
  it('takes a leading «إدارة» off HR’s name, and nothing else', () => {
    expect(bareDepartmentName('إدارة الخزينة')).toBe('الخزينة');
    expect(bareDepartmentName('  إدارة   الخزينة ')).toBe('الخزينة');
    expect(bareDepartmentName('الإدارة المالية')).toBe('الإدارة المالية');
    expect(bareDepartmentName('تقنية المعلومات')).toBe('تقنية المعلومات');
    // A name that is only the word is kept as it is.
    expect(bareDepartmentName('إدارة')).toBe('إدارة');
  });

  it('so a department named «إدارة …» reads «إدارة …», not «إدارة إدارة …»', () => {
    const named = holderOfAsset(
      departmentHolder({ departmentName: { ar: 'إدارة الخزينة', en: 'Treasury' } }),
    );
    expect(holderMain(named, 'ar', t)).toBe('إدارة الخزينة');
  });
});

describe('the rows that name a holder', () => {
  const base = { holderKind: 'employee', ...NO_DEPARTMENT } as const;

  it('an interval: the employee, or the department at its place', () => {
    const own = holderOfAssignment({
      ...base,
      assignedToEmployeeId: 'e-waleed',
      assignedToEmployeeCode: '0100052',
      assignedToEmployeeName: 'وليد صفوت جلال',
    } as ItAssetAssignmentDto);
    expect(own).toMatchObject({ kind: 'employee', employeeId: 'e-waleed' });
    const department = holderOfAssignment({
      ...base,
      holderKind: 'department',
      assignedToEmployeeId: null,
      assignedToEmployeeCode: null,
      assignedToEmployeeName: null,
      ...IT_DEPARTMENT,
    } as ItAssetAssignmentDto);
    expect(department).toMatchObject({
      kind: 'department',
      employeeId: null,
      departmentId: 'd-it',
      locationId: 'l-servers',
      responsibleEmployeeId: 'e-sherif',
    });
  });

  it('a ledger row: the person it went to, a department, or nobody', () => {
    const row = (over: Partial<ItConsumableMovementDto>) =>
      ({
        employeeId: null,
        employeeCode: null,
        employeeName: null,
        ...NO_DEPARTMENT,
        ...over,
      }) as ItConsumableMovementDto;
    expect(holderOfMovement(row({}))).toBeNull();
    expect(holderOfMovement(row({ employeeId: 'e-waleed' }))?.kind).toBe('employee');
    expect(holderOfMovement(row({ ...IT_DEPARTMENT }))).toMatchObject({
      kind: 'department',
      departmentId: 'd-it',
      responsibleEmployeeName: 'شريف ممدوح فاروق',
    });
  });

  it('a person with the code beside the name, or what there is', () => {
    expect(personWithCode('وليد صفوت جلال', '0100052', 'e-1')).toBe('وليد صفوت جلال (0100052)');
    expect(personWithCode('وليد صفوت جلال', null, 'e-1')).toBe('وليد صفوت جلال');
    expect(personWithCode(null, null, 'e-1')).toBe('e-1');
    expect(personWithCode(null, null, null)).toBe('');
  });
});
