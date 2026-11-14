// The crew-department card's rules — one choice per COMPANY department.
//
// The owner, of the card that listed «نقل الاموال» seven times: «القائمة دي كانت معمولة لما كان في
// مشكلة في الإدارات، وأنت عامل تكرار إدارات … على حسب الفروع». So the units are grouped (the
// catalog entry, else the folded name), each choice says which branches have it, a saved id that no
// active unit answers to is still VISIBLE and removable (the bug this screen exists to fix was a
// configuration nobody could see), and the save never narrows what was saved without being asked.
import { describe, expect, it } from 'vitest';
import { type OrgUnitOptionDto } from '@ecms/contracts';
import {
  choiceMatches,
  crewDepartmentChoices,
  crewDepartmentPayload,
  sameChoices,
  savedChoiceKeys,
  toggleChoice,
  type CrewDepartmentChoice,
} from './crew-departments';

const unit = (
  id: string,
  code: string,
  ar: string,
  branch: string,
  catalogId: string | null = null,
  en = ar,
): OrgUnitOptionDto => ({ id, code, name: { ar, en }, parentId: branch, catalogId });

const BRANCHES = new Map([
  ['b-moh', { ar: 'المهندسين', en: 'Mohandessin' }],
  ['b-tan', { ar: 'طنطا', en: 'Tanta' }],
  ['b-alx', { ar: 'الإسكندرية', en: 'Alexandria' }],
]);

// The owner's screenshot, in miniature: one department, several branches, two spellings.
const CASH_MOH = unit('c1', 'DEP-0004', 'نقل الاموال', 'b-moh', 'cat-cash', 'Cash transfer');
const CASH_TAN = unit('c2', 'DEP-0005', 'نقل الاموال', 'b-tan', 'cat-cash', 'Cash transfer');
const CASH_ALX = unit('c3', 'DEP-0010', 'نقل الأموال', 'b-alx'); // never linked — joins by name
const OPS_MOH = unit('o1', 'DEP-0001', 'العمليات', 'b-moh');
const OPS_TAN = unit('o2', 'DEP-0011', 'العمليات', 'b-tan');
const CIT_OPS = unit('x1', 'OPS-1', 'عمليات نقل الأموال', 'b-moh');
const MOVE = unit('m1', 'CAI-3', 'الحركة', 'b-moh', 'cat-move', 'Movement');
const MOVE_CLOSED = unit('m2', 'CAI-9', 'الحركة', 'b-tan', 'cat-move', 'Movement'); // inactive

const ACTIVE = [CASH_MOH, CASH_TAN, CASH_ALX, OPS_MOH, OPS_TAN, CIT_OPS, MOVE];
const ALL = [...ACTIVE, MOVE_CLOSED];

const choicesFor = (storedIds: string[], over: Partial<Parameters<typeof crewDepartmentChoices>[0]> = {}) =>
  crewDepartmentChoices({
    active: ACTIVE,
    all: ALL,
    branchNames: BRANCHES,
    storedIds,
    locale: 'ar',
    ...over,
  });

const byLabel = (choices: CrewDepartmentChoice[], label: string): CrewDepartmentChoice => {
  const found = choices.find((choice) => choice.label === label);
  if (found === undefined) throw new Error(`no choice labelled ${label}`);
  return found;
};

describe('crewDepartmentChoices — one choice per company department', () => {
  it('offers each department once, however many branches have it', () => {
    const labels = choicesFor([]).map((choice) => choice.label);
    expect(labels).toHaveLength(4);
    expect(new Set(labels)).toEqual(
      new Set(['نقل الاموال', 'العمليات', 'عمليات نقل الأموال', 'الحركة']),
    );
  });

  it('groups by the catalog entry, and an unlinked copy of the same name joins it', () => {
    const cash = byLabel(choicesFor([]), 'نقل الاموال');
    expect(cash.key).toBe('catalog:cat-cash');
    expect(new Set(cash.activeIds)).toEqual(new Set(['c1', 'c2', 'c3']));
  });

  it('groups never-linked units by their folded name, and keeps a longer name apart', () => {
    const choices = choicesFor([]);
    expect(new Set(byLabel(choices, 'العمليات').activeIds)).toEqual(new Set(['o1', 'o2']));
    expect(byLabel(choices, 'عمليات نقل الأموال').activeIds).toEqual(['x1']);
  });

  it('says which branches have each department, by name, never by unit code', () => {
    const cash = byLabel(choicesFor([]), 'نقل الاموال');
    expect(cash.branches.map((branch) => branch.name).sort()).toEqual(
      ['الإسكندرية', 'المهندسين', 'طنطا'].sort(),
    );
    expect(JSON.stringify(cash)).not.toContain('DEP-0004');
  });

  it('counts only the branches where the department is active', () => {
    const move = byLabel(choicesFor([]), 'الحركة');
    expect(move.activeIds).toEqual(['m1']);
    expect(move.memberIds.sort()).toEqual(['m1', 'm2']);
    expect(move.branches.map((branch) => branch.id)).toEqual(['b-moh']);
  });

  it('labels in the reader’s locale', () => {
    const cash = choicesFor([], { locale: 'en' }).find((choice) => choice.key === 'catalog:cat-cash');
    expect(cash?.label).toBe('Cash transfer');
  });

  it('lists what is saved first, then the rest — each part in Arabic order', () => {
    const labels = choicesFor(['x1']).map((choice) => choice.label);
    expect(labels[0]).toBe('عمليات نقل الأموال');
    const rest = labels.slice(1) as string[];
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'ar')));
  });

  it('shows a saved department whose every copy is deactivated, marked inactive', () => {
    const choices = choicesFor(['m2'], { active: ACTIVE.filter((u) => u !== MOVE) });
    const move = byLabel(choices, 'الحركة');
    expect(move.state).toBe('inactive');
    expect(move.activeIds).toEqual([]);
    // Saved: still ticked, because it IS in the setting.
    expect(savedChoiceKeys(choices, ['m2'])).toEqual([move.key]);
  });

  it('does not offer a department nobody has any more unless the setting names it', () => {
    const choices = choicesFor([], { active: ACTIVE.filter((u) => u !== MOVE) });
    expect(choices.some((choice) => choice.label === 'الحركة')).toBe(false);
  });

  it('gives an id nothing answers to a choice of its own, saved, last among the saved', () => {
    const choices = choicesFor(['gone', 'c1']);
    const stale = choices.find((choice) => choice.state === 'unknown');
    expect(stale?.key).toBe('unknown:gone');
    expect(stale?.label).toBeNull();
    expect(stale?.memberIds).toEqual(['gone']);
    expect(choices.slice(0, 2).map((choice) => choice.key)).toEqual(['catalog:cat-cash', 'unknown:gone']);
    expect(savedChoiceKeys(choices, ['gone', 'c1']).sort()).toEqual(['catalog:cat-cash', 'unknown:gone']);
  });

  it('falls back to the active list when the inactive one could not be read', () => {
    const choices = choicesFor(['m2'], { all: undefined });
    // Less precise — the deactivated copy cannot be named — but never hidden.
    expect(choices.find((choice) => choice.memberIds.includes('m2'))?.state).toBe('unknown');
  });

  it('is empty when there is nothing to offer and nothing saved', () => {
    expect(choicesFor([], { active: [], all: [] })).toEqual([]);
  });
});

