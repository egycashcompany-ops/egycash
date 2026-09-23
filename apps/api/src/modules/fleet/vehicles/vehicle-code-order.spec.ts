// The fleet's car order, on the SERVER's side of it.
//
// The rule itself — 150 upward, then the cars written in words, then «الملاكى» — lives in the
// contract and is proved there against real codes. What has to be proved HERE is that the server
// actually uses it: the expression is built from the contract's own boundary rather than from a
// 150 written a second time, every register that orders by a car's code carries it, and the
// registry's own `code` sort is mapped onto it rather than left as a text sort.
//
// The expression's ARITHMETIC is proved end to end in `tests/integration/fleet-vehicle-order`,
// against a real mongo — nothing in a node-env test can evaluate an aggregation expression.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLEET_FIRST_WORKING_CODE } from '@ecms/contracts';
import { VEHICLE_CODE_ORDER_SORT, VEHICLE_CODE_SORT, vehicleCodeOrder } from './vehicle.repository';

const source = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

describe('the order expression is built from the contract, not from a second 150', () => {
  it('carries the contract’s boundary as a value, wherever it came from', () => {
    // Serialised and searched, because the constant is buried in a `$cond` several levels down
    // and what matters is that the NUMBER in the expression is the contract's, not that some
    // particular nesting is preserved.
    expect(JSON.stringify(vehicleCodeOrder('$code'))).toContain(String(FLEET_FIRST_WORKING_CODE));
  });

  it('never spells the boundary itself', () => {
    // The failure this catches is a silent one: a hand-typed 150 here and a changed constant in
    // the contract would leave the browser and the server disagreeing about where car 149 goes,
    // with both of them internally consistent.
    const repo = source('vehicle.repository.ts');
    const body = repo.slice(
      repo.indexOf('export const vehicleCodeOrder'),
      repo.indexOf('export const VEHICLE_CODE_ORDER_SORT'),
    );
    expect(body).toContain('FLEET_FIRST_WORKING_CODE');
    // COMMENTS STRIPPED FIRST. The prose quotes the owner («من اول 150 وانت طالع»), which is the
    // reason the rule exists and must stay readable; what must not appear is a 150 the code runs.
    const code = body
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code, 'no literal boundary in the expression itself').not.toMatch(/\b150\b/);
  });
});

describe('every register that orders by a car’s code uses it', () => {
  it('the JOINED key carries an order of its own', () => {
    // The four registers that reference a car — odometer, workshop, accidents, violations — all
    // share `VEHICLE_CODE_SORT`, so giving it the rule gives it to all four at once.
    expect(VEHICLE_CODE_SORT.order, 'the joined code is not sorted as text').toBeDefined();
  });

  it('and the REGISTRY’s own column is mapped onto a key of its own', () => {
    // Not computed over `code` in place: the derived machinery projects a computed key away after
    // sorting, so naming it `code` would strip the real column off every row.
    expect(VEHICLE_CODE_ORDER_SORT.key).not.toBe('code');
    expect(VEHICLE_CODE_ORDER_SORT.expression).toBeDefined();

    const repo = source('vehicle.repository.ts');
    const list = repo.slice(repo.indexOf('async listVehicles('), repo.indexOf('async codesByIds('));
    expect(list, 'a request for `code` is rewritten').toContain("params.sortBy === 'code'");
    expect(list, 'including a multi-column order').toContain("entry.by === 'code'");
    expect(list, 'and the derived key is declared').toContain('VEHICLE_CODE_ORDER_SORT');
  });
});
