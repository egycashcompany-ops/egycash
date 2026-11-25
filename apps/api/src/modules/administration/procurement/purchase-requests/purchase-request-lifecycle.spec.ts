// The purchase request's state machine, tested as the pure table it is (design §5.16 specs 1–7;
// P2 plan §7, §12.1) — no database, no request, no clock. The whole table ships in P2.2, so every
// later slice reads one table, and an edit that quietly opens a path (un-rejecting a request,
// cancelling a closed one) fails here rather than in an audit.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMINISTRATION_PURCHASE_REQUEST_ACTIONS,
  ADMINISTRATION_PURCHASE_REQUEST_STATUSES,
  ErrorCodes,
  type AdministrationPurchaseRequestStatus,
} from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { type AppError } from '../../../../shared/errors';
import { findTransition, reachableFrom, transitionsFrom } from '../../shared/lifecycle';
import {
  PURCHASE_REQUEST_ACTS,
  PURCHASE_REQUEST_ACT_KEYS,
  PURCHASE_REQUEST_TRANSITIONS as TABLE,
  cancelProblem,
  closeCondition,
  decisionTransition,
  openQty,
  orderStatusOf,
  reasonRequired,
  submitProblem,
} from './purchase-request-lifecycle';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATUSES = ADMINISTRATION_PURCHASE_REQUEST_STATUSES;
const TERMINAL: AdministrationPurchaseRequestStatus[] = ['rejected', 'cancelled', 'closed'];

/**
 * The keys the manifest declares for the request, read from its source — the feature may not
 * import the manifest (`administration-isolation.spec.ts`).
 */
const declaredKeys = (): string[] => {
  const manifest = readFileSync(join(HERE, '../../administration.module.ts'), 'utf8');
  const call =
    /declarePermissions\(\s*'administration',\s*'administrationPurchaseRequest',[\s\S]*?\n\);/.exec(
      manifest,
    )?.[0];
  expect(call, 'the manifest declares the request’s keys').toBeDefined();
  const actions = /\[([^\]]*)\]/.exec(call ?? '')?.[1] ?? '';
  const specials = [...(call ?? '').matchAll(/action:\s*'([a-zA-Z]+)'/g)].map((m) => m[1] ?? '');
  return [...[...actions.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1] ?? ''), ...specials].map(
    (action) => `administrationPurchaseRequest.${action}`,
  );
};

/**
 * Keys the table names before the slice that declares them (P2 plan §7): `.cancel` arrives with
 * its act in P2.5, which empties this list and removes it.
 */
const NOT_YET_DECLARED = ['administrationPurchaseRequest.cancel'];