describe('savedChoiceKeys', () => {
  it('ticks a department when ANY branch copy of it is saved', () => {
    const choices = choicesFor(['c2']);
    expect(savedChoiceKeys(choices, ['c2'])).toEqual(['catalog:cat-cash']);
  });

  it('ticks nothing for nothing', () => {
    expect(savedChoiceKeys(choicesFor([]), [])).toEqual([]);
  });
});

describe('crewDepartmentPayload — what «حفظ» writes', () => {
  it('writes every active branch copy of each ticked department', () => {
    const choices = choicesFor([]);
    const ops = byLabel(choices, 'العمليات');
    expect(new Set(crewDepartmentPayload(choices, [ops.key], []))).toEqual(new Set(['o1', 'o2']));
  });

  it('keeps an id already saved for a ticked department, even a deactivated copy', () => {
    const choices = choicesFor(['m2']);
    const move = byLabel(choices, 'الحركة');
    expect(crewDepartmentPayload(choices, [move.key], ['m2'])).toEqual(['m2', 'm1']);
  });

  it('drops every copy of an unticked department, the deactivated ones included', () => {
    const stored = ['m2', 'c1'];
    const choices = choicesFor(stored);
    const cash = byLabel(choices, 'نقل الاموال');
    const payload = crewDepartmentPayload(choices, [cash.key], stored);
    expect(payload).not.toContain('m2');
    expect(payload).not.toContain('m1');
    expect(new Set(payload)).toEqual(new Set(['c1', 'c2', 'c3']));
  });

  it('keeps an unknown id while it is ticked, and drops it once unticked', () => {
    const stored = ['gone', 'c1'];
    const choices = choicesFor(stored);
    expect(crewDepartmentPayload(choices, ['unknown:gone', 'catalog:cat-cash'], stored)).toContain('gone');
    expect(crewDepartmentPayload(choices, ['catalog:cat-cash'], stored)).not.toContain('gone');
  });

  it('writes nothing when nothing is ticked, and each id once', () => {
    const choices = choicesFor(['c1']);
    expect(crewDepartmentPayload(choices, [], ['c1'])).toEqual([]);
    const payload = crewDepartmentPayload(choices, ['catalog:cat-cash', 'catalog:cat-cash'], ['c1', 'C1']);
    expect(payload.filter((id) => id.toLowerCase() === 'c1')).toHaveLength(1);
  });
});

describe('toggleChoice and sameChoices', () => {
  it('adds at the end and removes in place, without touching the input', () => {
    const before = ['a'];
    expect(toggleChoice(before, 'b')).toEqual(['a', 'b']);
    expect(toggleChoice(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(before).toEqual(['a']);
  });

  it('compares sets: order does not matter, an addition, a removal and a swap do', () => {
    expect(sameChoices(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameChoices([], [])).toBe(true);
    expect(sameChoices(['a'], ['a', 'b'])).toBe(false);
    expect(sameChoices(['a', 'b'], ['a'])).toBe(false);
    expect(sameChoices(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('choiceMatches — the search box', () => {
  const cash = byLabel(choicesFor([]), 'نقل الاموال');

  it('finds a department by its name, folded — «الأموال» finds «الاموال»', () => {
    expect(choiceMatches(cash, 'الأموال')).toBe(true);
    expect(choiceMatches(cash, 'نقل')).toBe(true);
  });

  it('finds it by a branch that has it', () => {
    expect(choiceMatches(cash, 'طنطا')).toBe(true);
  });

  it('does not find it by something it does not carry, and an empty search finds all', () => {
    expect(choiceMatches(cash, 'الحركة')).toBe(false);
    expect(choiceMatches(cash, '   ')).toBe(true);
  });
});
