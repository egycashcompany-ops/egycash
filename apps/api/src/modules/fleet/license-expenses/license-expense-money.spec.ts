// One licensing memo's money, as «تسوية عهدة» takes it off the fund — and the proof it is the
// board's own arithmetic: the same lines through the repository's aggregation expression, read by
// a small interpreter of exactly the operators that expression uses, give the same figures.
import { describe, expect, it } from 'vitest';
import { type FleetLicenseExpensePaidBy } from '@ecms/contracts';
import { partMoney } from './license-expense-money';
import { linesTotalExpression } from './license-expense.repository';

type Line = { amount: number | null; count: number; paidBy: FleetLicenseExpensePaidBy };
const line = (amount: number | null, count: number, paidBy: FleetLicenseExpensePaidBy): Line => ({
  amount,
  count,
  paidBy,
});

/** Evaluates the aggregation operators `linesTotalExpression` is built of — no more. */
const evaluate = (
  expr: unknown,
  doc: Record<string, unknown>,
  vars: Record<string, unknown>,
): unknown => {
  if (typeof expr === 'string') {
    const path = (root: unknown, keys: string[]): unknown =>
      keys.reduce<unknown>((value, key) => (value as Record<string, unknown> | null)?.[key], root);
    if (expr.startsWith('$$')) {
      const [name, ...rest] = expr.slice(2).split('.');
      return path(vars[name as string], rest);
    }
    if (expr.startsWith('$')) return path(doc, expr.slice(1).split('.'));
    return expr;
  }
  if (typeof expr !== 'object' || expr === null) return expr;
  if (Array.isArray(expr)) return expr.map((item) => evaluate(item, doc, vars));
  const [op, arg] = Object.entries(expr)[0] as [string, unknown];
  const all = (): unknown[] => (arg as unknown[]).map((item) => evaluate(item, doc, vars));
  switch (op) {
    case '$concatArrays':
      return all().flatMap((value) => value as unknown[]);
    case '$ifNull': {
      const [value, fallback] = all();
      return value ?? fallback;
    }
    case '$add':
      return all().reduce<number>((sum, value) => sum + (value as number), 0);
    case '$multiply':
      return all().reduce<number>((product, value) => product * (value as number), 1);
    case '$eq': {
      const [a, b] = all();
      return a === b;
    }
    case '$cond': {
      const [test, yes, no] = arg as unknown[];
      return evaluate(test, doc, vars) === true
        ? evaluate(yes, doc, vars)
        : evaluate(no, doc, vars);
    }
    case '$reduce': {
      const spec = arg as { input: unknown; initialValue: unknown; in: unknown };
      return (evaluate(spec.input, doc, vars) as unknown[]).reduce(
        (value, item) => evaluate(spec.in, doc, { ...vars, value, this: item }),
        evaluate(spec.initialValue, doc, vars),
      );
    }
    default:
      throw new Error(`no interpreter for ${op}`);
  }
};

/** What the board's expression says one memo costs, rounded as the strip rounds. */
const boardMoney = (items: Line[], paidBy?: FleetLicenseExpensePaidBy): number => {
  const doc = { renewal: { vehicles: [], items }, extension: null };
  const raw = evaluate(linesTotalExpression(paidBy), doc, {}) as number;
  return Math.round(raw * 100) / 100;
};

describe('partMoney — one licensing memo split by the card and in cash', () => {
  it('is nothing for a memo that is not there, and for one with no lines', () => {
    expect(partMoney(null)).toEqual({ visa: 0, cash: 0, total: 0 });
    expect(partMoney(undefined)).toEqual({ visa: 0, cash: 0, total: 0 });
    expect(partMoney({ items: [] })).toEqual({ visa: 0, cash: 0, total: 0 });
  });

  it('counts a line with no amount written as nothing, and multiplies by the count', () => {
    expect(
      partMoney({ items: [line(null, 3, 'visa'), line(5, 2, 'cash'), line(600, 1, 'visa')] }),
    ).toEqual({ visa: 600, cash: 10, total: 610 });
  });

  it('reads a missing count as one, as the expression does', () => {
    expect(partMoney({ items: [{ amount: 40, count: undefined, paidBy: 'cash' }] })).toEqual({
      visa: 0,
      cash: 40,
      total: 40,
    });
  });

  it('works in piastres — 0.1 + 0.2 is 0.30, and his settlement adds up to 124,139.46', () => {
    expect(partMoney({ items: [line(0.1, 1, 'visa'), line(0.2, 1, 'visa')] }).visa).toBe(0.3);
    const memos = [
      { items: [line(33450, 1, 'visa'), line(6282.19, 1, 'cash')] },
      { items: [line(30900, 1, 'visa'), line(5868.85, 1, 'cash')] },
      { items: [line(40125, 1, 'visa'), line(7513.42, 1, 'cash')] },
    ].map(partMoney);
    expect(memos.map((memo) => memo.total)).toEqual([39732.19, 36768.85, 47638.42]);
    const piastres = memos.reduce((sum, memo) => sum + Math.round(memo.total * 100), 0);
    expect(piastres / 100).toBe(124139.46);
  });

  it('agrees with the board’s aggregation expression, line for line', () => {
    const cases: Line[][] = [
      [line(100, 1, 'visa'), line(5, 2, 'cash')],
      [line(200, 2, 'cash'), line(null, 3, 'visa')],
      [line(0.1, 1, 'visa'), line(0.2, 1, 'visa'), line(0.7, 3, 'cash')],
      [line(1450, 1, 'visa'), line(18, 2, 'cash'), line(6282.19, 1, 'cash')],
      [],
    ];
    for (const items of cases) {
      const money = partMoney({ items });
      expect(money.visa, JSON.stringify(items)).toBe(boardMoney(items, 'visa'));
      expect(money.cash, JSON.stringify(items)).toBe(boardMoney(items, 'cash'));
      expect(money.total, JSON.stringify(items)).toBe(boardMoney(items));
    }
  });
});
