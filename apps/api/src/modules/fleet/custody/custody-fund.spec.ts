// «إجمالي العهدة» on the figures and the dashboard — «عاوز ازود اجمالى العهده فى الاحصايات و تكون
// فى الداس بورد». The fund is read by the server, from the organization's «مبلغ العهدة», and carried
// as `null` while it is not set: never a 0 for the screen to divide the spend by.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetSettingKeys } from '@ecms/contracts';

const asked: { key: string; subject: unknown }[] = [];
let stored: unknown = 0;
vi.mock('../../../platform/settings', () => ({
  settingsService: {
    resolve: async (key: string, subject: unknown) => {
      asked.push({ key, subject });
      return stored;
    },
  },
}));

const { readCustodyFundTotal } = await import('./custody-fund');

beforeEach(() => {
  asked.length = 0;
});

describe('readCustodyFundTotal', () => {
  it('asks the organization’s «مبلغ العهدة» — no user’s, no branch’s', async () => {
    stored = 250_000;
    await readCustodyFundTotal();
    expect(asked).toEqual([
      { key: FleetSettingKeys.CustodyFundTotal, subject: { userId: null, branchId: null } },
    ]);
  });

  it('carries the amount as it is set, to the piastre', async () => {
    stored = 250_000.5;
    expect(await readCustodyFundTotal()).toBe(250_000.5);
    stored = 0.01;
    expect(await readCustodyFundTotal()).toBe(0.01);
  });

  it('reads 0 — the default — as «not set»: `null`', async () => {
    stored = 0;
    expect(await readCustodyFundTotal()).toBeNull();
  });

  it('never passes on what is not an amount', async () => {
    for (const value of [-1, 1.005, '250000', null, undefined]) {
      stored = value;
      expect(await readCustodyFundTotal(), String(value)).toBeNull();
    }
  });
});
