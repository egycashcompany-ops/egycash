// The licensing-expenses board's arrows and «الإحصائيات», as the repository sends them: the keys the
// table may order by, the figures computed rather than stored (over the MATCHED memos under «النوع» /
// «التسوية», D05), and a sum that no page can narrow, in whole piastres (D51).
// The orders and sums themselves run against a real mongo in the integration suite.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FleetLicenseExpenseModel } from './license-expense.model';
import {
  CARS_COUNT_EXPRESSION,
  KIND_ORDER_EXPRESSION,
  LICENSE_EXPENSE_SORTS,
  fleetLicenseExpenseRepository,
  linesTotalExpression,
} from './license-expense.repository';

interface Stage {
  $match?: Record<string, unknown>;
  $group?: Record<string, unknown>;
}

afterEach(() => vi.restoreAllMocks());

/** Drive the real `totals` against a stubbed collection and hand back the pipeline it sent. */
const totalsFor = async (row: Record<string, number> | null) => {
  let stages: Stage[] = [];
  vi.spyOn(FleetLicenseExpenseModel, 'aggregate').mockImplementation(((sent: Stage[]) => {
    stages = sent;
    return { exec: async () => (row === null ? [] : [row]) };
  }) as unknown as typeof FleetLicenseExpenseModel.aggregate);
  const result = await fleetLicenseExpenseRepository.totals({ kind: 'renewal' });
  return { stages, result };
};

describe('the arrows of the licensing-expenses table', () => {
  it('order by the date and by every figure the table derives', async () => {
    const list = vi.spyOn(fleetLicenseExpenseRepository, 'list').mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
    });
    await fleetLicenseExpenseRepository.listExpenses({ page: 1, pageSize: 25 });
    const params = list.mock.calls[0]![0];
    expect(params.sortableFields).toEqual([
      'date',
      'createdAt',
      'updatedAt',
      'kindOrder',
      'carsCount',
      'visaTotal',
      'cashTotal',
      'total',
    ]);
    // Every derived key is computed — never joined, and never a field of the memo.
    expect(params.sortDerived).toBe(LICENSE_EXPENSE_SORTS);
    for (const field of LICENSE_EXPENSE_SORTS) {
      expect(field.expression, field.key).toBeDefined();
      expect(field.from, field.key).toBeUndefined();
    }
  });

  it('count a line as its amount times its count, an unwritten amount as nothing', () => {
    const all = JSON.stringify(linesTotalExpression());
    expect(all).toContain('{"$multiply":[{"$ifNull":["$$this.amount",0]}');
    // Over the renewal's lines and the extension's together; a half that is not there has none.
    expect(all).toContain('{"$ifNull":["$renewal.items",[]]},{"$ifNull":["$extension.items",[]]}');
    expect(all).not.toContain('paidBy');
    expect(JSON.stringify(linesTotalExpression('visa'))).toContain('["$$this.paidBy","visa"]');
    expect(JSON.stringify(linesTotalExpression('cash'))).toContain('["$$this.paidBy","cash"]');
  });

  it('order the money as the cell prints it — to the piastre, so a tie reaches the next arrow', () => {
    const byKey = new Map(LICENSE_EXPENSE_SORTS.map((field) => [field.key, field.expression]));
    expect(byKey.get('visaTotal')).toEqual({ $round: [linesTotalExpression('visa'), 2] });
    expect(byKey.get('cashTotal')).toEqual({ $round: [linesTotalExpression('cash'), 2] });
    expect(byKey.get('total')).toEqual({ $round: [linesTotalExpression(), 2] });
    // Counts are whole already.
    expect(byKey.get('carsCount')).toBe(CARS_COUNT_EXPRESSION);
  });

  it('count both halves’ cars, and rank the kind renewal → both → extension', () => {
    expect(JSON.stringify(CARS_COUNT_EXPRESSION)).toContain('$renewal.vehicles');
    expect(JSON.stringify(CARS_COUNT_EXPRESSION)).toContain('$extension.vehicles');
    // renewal ? (extension ? 1 : 0) : 2
    const kind = KIND_ORDER_EXPRESSION.$cond;
    expect(kind[1]).toEqual({ $cond: [expect.anything(), 1, 0] });
    expect(kind[2]).toBe(2);
  });
});

