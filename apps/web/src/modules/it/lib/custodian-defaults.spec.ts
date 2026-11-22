// The department a hand-over to a department starts from — the IT department, chosen already
// (2026-11-19, the owner's answer 1): the IT row of the place's branch, else the first configured
// one that is still an active department, else none.
import { describe, expect, it } from 'vitest';
import { ItSettingKeys, type OrgUnitOptionDto } from '@ecms/contracts';
import {
  configuredDepartmentIds,
  custodianFollowUp,
  defaultCustodianDepartment,
  departmentChoices,
  preselectDepartment,
} from './custodian-defaults';

const department = (id: string, name: string, parentId: string | null): OrgUnitOptionDto =>
  ({ id, code: id, name: { ar: name, en: name }, parentId, catalogId: null }) as OrgUnitOptionDto;

const OPTIONS = [
  department('d-it-hq', 'تقنية المعلومات', 'b-hq'),
  department('d-it-asyut', 'تقنية المعلومات', 'b-asyut'),
  department('d-ops-asyut', 'الحركة', 'b-asyut'),
];
const BRANCHES = new Map([
  ['b-hq', 'المهندسين'],
  ['b-asyut', 'أسيوط'],
]);

describe('the IT department, chosen already', () => {
  const configured = ['d-it-hq', 'd-it-asyut'];

  it('is the IT row of the place’s branch', () => {
    expect(defaultCustodianDepartment(configured, OPTIONS, 'b-asyut')).toBe('d-it-asyut');
    expect(defaultCustodianDepartment(configured, OPTIONS, 'b-hq')).toBe('d-it-hq');
  });

  it('else the first configured one that is an active department', () => {
    // No branch known yet, or a branch with no IT row of its own.
    expect(defaultCustodianDepartment(configured, OPTIONS, '')).toBe('d-it-hq');
    expect(defaultCustodianDepartment(configured, OPTIONS, 'b-oct')).toBe('d-it-hq');
    // A configured id no longer among the active departments is skipped.
    expect(defaultCustodianDepartment(['d-gone', 'd-it-asyut'], OPTIONS, 'b-oct')).toBe(
      'd-it-asyut',
    );
  });

  it('else none — nothing configured, or nothing active', () => {
    expect(defaultCustodianDepartment([], OPTIONS, 'b-asyut')).toBe('');
    expect(defaultCustodianDepartment(['d-gone'], OPTIONS, 'b-asyut')).toBe('');
    expect(defaultCustodianDepartment(configured, [], 'b-asyut')).toBe('');
  });
});

describe('the setting’s value', () => {
  it('is the help desk’s IT departments, defended against a shape it should never have', () => {
    const row = (value: unknown) => [{ key: ItSettingKeys.TechnicianDepartmentIds, value }];
    expect(configuredDepartmentIds(row(['d-1', 7, 'd-2']))).toEqual(['d-1', 'd-2']);
    expect(configuredDepartmentIds(row('d-1'))).toEqual([]);
    expect(configuredDepartmentIds([{ key: 'other', value: ['d-1'] }])).toEqual([]);
    expect(configuredDepartmentIds(undefined)).toEqual([]);
  });
});

describe('the departments offered', () => {
  it('are every active department, named with its branch, the place’s branch first', () => {
    expect(departmentChoices(OPTIONS, BRANCHES, 'b-asyut', 'ar')).toEqual([
      { id: 'd-ops-asyut', label: 'الحركة — أسيوط', inBranch: true },
      { id: 'd-it-asyut', label: 'تقنية المعلومات — أسيوط', inBranch: true },
      { id: 'd-it-hq', label: 'تقنية المعلومات — المهندسين', inBranch: false },
    ]);
  });

  it('name a department whose branch cannot be named by its name alone', () => {
    const [only] = departmentChoices(
      [department('d-x', 'الخزينة', 'b-closed')],
      BRANCHES,
      '',
      'ar',
    );
    expect(only).toEqual({ id: 'd-x', label: 'الخزينة', inBranch: false });
  });
});