describe('the table (design §5.4)', () => {
  it('holds design §5.4’s nine rows, in its order', () => {
    expect(TABLE.map((row) => `${row.from ?? '—'} → ${row.to} · ${row.action}`)).toEqual([
      '— → draft · create',
      'draft → pendingApproval · submit',
      'pendingApproval → approved · decide',
      'pendingApproval → rejected · decide',
      'pendingApproval → draft · return',
      'draft → cancelled · cancel',
      'pendingApproval → cancelled · cancel',
      'approved → cancelled · cancel',
      'approved → closed · close',
    ]);
  });

  it('spec 1: every contract status is in the table and reachable from the start', () => {
    const named = new Set(
      TABLE.flatMap((row) => (row.from === null ? [row.to] : [row.from, row.to])),
    );
    expect([...named].sort()).toEqual([...STATUSES].sort());
    const start = TABLE.find((row) => row.from === null)?.to;
    expect(start).toBe('draft');
    expect([...reachableFrom(TABLE, 'draft')].sort()).toEqual([...STATUSES].sort());
  });

  it('spec 1: every live status can still reach a terminal one, so nothing gets stuck', () => {
    for (const status of STATUSES.filter((s) => !TERMINAL.includes(s))) {
      const reached = reachableFrom(TABLE, status);
      expect(
        TERMINAL.some((end) => reached.has(end)),
        status,
      ).toBe(true);
    }
  });

  it('spec 2: no row is a self-loop, and every target is a real status', () => {
    for (const row of TABLE) {
      expect(row.from, `${row.action} → ${row.to}`).not.toBe(row.to);
      expect(STATUSES).toContain(row.to);
      if (row.from !== null) expect(STATUSES).toContain(row.from);
    }
  });

  it('spec 3: the terminal statuses are exactly those with no outgoing row — rejected, cancelled, closed', () => {
    const exitless = STATUSES.filter((status) => transitionsFrom(TABLE, status).length === 0);
    expect(exitless).toEqual(TERMINAL);
  });

  it('spec 4: no move appears twice; the decision’s two rows are picked by `decisionTransition`', () => {
    const moves = TABLE.map((row) => `${row.from ?? '—'}→${row.to}`);
    expect(new Set(moves).size).toBe(moves.length);
    // One action leaving one status by two rows: decide, from pendingApproval.
    const shared = STATUSES.flatMap((status) => {
      const actions = transitionsFrom(TABLE, status).map((row) => row.action);
      return actions
        .filter((action, i) => actions.indexOf(action) !== i)
        .map((a) => `${status}:${a}`);
    });
    expect(shared).toEqual(['pendingApproval:decide']);
    expect(decisionTransition('approved')).toBe(
      findTransition(TABLE, 'pendingApproval', 'approved'),
    );
    expect(decisionTransition('rejected')).toBe(
      findTransition(TABLE, 'pendingApproval', 'rejected'),
    );
    // An intermediate rung, or a chain left with nobody: in-state, the status kept.
    expect(decisionTransition('pending')).toBeNull();
    expect(decisionTransition('unstaffed')).toBeNull();
  });

  it('spec 5: every non-system row names one key of this module, declared in the manifest', () => {
    const declared = new Set(declaredKeys());
    expect(declared.size, 'the scan read the manifest').toBeGreaterThan(0);
    for (const row of TABLE) {
      if (row.system === true) {
        expect(row.permission, `${row.action} is the system’s`).toBeNull();
        continue;
      }
      expect(row.permission, row.action).toMatch(/^administrationPurchaseRequest\.[a-z]+$/);
      const key = row.permission ?? '';
      expect(declared.has(key) || NOT_YET_DECLARED.includes(key), key).toBe(true);
    }
    // The list holds only keys still undeclared: once P2.5 declares `.cancel`, this fails until the
    // list is emptied.
    for (const key of NOT_YET_DECLARED) expect(declared.has(key), key).toBe(false);
  });

  it('spec 5: the decision and the return name the approve key, with the override as its substitute (§1.2 item 19)', () => {
    for (const row of TABLE.filter((r) => r.action === 'decide' || r.action === 'return')) {
      expect(row.permission).toBe('administrationPurchaseRequest.approve');
      expect(row.substitute).toBe('approval.override');
    }
    expect(TABLE.filter((row) => row.substitute !== undefined).map((row) => row.action)).toEqual([
      'decide',
      'decide',
      'return',
    ]);
  });

  it('spec 5: the requester’s own withdrawal rides rows 6 and 7 only (OD-28.4 (i))', () => {
    expect(
      TABLE.filter((row) => row.ownWithdrawal === true).map((row) => `${row.from ?? ''}→${row.to}`),
    ).toEqual(['draft→cancelled', 'pendingApproval→cancelled']);
  });

  it('spec 6: the reason-required rows are exactly the destructive set, both ways', () => {
    const required = TABLE.filter((row) => row.requiresReason === true).map(
      (row) => `${row.from ?? '—'}→${row.to}`,
    );
    // Every row into rejected or cancelled from beyond draft, and the return (design §5.1.2 item 5).
    const destructive = TABLE.filter(
      (row) =>
        row.action === 'return' ||
        ((row.to === 'rejected' || row.to === 'cancelled') && row.from !== 'draft'),
    ).map((row) => `${row.from ?? '—'}→${row.to}`);
    expect(required).toEqual(destructive);
    expect(required).toEqual([
      'pendingApproval→rejected',
      'pendingApproval→draft',
      'pendingApproval→cancelled',
      'approved→cancelled',
    ]);
  });

  it('spec 6: a draft’s cancel needs a reason once it carries a number — a returned request — and not before', () => {
    const draftCancel = findTransition(TABLE, 'draft', 'cancelled');
    if (draftCancel === null) throw new Error('row 6 is missing');
    expect(reasonRequired(draftCancel, { number: null })).toBe(false);
    expect(reasonRequired(draftCancel, { number: 'PR-2026-000007' })).toBe(true);
    const submit = findTransition(TABLE, 'draft', 'pendingApproval');
    if (submit === null) throw new Error('row 2 is missing');
    expect(reasonRequired(submit, { number: 'PR-2026-000007' })).toBe(false);
  });
});