describe('«الإحصائيات» of the licensing-expenses board', () => {
  it('has NO $skip and NO $limit, and reads the rows the list reads', async () => {
    const { stages } = await totalsFor(null);
    expect(stages.flatMap((stage) => Object.keys(stage))).toEqual(['$match', '$group']);
    // `baseFilter`: a deleted memo is no more in the figures than in the table.
    expect(JSON.stringify(stages[0]?.$match)).toContain('isDeleted');
    expect(JSON.stringify(stages[0]?.$match)).toContain('"kind":"renewal"');
    const group = stages[1]?.$group ?? {};
    expect(Object.keys(group)).toEqual(['_id', 'count', 'cars', 'visa', 'cash']);
    // Unfiltered, the cars are every memo's — the column's own expression.
    expect(group['cars']).toEqual({ $sum: CARS_COUNT_EXPRESSION });
  });

  it('counts MEMOS, not records — a record holding both is two (D05)', async () => {
    const { stages } = await totalsFor(null);
    const count = JSON.stringify(stages[1]?.$group?.['count']);
    expect(count).not.toBe(JSON.stringify({ $sum: 1 }));
    expect(count).toContain('"$renewal"');
    expect(count).toContain('"$extension"');
  });

  it('sums the money line by line in whole piastres — `spendDigest`’s arithmetic (D51)', async () => {
    const { stages } = await totalsFor(null);
    const visa = JSON.stringify(stages[1]?.$group?.['visa']);
    expect(visa).toContain('{"$round":[{"$multiply":[{"$ifNull":["$$this.amount",0]},100]},0]}');
    expect(visa).toContain('["$$this.paidBy","visa"]');
    expect(JSON.stringify(stages[1]?.$group?.['cash'])).toContain('["$$this.paidBy","cash"]');
  });

  it('reads nothing matched as zeros, and the piastres back as pounds', async () => {
    expect((await totalsFor(null)).result).toEqual({
      count: 0,
      cars: 0,
      visaTotal: 0,
      cashTotal: 0,
    });
    const { result } = await totalsFor({ count: 2, cars: 3, visa: 30, cash: 103710 });
    expect(result).toEqual({ count: 2, cars: 3, visaTotal: 0.3, cashTotal: 1037.1 });
  });

  it('under «النوع» / «التسوية» reads the MATCHED memos only (D05)', async () => {
    let stages: Stage[] = [];
    vi.spyOn(FleetLicenseExpenseModel, 'aggregate').mockImplementation(((sent: Stage[]) => {
      stages = sent;
      return { exec: async () => [] };
    }) as unknown as typeof FleetLicenseExpenseModel.aggregate);
    await fleetLicenseExpenseRepository.totals({}, { kind: 'renewal', status: 'waiting' });
    const group = JSON.stringify(stages[1]?.$group);
    // The renewal memo alone, and only while it waits for its settlement.
    expect(group).toContain('$renewalSettlement');
    expect(group).not.toContain('$extension.items');
    expect(group).not.toContain('$extensionSettlement');
  });

  it('orders the money and cars arrows by the matched memos too', async () => {
    const list = vi.spyOn(fleetLicenseExpenseRepository, 'list').mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
    });
    await fleetLicenseExpenseRepository.listExpenses({ page: 1, pageSize: 25 }, {});
    expect(list.mock.calls[0]![0].sortDerived).toBe(LICENSE_EXPENSE_SORTS);
    await fleetLicenseExpenseRepository.listExpenses(
      { page: 1, pageSize: 25 },
      { status: 'settled' },
    );
    const sorts = list.mock.calls[1]![0].sortDerived ?? [];
    expect(sorts.map((field) => field.key)).toEqual(LICENSE_EXPENSE_SORTS.map((f) => f.key));
    const byKey = new Map(sorts.map((field) => [field.key, JSON.stringify(field.expression)]));
    for (const key of ['carsCount', 'visaTotal', 'cashTotal', 'total']) {
      expect(byKey.get(key), key).toContain('Settlement');
    }
    expect(byKey.get('kindOrder')).toBe(JSON.stringify(KIND_ORDER_EXPRESSION));
  });
});
