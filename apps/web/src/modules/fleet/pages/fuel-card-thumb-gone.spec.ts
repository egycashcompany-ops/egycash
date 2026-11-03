// 6d review: a photo deleted (or replaced by one the browser could not thumbnail) must not end in a
// red toast. The thumbnail query sits under the cards' subtree, so every card write and every
// `fleet.fuelCard` realtime event fetches it again — and once the photo is gone the server answers
// 404 «this card has no thumbnail» while the old bytes are still cached, which is exactly when the
// global QueryCache handler (`shared/lib/query-client.ts`) toasts a background refetch. A 404 is an
// answer here («لا توجد صورة مصغّرة»), not a failure: it is driven through the REAL query client.
import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '../../../shared/lib/api-client';
import { queryClient } from '../../../shared/lib/query-client';
import { toast } from '../../../shared/ui/toast/toast-store';
import { featureKey } from '../../../shared/lib/query-keys';
import { fuelCardThumbQuery } from '../api/fleet-queries';

/** The cards' subtree — what every card write and `fleet.fuelCard` realtime event invalidates. */
const FUEL_CARDS = featureKey('fleet', 'fuelCards');

const answer = vi.hoisted(() => ({ next: [] as (Blob | 'gone' | 'down')[] }));
vi.mock('../api/fleet-api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/fleet-api');
  const { ApiError: ApiErrorClass } = await vi.importActual<{ ApiError: typeof ApiError }>(
    '../../../shared/lib/api-client',
  );
  return {
    ...actual,
    fetchFuelCardThumb: vi.fn(async () => {
      const next = answer.next.shift();
      if (next === 'gone') throw new ApiErrorClass('EXPORT_FAILED', 'export failed', 404);
      if (next === 'down') throw new ApiErrorClass('EXPORT_FAILED', 'export failed', 500);
      return next ?? new Blob(['thumb'], { type: 'image/jpeg' });
    }),
  };
});

/** The query as a mounted thumbnail holds it — an active observer, so invalidation refetches it. */
const watch = (photoKey: string | null) => {
  const observer = new QueryObserver(queryClient, fuelCardThumbQuery('c-1', photoKey));
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, unsubscribe };
};
const settled = async (observer: QueryObserver<Blob | null>): Promise<void> => {
  await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'));
};

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  answer.next = [];
});

describe('the thumbnail of a photo that is gone', () => {
  it('a delete, then the cards’ invalidation: the 404 reads «no thumbnail» — no red toast', async () => {
    const error = vi.spyOn(toast, 'error');
    answer.next = [new Blob(['thumb'], { type: 'image/jpeg' }), 'gone'];
    const { observer, unsubscribe } = watch('f-1');
    await settled(observer as QueryObserver<Blob | null>);
    expect(observer.getCurrentResult().data).toBeInstanceOf(Blob);

    // «حذف الصورة» succeeded: the mutation invalidates the cards' subtree (and so does realtime).
    await queryClient.invalidateQueries({ queryKey: FUEL_CARDS });
    await settled(observer as QueryObserver<Blob | null>);
    expect([observer.getCurrentResult().data, observer.getCurrentResult().isError]).toEqual([
      null,
      false,
    ]);
    expect(error).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('a real failure on a background refetch still toasts', async () => {
    const error = vi.spyOn(toast, 'error');
    answer.next = [new Blob(['thumb'], { type: 'image/jpeg' }), 'down'];
    const { observer, unsubscribe } = watch('f-1');
    await settled(observer as QueryObserver<Blob | null>);
    await queryClient.invalidateQueries({ queryKey: FUEL_CARDS });
    await settled(observer as QueryObserver<Blob | null>);
    expect(error).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('is keyed by the photo too — a replaced photo is another query, never the old one refetched', () => {
    expect(fuelCardThumbQuery('c-1', 'f-1').queryKey).not.toEqual(
      fuelCardThumbQuery('c-1', 'f-2').queryKey,
    );
    // Still under the cards' subtree, so a card write or a realtime event refreshes it.
    expect(fuelCardThumbQuery('c-1', 'f-1').queryKey.slice(0, FUEL_CARDS.length)).toEqual([
      ...FUEL_CARDS,
    ]);
  });
});
