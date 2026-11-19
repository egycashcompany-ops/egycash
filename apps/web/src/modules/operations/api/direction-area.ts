// Round 28c — «الاتجاه»'s «إضافة «…» إلى القائمة» on «لوحة التشغيلة» and «الطاقم الثابت». Asked whether a
// direction typed by hand should also go on the list, the owner: «يعرض عليا اضيفه او لا». The add is
// the areas catalog's own create (`POST /operations/areas`, `operationsCatalog.manage` — no new
// grant; the server takes the actor from the token), written AT ONCE — reference data, not the
// board's draft, so neither «حفظ» nor «تراجع» touches it. On success the row takes the area in the
// catalog's own spelling (the page's `onAdded`), and the areas' list is read again before that, so
// every screen reading it — the box, the board's filters — lists the new area from then on.
//
// Its own small file, beside `operations-queries.ts` and not in it: the create there
// (`useCreateOperationsArea`, the catalog dialog's) leaves a refusal to the global notifier, and the
// box says the refusal itself, in place, with the typed text kept — one message, not two.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { foldOperationsAreaName, type OperationsAreaDto, type Paginated } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { featureKey, listKey } from '../../../shared/lib/query-keys';
import { toast } from '../../../shared/ui/toast/toast-store';
import { fetchWholeCatalog } from '../../fleet/lib/whole-catalog';
import { directionAddRefusal, type DirectionAddRefused } from '../lib/direction-pick';
import * as api from './operations-api';
import { type OperationsListParams } from './operations-api';

const MODULE = 'operations';

/** The read behind `useArchivedOperationsAreaNames`, its list call a seam a spec can stub. */
export const archivedAreaNames = async (
  listAreas: (params: OperationsListParams) => Promise<Paginated<OperationsAreaDto>>,
): Promise<string[]> => {
  const all = await fetchWholeCatalog((page, pageSize) =>
    listAreas({ page, pageSize, sortBy: 'name', isActive: false }),
  );
  return all.items.filter((area) => !area.isActive).map((area) => area.name);
};

/**
 * Every ARCHIVED area's name — a name the box would add may be one of them, held by the catalog
 * («موقوفة»): the box says so instead of offering the add. Under the areas' key, so an area written
 * anywhere (and the areas' realtime topic) stales it. Read only for a desk who may add.
 */
export const useArchivedOperationsAreaNames = (enabled: boolean) =>
  useQuery({
    queryKey: listKey(MODULE, 'areas', { whole: true, isActive: false }),
    queryFn: () => archivedAreaNames(api.listOperationsAreas),
    enabled,
  });

/**
 * The catalog's create for a name the box sends, as mutation options over `qc` (a spec runs them
 * on a real QueryClient). The English name is left for «البيانات المرجعية».
 */
export const directionAreaMutation = (
  qc: QueryClient,
  create: (body: {
    name: string;
    nameEn: null;
    governorate: null;
  }) => Promise<OperationsAreaDto> = api.createOperationsArea,
) => ({
  mutationFn: (name: string) => create({ name, nameEn: null, governorate: null }),
  // The branch form suggests from this list too.
  onSuccess: (): void => {
    void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'bankBranches') });
  },
  // Read again whatever the answer, and BEFORE the row is told: a 409 is an area added meanwhile,
  // which the box then offers; a success is listed, so the row's direction is no hand-typed text.
  onSettled: () => qc.invalidateQueries({ queryKey: featureKey(MODULE, 'areas') }),
  // The box says a refusal in place; declaring this keeps the global notifier quiet.
  onError: (): void => undefined,
});

/** What happens to one row's add, told to the screen. */
export interface DirectionAddEvents {
  /** The name being written for the row — null once the catalog has answered. */
  pending: (rowKey: string, name: string | null) => void;
  /** The catalog has the area: its OWN spelling, for the row. */
  added: (rowKey: string, area: string) => void;
  refused: (rowKey: string, refusal: DirectionAddRefused) => void;
}