describe('the acts the record offers (P2 plan §4.4)', () => {
  it('are the contract’s six, each starting where its rows do', () => {
    expect(PURCHASE_REQUEST_ACTS.map((act) => act.key)).toEqual([
      ...ADMINISTRATION_PURCHASE_REQUEST_ACTIONS,
    ]);
    const from = Object.fromEntries(PURCHASE_REQUEST_ACTS.map((act) => [act.key, [...act.from]]));
    expect(from).toEqual({
      edit: ['draft'],
      submit: ['draft'],
      decide: ['pendingApproval'],
      return: ['pendingApproval'],
      cancel: ['draft', 'pendingApproval', 'approved'],
      withdraw: ['draft', 'pendingApproval'],
    });
  });

  it('name the keys their routes run under', () => {
    expect(PURCHASE_REQUEST_ACT_KEYS).toEqual({
      edit: 'administrationPurchaseRequest.edit',
      submit: 'administrationPurchaseRequest.create',
      decide: 'administrationPurchaseRequest.approve',
      return: 'administrationPurchaseRequest.approve',
      cancel: 'administrationPurchaseRequest.cancel',
      withdraw: 'administrationPurchaseRequest.view',
    });
  });
});

describe('submitProblem (design §5.4 row 2)', () => {
  const active = { isActive: true };
  const details = (error: AppError | null) =>
    error?.details?.map((detail) => `${detail.field}:${detail.code}`) ?? [];

  it('passes a draft whose every line has a quantity and an active item', () => {
    expect(submitProblem([{ qty: 3, item: active }])).toBeNull();
  });

  it('refuses each failed rule with its own detail, every one at once', () => {
    expect(details(submitProblem([]))).toEqual(['lines:noLines']);
    const refused = submitProblem([
      { qty: 0, item: active },
      { qty: 2, item: null },
      { qty: 1, item: { isActive: false } },
    ]);
    expect(refused?.code).toBe(ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED);
    expect(refused?.httpStatus).toBe(422);
    expect(details(refused)).toEqual([
      'lines.0.qty:notPositive',
      'lines.1.itemId:itemMissing',
      'lines.2.itemId:itemInactive',
    ]);
  });
});

describe('cancelProblem (design §5.4 row 8)', () => {
  it('passes while nothing is ordered — always so in P2', () => {
    expect(cancelProblem([{ qty: 5, orderedQty: 0, cancelledQty: 2 }])).toBeNull();
    expect(cancelProblem([])).toBeNull();
  });

  it('names each line something is ordered on', () => {
    const refused = cancelProblem([
      { qty: 5, orderedQty: 0, cancelledQty: 0 },
      { qty: 5, orderedQty: 1, cancelledQty: 0 },
    ]);
    expect(refused?.code).toBe(ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED);
    expect(refused?.details).toEqual([
      expect.objectContaining({ field: 'lines.1.orderedQty', code: 'ordered' }),
    ]);
  });
});

describe('spec 7: orderStatusOf and closeCondition (design §5.12, §5.4 row 9)', () => {
  it('reads notOrdered with no line, and with nothing ordered', () => {
    expect(orderStatusOf([])).toBe('notOrdered');
    expect(orderStatusOf([{ qty: 4, orderedQty: 0, cancelledQty: 0 }])).toBe('notOrdered');
  });

  it('reads against qty − cancelled: a line cut by the approvers is full once its rest is ordered', () => {
    expect(openQty({ qty: 10, orderedQty: 0, cancelledQty: 3 })).toBe(7);
    expect(orderStatusOf([{ qty: 10, orderedQty: 7, cancelledQty: 3 }])).toBe('fullyOrdered');
    expect(orderStatusOf([{ qty: 10, orderedQty: 6, cancelledQty: 3 }])).toBe('partiallyOrdered');
  });

  it('a line cut to nothing counts as settled beside an ordered one', () => {
    expect(
      orderStatusOf([
        { qty: 4, orderedQty: 0, cancelledQty: 4 },
        { qty: 2, orderedQty: 2, cancelledQty: 0 },
      ]),
    ).toBe('fullyOrdered');
  });

  it('closes only when every line is ordered or cancelled in full and no order holds a claim', () => {
    const settled = [{ qty: 4, orderedQty: 3, cancelledQty: 1 }];
    expect(closeCondition({ lines: settled, hasOpenClaim: false })).toBe(true);
    expect(closeCondition({ lines: settled, hasOpenClaim: true })).toBe(false);
    expect(
      closeCondition({ lines: [{ qty: 4, orderedQty: 2, cancelledQty: 1 }], hasOpenClaim: false }),
    ).toBe(false);
  });
});
