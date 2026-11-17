// «حذف التقرير» on the vehicle checks dashboard, through the REAL hooks and the REAL query client:
// what a delete reads again, and who says a refusal.
//
// A delete that succeeded showed a false «not found»: the hook read the whole subtree again, and the
// open panel's own read — the report just deleted — answered 404, which the global QueryCache
// handler toasts for a read that already had data. So the deleted report's read is left alone, and
// let go once the panel closes. A refused delete toasted twice: the panel said it, and so did the
// global MutationCache handler, since the hook declared no `onError`. The panel says it alone.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/lib/api-client';
import { detailKey, listKey } from '../../../shared/lib/query-keys';
import { queryClient } from '../../../shared/lib/query-client';
import { toast } from '../../../shared/ui/toast/toast-store';
import * as api from './it-api';
import { useDeleteItVehicleCheck, useForgetItVehicleCheck } from './it-queries';

const refusal = (): ApiError =>
  new ApiError('NOT_FOUND', 'vehicle check not found', 404, undefined, 'req-spec');

vi.mock('./it-api', async (actual) => ({
  ...(await actual<typeof api>()),
  deleteVehicleCheck: vi.fn(),
}));
const deleteVehicleCheck = vi.mocked(api.deleteVehicleCheck);

/** Render once to get a hook's result, the way the panel holds it. */
const held = <T,>(hook: () => T): T => {
  let result: T | undefined;
  const Probe = (): null => {
    result = hook();
    return null;
  };
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
  );
  if (result === undefined) throw new Error('the hook did not run');
  return result;
};

const DELETED = 'r-corolla';
const keys = {
  dashboard: listKey('it', 'vehicleChecks', {
    dashboard: true,
    from: '2026-11-04',
    to: '2026-11-10',
  }),
  list: listKey('it', 'vehicleChecks', { page: 1, pageSize: 12 }),
  deleted: detailKey('it', 'vehicleChecks', DELETED),
  other: detailKey('it', 'vehicleChecks', 'r-152'),
};

afterEach(() => {
  vi.restoreAllMocks();
  deleteVehicleCheck.mockReset();
  queryClient.clear();
});

describe('a delete that succeeded', () => {
  it('reads the figures, the list and other reports again — never the deleted report itself', async () => {
    deleteVehicleCheck.mockResolvedValue(undefined);
    for (const key of Object.values(keys)) queryClient.setQueryData(key, {});
    await held(useDeleteItVehicleCheck).mutateAsync(DELETED);
    const invalidated = (key: readonly unknown[]): boolean | undefined =>
      queryClient.getQueryState(key)?.isInvalidated;
    expect(invalidated(keys.dashboard)).toBe(true);
    expect(invalidated(keys.list)).toBe(true);
    expect(invalidated(keys.other)).toBe(true);
    expect(invalidated(keys.deleted)).toBe(false);
  });

  it('lets the deleted report’s read go when the panel asks, and nothing else', () => {
    for (const key of Object.values(keys)) queryClient.setQueryData(key, {});
    held(useForgetItVehicleCheck)(DELETED);
    expect(queryClient.getQueryState(keys.deleted)).toBeUndefined();
    expect(queryClient.getQueryState(keys.other)).toBeDefined();
    expect(queryClient.getQueryState(keys.list)).toBeDefined();
  });
});

describe('a refused delete', () => {
  it('raises no global toast: the panel says it, once', async () => {
    deleteVehicleCheck.mockRejectedValue(refusal());
    const errors = vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
    await expect(held(useDeleteItVehicleCheck).mutateAsync(DELETED)).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(errors).not.toHaveBeenCalled();
  });

  it('control: a mutation without its own onError IS toasted by the global handler', async () => {
    const errors = vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, { mutationFn: () => Promise.reject(refusal()) })
        .execute(undefined),
    ).rejects.toBeInstanceOf(ApiError);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