/**
 * The adds of one screen, row by row (pure — the hook below holds it). A row with an add in flight
 * adds nothing more: a second Enter, a second click is answered `false`. Two rows adding the same
 * name at once (folded, as the server compares) share ONE request, and both take its answer.
 */
export const directionAddQueue = (
  create: (name: string) => Promise<OperationsAreaDto>,
  on: () => DirectionAddEvents,
) => {
  const busy = new Set<string>();
  const inFlight = new Map<string, Promise<OperationsAreaDto>>();
  return {
    add: (rowKey: string, name: string): boolean => {
      if (busy.has(rowKey)) return false;
      busy.add(rowKey);
      on().pending(rowKey, name);
      const key = foldOperationsAreaName(name);
      let request = inFlight.get(key);
      if (request === undefined) {
        const sent = create(name);
        const forget = (): void => {
          inFlight.delete(key);
        };
        void sent.then(forget, forget);
        inFlight.set(key, sent);
        request = sent;
      }
      const done = (): void => {
        busy.delete(rowKey);
        on().pending(rowKey, null);
      };
      request.then(
        (area) => {
          done();
          on().added(rowKey, area.name);
        },
        (error: unknown) => {
          done();
          on().refused(rowKey, { name, reason: directionAddRefusal(error) });
        },
      );
      return true;
    },
  };
};

/** What one row's box is given to offer the add (`DirectionPicker`'s `add`). */
export interface DirectionAdd {
  /** The archived areas' names — null while either list is read: nothing is offered then. */
  archived: readonly string[] | null;
  /** The name being added for this row, or null. */
  pending: string | null;
  /** The last add refused for this row — its name kept, and why — or null. */
  refused: DirectionAddRefused | null;
  onAdd: (name: string) => void;
  /** The refusal is answered (a pick, leaving the box, Escape): it is said no more. */
  onSettle: () => void;
}

const without = <V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> => {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
};

/**
 * The screen's adds (`directionAddQueue`), each row's state for its box, and the two toasts: the
 * area added (and that «تراجع» takes back the row's direction, never the area), or why not.
 * `onAdded` puts the area on the row — the LATEST one the page renders, so a row is read fresh.
 */
export const useDirectionAreaAdd = (
  onAdded: (rowKey: string, area: string) => void,
): { forRow: (rowKey: string, archived: readonly string[] | null) => DirectionAdd } => {
  const t = useT();
  const qc = useQueryClient();
  const create = useMutation(directionAreaMutation(qc));
  const [pending, setPending] = useState<ReadonlyMap<string, string>>(new Map());
  const [refused, setRefused] = useState<ReadonlyMap<string, DirectionAddRefused>>(new Map());
  const latest = useRef({ onAdded, t, mutateAsync: create.mutateAsync });
  useEffect(() => {
    latest.current = { onAdded, t, mutateAsync: create.mutateAsync };
  });
  const queue = useRef<ReturnType<typeof directionAddQueue> | null>(null);
  queue.current ??= directionAddQueue(
    (name) => latest.current.mutateAsync(name),
    () => ({
      pending: (rowKey, name) => {
        setPending((map) =>
          name === null ? without(map, rowKey) : new Map(map).set(rowKey, name),
        );
        if (name !== null) setRefused((map) => without(map, rowKey));
      },
      added: (rowKey, area) => {
        latest.current.onAdded(rowKey, area);
        toast.success(
          latest.current.t('operations.crewPlan.direction.added', { area }),
          latest.current.t('operations.crewPlan.direction.addedBody'),
        );
      },
      refused: (rowKey, refusal) => {
        setRefused((map) => new Map(map).set(rowKey, refusal));
        toast.error(
          latest.current.t(`operations.crewPlan.direction.addRefused.${refusal.reason}`, {
            text: refusal.name,
          }),
        );
      },
    }),
  );
  const adds = queue.current;

  return {
    forRow: (rowKey, archived) => ({
      archived,
      pending: pending.get(rowKey) ?? null,
      refused: refused.get(rowKey) ?? null,
      onAdd: (name) => {
        adds.add(rowKey, name);
      },
      onSettle: () => setRefused((map) => without(map, rowKey)),
    }),
  };
};