describe('the preselection follows the branch — and never overrides a choice', () => {
  const set = (over: Partial<Parameters<typeof preselectDepartment>[0]>) =>
    preselectDepartment({
      picked: false,
      preselect: 'd-it-asyut',
      current: '',
      lastAuto: '',
      ...over,
    });

  it('fills an empty field, and follows the branch while the field holds what it set', () => {
    expect(set({})).toBe('d-it-asyut');
    expect(set({ preselect: 'd-it-hq', current: 'd-it-asyut', lastAuto: 'd-it-asyut' })).toBe(
      'd-it-hq',
    );
    expect(set({ current: 'd-it-asyut', lastAuto: 'd-it-asyut' })).toBeNull();
  });

  it('leaves a department picked by hand, or filled from a device a department holds', () => {
    expect(set({ picked: true })).toBeNull();
    // A device the operations department holds, picked on a memo's line, filled it.
    expect(set({ current: 'd-ops-asyut', lastAuto: '' })).toBeNull();
    expect(set({ current: 'd-ops-asyut', lastAuto: 'd-it-asyut' })).toBeNull();
  });

  it('waits while there is nothing to preselect', () => {
    expect(set({ preselect: '' })).toBeNull();
  });
});

describe('the fields’ own rules, as ONE next value', () => {
  const value = {
    departmentId: 'd-it-hq',
    locationId: 'l-hq',
    responsibleEmployeeId: 'e-sherif',
    responsibleLabel: 'شريف ممدوح فاروق (0100077)',
  };
  const follow = (over: Partial<Parameters<typeof custodianFollowUp<typeof value>>[0]>) =>
    custodianFollowUp({
      value,
      picked: false,
      preselect: 'd-it-hq',
      lastAuto: 'd-it-hq',
      branchId: 'b-hq',
      offeredPlaceIds: ['l-hq'],
      ...over,
    });

  /** What the effect does with it: one `onChange` per answer, until the rules have nothing left. */
  const settle = (start: Parameters<typeof follow>[0]) => {
    const calls: (typeof value)[] = [];
    let state = { value: start.value ?? value, lastAuto: start.lastAuto ?? 'd-it-hq' };
    for (let turn = 0; turn < 5; turn += 1) {
      const answer = follow({ ...start, value: state.value, lastAuto: state.lastAuto });
      if (answer === null) break;
      calls.push(answer.next);
      state = { value: answer.next, lastAuto: answer.auto ?? state.lastAuto };
    }
    return calls;
  };

  it('a branch changed with a place chosen: the new branch’s IT row and the place let go, in one call', () => {
    const moved = { preselect: 'd-it-asyut', branchId: 'b-asyut', offeredPlaceIds: ['l-servers'] };
    expect(follow(moved)).toEqual({
      next: { ...value, departmentId: 'd-it-asyut', locationId: '' },
      auto: 'd-it-asyut',
    });
    // And then it is settled: the IT row stays, nothing rolls back.
    expect(settle(moved)).toEqual([{ ...value, departmentId: 'd-it-asyut', locationId: '' }]);
  });

  it('either rule alone changes only its own field', () => {
    // The place's branch has places of its own, and the IT row follows it.
    expect(follow({ preselect: 'd-it-asyut', offeredPlaceIds: ['l-hq'] })?.next).toEqual({
      ...value,
      departmentId: 'd-it-asyut',
    });
    // A department picked by hand stays; a place the branch does not offer still goes.
    expect(follow({ picked: true, preselect: 'd-it-asyut', offeredPlaceIds: [] })).toEqual({
      next: { ...value, locationId: '' },
      auto: null,
    });
  });

  it('leaves a settled value alone', () => {
    expect(follow({})).toBeNull();
  });

  it('never lets a place go while the branch is unknown, or while the places are on their way', () => {
    // A memo with no item chosen yet: the department and the place a held device filled stay.
    const filled = { ...value, departmentId: 'd-ops-asyut', locationId: 'l-servers' };
    expect(follow({ value: filled, lastAuto: '', branchId: '', offeredPlaceIds: [] })).toBeNull();
    expect(follow({ offeredPlaceIds: undefined })).toBeNull();
    // Once the branch is known and does not offer it, it goes.
    expect(
      follow({ value: filled, lastAuto: '', branchId: 'b-hq', offeredPlaceIds: ['l-hq'] })?.next,
    ).toEqual({ ...filled, locationId: '' });
  });
});
