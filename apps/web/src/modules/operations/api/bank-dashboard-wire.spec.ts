// «لوحة البنك بفروعه» (Round 25) on the wire: the bank in the path, the page's period and the side in
// the query — `GET /operations/reports/banks/:bankId/branches?from=&to=&side=`.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from '../../../shared/lib/api-client';
import { getBankBranchReport } from './operations-api';

vi.mock('../../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../shared/lib/api-client');
  return { ...actual, get: vi.fn(async () => ({})) };
});

beforeEach(() => {
  vi.mocked(get).mockClear();
});

describe('the bank’s branches', () => {
  it('asks for one bank by its id, over the page’s two days, filed by the side asked', async () => {
    await getBankBranchReport('64b0c0ffee0000000000abcd', {
      from: '2026-11-01',
      to: '2026-11-30',
      side: 'origin',
    });
    expect(get).toHaveBeenCalledWith(
      '/operations/reports/banks/64b0c0ffee0000000000abcd/branches?from=2026-11-01&to=2026-11-30&side=origin',
    );
  });

  it('keeps an id that is not one inside its own path segment', async () => {
    await getBankBranchReport('a/b?c', {
      from: '2026-11-01',
      to: '2026-11-30',
      side: 'destination',
    });
    expect(get).toHaveBeenCalledWith(
      '/operations/reports/banks/a%2Fb%3Fc/branches?from=2026-11-01&to=2026-11-30&side=destination',
    );
  });
});
