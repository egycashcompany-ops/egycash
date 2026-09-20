// The chain arithmetic, checked directly.
//
// Every rule here decides where a request goes, and every way it can be wrong is silent: the
// request routes to the wrong desk, or to no desk, and nothing raises. So each one is pinned with
// the sentence it came from.
import { describe, expect, it } from 'vitest';
import {
  levelSatisfied,
  liveStep,
  resolveChain,
  selectChain,
  skippedBefore,
  type ChainStep,
  type ResolvedStep,
} from './approval-chain';

const FLEET = 'dept-fleet';
const SECURITY = 'dept-security';
const MOH = 'branch-moh';
const OCT = 'branch-oct';

const chain = (departmentCatalogId: string | null, branchId: string | null, value: string) => ({
  departmentCatalogId,
  branchId,
  value,
});

describe('which chain applies', () => {
  const rows = [
    chain(null, null, 'company default'),
    chain(FLEET, null, 'fleet everywhere'),
    chain(null, MOH, 'everything in Mohandessin'),
    chain(FLEET, MOH, 'fleet in Mohandessin'),
  ];

  it('takes the most specific match — department AND branch beats either alone', () => {
    expect(selectChain(rows, { departmentCatalogId: FLEET, branchId: MOH })?.value).toBe(
      'fleet in Mohandessin',
    );
  });

  it('prefers the department over the branch when only one of them names the request', () => {
    // «الحركة في أكتوبر»: no row names that pair, so the department row wins over the branch row.
    expect(selectChain(rows, { departmentCatalogId: FLEET, branchId: OCT })?.value).toBe(
      'fleet everywhere',
    );
  });

  it('falls back to the branch row for a department nothing was written for', () => {
    expect(selectChain(rows, { departmentCatalogId: SECURITY, branchId: MOH })?.value).toBe(
      'everything in Mohandessin',
    );
  });

  it('falls back to the company default when nothing else names the request', () => {
    expect(selectChain(rows, { departmentCatalogId: SECURITY, branchId: OCT })?.value).toBe(
      'company default',
    );
  });

  it('never answers with a row that names a place the request is not in', () => {
    // «الحركة في المهندسين» must not answer a request from «الأمن», even with nothing else written.
    expect(selectChain([chain(FLEET, MOH, 'fleet in Mohandessin')], {
      departmentCatalogId: SECURITY,
      branchId: MOH,
    })).toBeNull();
  });

  it('answers a request with no placement at all only from the company default', () => {
    expect(selectChain(rows, { departmentCatalogId: null, branchId: null })?.value).toBe(
      'company default',
    );
  });
});

const step = (permissionKey: string, level: ChainStep['level']): ChainStep => ({
  permissionKey,
  level,
  label: null,
});

const STEPS: ChainStep[] = [
  step('leave.approve', 'unit'), // مدير حركة الفرع
  step('leave.approve', 'department'), // مدير عام الحركة
  step('leave.approve', 'organization'), // الموارد البشرية
];

const resolved = (staffed: readonly boolean[]): ResolvedStep[] =>
  resolveChain(STEPS, (s) => staffed[STEPS.indexOf(s)] === true);

describe('which rung is waiting', () => {
  it('is the first staffed rung nobody has decided yet', () => {
    expect(liveStep(resolved([true, true, true]), 0)?.index).toBe(0);
    expect(liveStep(resolved([true, true, true]), 1)?.index).toBe(1);
  });

  it('steps over a rung nobody in the company can stand on', () => {
    // «لو مفيش Branch Manager، يتخطى المستوى ده ويروح للـGeneral Department Manager».
    expect(liveStep(resolved([false, true, true]), 0)?.index).toBe(1);
    expect(liveStep(resolved([false, false, true]), 0)?.index).toBe(2);
  });

  it('reports the rungs it stepped over, because the trail has to show them', () => {
    expect(skippedBefore(resolved([false, false, true]), 0)).toEqual([0, 1]);
    expect(skippedBefore(resolved([true, true, true]), 0)).toEqual([]);
  });

  it('is nothing once every rung is decided', () => {
    expect(liveStep(resolved([true, true, true]), 3)).toBeNull();
  });

  it('is nothing when no rung is staffed at all — which the caller must decide what to do about', () => {
    expect(liveStep(resolved([false, false, false]), 0)).toBeNull();
    expect(skippedBefore(resolved([false, false, false]), 0)).toEqual([0, 1, 2]);
  });

  it('carries the rung itself, so the caller never re-indexes to find out what it asked for', () => {
    const live = liveStep(resolved([false, true, true]), 0);
    expect(live?.step.level).toBe('department');
    expect(live?.step.permissionKey).toBe('leave.approve');
  });
});

describe('what satisfies a rung', () => {
  it('is that level and no other, in either direction', () => {
    expect(levelSatisfied('unit', 'unit')).toBe(true);
    // Company-wide HR does not silently absorb the branch manager's rung…
    expect(levelSatisfied('unit', 'organization')).toBe(false);
    // …and the branch manager does not satisfy a rung asking for the general manager above him.
    expect(levelSatisfied('department', 'unit')).toBe(false);
    expect(levelSatisfied('organization', 'branch')).toBe(false);
  });
});
