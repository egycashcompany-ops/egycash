// A board read whole can hold more checked rows than one bulk request carries
// (`ATM_BULK_MAX_IDS`). Close, edit and delete — on both boards — send them in consecutive
// requests the API accepts, keep everything else the request says, and join the answers as one.
//
// Every id below is synthetic.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATM_BULK_MAX_IDS,
  AtmOperationIdsSchema,
  BulkUpdateAtmMaintenancesSchema,
  BulkUpdateAtmReplenishmentsSchema,
  CloseAtmMaintenancesSchema,
} from '@ecms/contracts';
import type * as ApiClientModule from '../../shared/lib/api-client';
import {
  bulkUpdateMaintenances,
  bulkUpdateReplenishments,
  closeMaintenances,
  closeReplenishments,
  deleteMaintenances,
  deleteReplenishments,
  inBulkBatches,
} from './api/atm-api';

const sent: { method: 'post' | 'patch'; path: string; body: { ids: string[] } }[] = [];
/** The request (1-based) the server refuses, if any. */
let failOn: number | null = null;

/** What the server answers: every row it was sent back (close/edit), or how many it removed. */
const answer = (path: string, body: { ids: string[] }): Promise<unknown> => {
  if (failOn !== null && sent.length === failOn) return Promise.reject(new Error('refused'));
  return Promise.resolve(
    path.endsWith('/delete') ? { removed: body.ids.length } : body.ids.map((id) => ({ id })),
  );
};

vi.mock('../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<typeof ApiClientModule>('../../shared/lib/api-client');
  return {
    ...actual,
    post: (path: string, body: { ids: string[] }) => {
      sent.push({ method: 'post', path, body });
      return answer(path, body);
    },
    patch: (path: string, body: { ids: string[] }) => {
      sent.push({ method: 'patch', path, body });
      return answer(path, body);
    },
  };
});

afterEach(() => {
  sent.length = 0;
  failOn = null;
});

const ids = (n: number): string[] =>
  Array.from({ length: n }, (_unused, i) => `65000000000000000${String(i).padStart(7, '0')}`);

describe('a checked selection larger than one request', () => {
  it('the cap is the API’s own, unchanged', () => {
    expect(ATM_BULK_MAX_IDS).toBe(200);
    expect(() => AtmOperationIdsSchema.parse({ ids: ids(201) })).toThrow();
  });

  it('closes every replenishment, in requests the API accepts, answers joined in order', async () => {
    const all = ids(450);
    const closed = await closeReplenishments(all);
    expect(sent.map((call) => call.body.ids.length)).toEqual([200, 200, 50]);
    expect(sent.every((call) => call.path === '/atm/replenishments/close')).toBe(true);
    for (const call of sent) expect(() => AtmOperationIdsSchema.parse(call.body)).not.toThrow();
    expect(closed.map((row) => row.id)).toEqual(all);
  });

  it('closes every maintenance with the same assigned employee on every request', async () => {
    const all = ids(401);
    const closed = await closeMaintenances(all, '650000000000000000000999');
    expect(sent.map((call) => call.body.ids.length)).toEqual([200, 200, 1]);
    for (const call of sent) {
      expect(CloseAtmMaintenancesSchema.parse(call.body).leaderEmployeeId).toBe(
        '650000000000000000000999',
      );
    }
    expect(closed).toHaveLength(401);
  });

  it('edits every checked row with the same change on every request', async () => {
    await bulkUpdateReplenishments({ ids: ids(250), leaderName: 'SYN LEADER' });
    await bulkUpdateMaintenances({ ids: ids(250), leaderName: 'SYN LEADER' });
    expect(sent.map((call) => [call.method, call.path, call.body.ids.length])).toEqual([
      ['patch', '/atm/replenishments/bulk', 200],
      ['patch', '/atm/replenishments/bulk', 50],
      ['patch', '/atm/maintenances/bulk', 200],
      ['patch', '/atm/maintenances/bulk', 50],
    ]);
    expect(BulkUpdateAtmReplenishmentsSchema.parse(sent[1]?.body).leaderName).toBe('SYN LEADER');
    expect(BulkUpdateAtmMaintenancesSchema.parse(sent[3]?.body).leaderName).toBe('SYN LEADER');
  });

  it('deletes every checked row and reports the total removed', async () => {
    expect(await deleteReplenishments(ids(230))).toEqual({ removed: 230 });
    expect(await deleteMaintenances(ids(30))).toEqual({ removed: 30 });
    expect(sent.map((call) => call.body.ids.length)).toEqual([200, 30, 30]);
  });

  it('a selection that fits one request is ONE request, exactly as before', async () => {
    await closeReplenishments(ids(200));
    expect(sent).toHaveLength(1);
  });

  it('a failing batch fails the action and sends nothing after it', async () => {
    failOn = 2;
    await expect(closeReplenishments(ids(450))).rejects.toThrow('refused');
    // The first batch stood; the second was refused; the third was never sent.
    expect(sent).toHaveLength(2);
  });

  it('batches in order, one request at a time', async () => {
    const order: number[] = [];
    await inBulkBatches(ids(5 * ATM_BULK_MAX_IDS), async (batch) => {
      order.push(batch.length);
      return Promise.resolve(batch.length);
    });
    expect(order).toEqual([200, 200, 200, 200, 200]);
  });
});
