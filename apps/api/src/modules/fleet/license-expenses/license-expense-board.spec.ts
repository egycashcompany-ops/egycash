// The licensing-expenses board's arrows and «الإحصائيات», as the repository sends them: the keys the
// table may order by, the figures computed rather than stored, and a sum that no page can narrow.
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
    expect(stages[1]?.$group).toEqual({
      _id: null,
      count: { $sum: 1 },
      cars: { $sum: CARS_COUNT_EXPRESSION },
      visaTotal: { $sum: linesTotalExpression('visa') },
      cashTotal: { $sum: linesTotalExpression('cash') },
    });
  });

  it('reads nothing matched as zeros, and rounds the money to the piastre', async () => {
    expect((await totalsFor(null)).result).toEqual({
      count: 0,
      cars: 0,
      visaTotal: 0,
      cashTotal: 0,
    });
    const { result } = await totalsFor({
      count: 2,
      cars: 3,
      visaTotal: 0.1 + 0.2,
      cashTotal: 1037.1000000001,
    });
    expect(result).toEqual({ count: 2, cars: 3, visaTotal: 0.3, cashTotal: 1037.1 });
  });
});
