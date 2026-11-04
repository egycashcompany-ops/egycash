// What the daily report asks the server for (2026-11-02, «تسمح بإنى أختار فترة من إلى .. بس الـ
// Default يكون اليوم»): the period's two bounds, both — a call that sent one day of a period would
// show that day's counts under «من … إلى …».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from '../../shared/lib/api-client';
import { atmDailyReport } from './api/atm-api';

const asked: string[] = [];
vi.mock('../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<typeof ApiClientModule>('../../shared/lib/api-client');
  return {
    ...actual,
    get: (path: string) => {
      asked.push(path);
      return Promise.resolve({});
    },
  };
});

beforeEach(() => {
  asked.length = 0;
});

describe('atmDailyReport', () => {
  it('asks for the whole period — from and to', async () => {
    await atmDailyReport({ from: '2026-10-20', to: '2026-10-28' });
    expect(asked).toEqual(['/atm/reports/daily?from=2026-10-20&to=2026-10-28']);
  });

  it('asks for one day as a period of one day', async () => {
    await atmDailyReport({ from: '2026-11-02', to: '2026-11-02' });
    expect(asked).toEqual(['/atm/reports/daily?from=2026-11-02&to=2026-11-02']);
  });
});
