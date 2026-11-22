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
// box says the refusal itself, in place, with the typed text kept — one message, not two: a toast
// only when that box no longer has the focus (Round 28c critic — it said it twice, both alerts).
//
// Round 28c critic — an add belongs to ONE row on ONE board: its `scope` (the board's day; the
// standing crew's one board) and the row's direction when it was sent (`from`). The area lands on
// the row only if both still hold — a day stepped, the row gone (a «حفظ» read-back renames a new
// row), or its direction changed by another route meanwhile, and the toast says the area was added
// but the row not changed. A refusal is said for that row while its direction is still `from`, and
// on that day: «تراجع», «تحميل الطاقم الثابت», another day end it.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { foldOperationsAreaName, type OperationsAreaDto, type Paginated } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { featureKey, listKey } from '../../../shared/lib/query-keys';
import { toast } from '../../../shared/ui/toast/toast-store';
import { fetchWholeCatalog } from '../../fleet/lib/whole-catalog';
import {
  directionAddHeld,
  directionAddRefusal,
  directionAddRefusalText,
  type DirectionAddRefused,
} from '../lib/direction-pick';
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
  // Read again whatever the answer, and BEFORE the row is told: a 409 is an area that holds the
  // name (added meanwhile, or archived), which the box then offers or names; a success is listed,
  // so the row's direction is no hand-typed text.
  onSettled: () => qc.invalidateQueries({ queryKey: featureKey(MODULE, 'areas') }),
  // The box says a refusal in place; declaring this keeps the global notifier quiet.
  onError: (): void => undefined,
});

/** What happens to one row's add, told to the screen. */
export interface DirectionAddEvents {
  /** The name being written for the row — null once the catalog has answered. */
  pending: (rowKey: string, name: string | null) => void;
  /** The catalog has the area: its OWN spelling, for the row — `from`, its direction at the send. */
  added: (rowKey: string, area: string, from: string | null) => void;
  refused: (rowKey: string, refusal: DirectionAddRefused, from: string | null) => void;
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
    /** `from` — the row's direction as the add is sent, handed back with the answer. */
    add: (rowKey: string, name: string, from: string | null = null): boolean => {
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
          on().added(rowKey, area.name, from);
        },
        (error: unknown) => {
          done();
          const refusal = {
            name,
            reason: directionAddRefusal(error),
            held: directionAddHeld(error),
          };
          on().refused(rowKey, refusal, from);
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

/** One row on one board — the key every add, pending name and refusal is held under. */
export const directionAddSlot = (scope: string, rowKey: string): string =>
  JSON.stringify([scope, rowKey]);
const slotOf = (slot: string): { scope: string; rowKey: string } => {
  const [scope, rowKey] = JSON.parse(slot) as [string, string];
  return { scope, rowKey };
};

/** A refusal held for a row: said while the row's direction is still `from`, the one it was sent on. */
export interface HeldRefusal {
  refusal: DirectionAddRefused;
  from: string | null;
}

/** A refusal still describes its row while the row holds the direction it was sent on. */
export const refusalStillHolds = (held: HeldRefusal | undefined, direction: string | null) =>
  held !== undefined && held.from === direction ? held.refusal : null;

/**
 * May an added area go on its row? The row is still on the board and still holds the direction the
 * add was sent on — not gone (removed, or renamed by a «حفظ» read-back), not changed meanwhile by
 * another route («تحميل الطاقم الثابت», another box): a newer change is never written over.
 */
export const addLandsOn = (
  rows: readonly { key: string; direction: string | null }[],
  rowKey: string,
  from: string | null,
): boolean => {
  const row = rows.find((candidate) => candidate.key === rowKey);
  return row !== undefined && row.direction === from;
};

/** What the screen's add events reach — the hook's state and the page, a seam a spec can fake. */
export interface DirectionAddScreen {
  /** The board's day now (one value for a board of one day). */
  scope: () => string;
  /** The page puts the area on the row — and answers whether it did (`addLandsOn`). */
  onAdded: (rowKey: string, area: string, from: string | null) => boolean;
  t: (key: string, params?: Record<string, string>) => string;
  /** The row whose «الاتجاه» box has the focus, or null. */
  focusedRow: () => string | null;
  pend: (slot: string, name: string | null) => void;
  hold: (slot: string, held: HeldRefusal) => void;
  forget: (slot: string) => void;
  toast: {
    success: (title: string, body?: string) => void;
    error: (title: string, body?: string) => void;
  };
}

/**
 * The adds' events for one screen (`directionAddQueue`'s `on`), keyed by `directionAddSlot`. An
 * add lands only on its own day, on its row as it was (`onAdded`); the success toast says whether
 * the row took it. A refusal is held for the row on its own day, and said by the box that still has
 * the focus — else by a toast, once.
 */
export const directionAddScreenEvents = (screen: DirectionAddScreen): DirectionAddEvents => ({
  pending: (slot, name) => {
    screen.pend(slot, name);
    if (name !== null) screen.forget(slot);
  },
  added: (slot, area, from) => {
    const { scope, rowKey } = slotOf(slot);
    const placed = scope === screen.scope() && screen.onAdded(rowKey, area, from);
    screen.toast.success(
      screen.t('operations.crewPlan.direction.added', { area }),
      screen.t(
        placed
          ? 'operations.crewPlan.direction.addedBody'
          : 'operations.crewPlan.direction.addedNotPlaced',
        { area },
      ),
    );
  },
  refused: (slot, refusal, from) => {
    const { scope, rowKey } = slotOf(slot);
    // Held for the row on its own day only — another day's board never shows it.
    const here = scope === screen.scope();
    if (here) screen.hold(slot, { refusal, from });
    // The box that still has the focus says it in place; else the toast does.
    if (here && screen.focusedRow() === rowKey) return;
    // A short title (a toast's title is one line, cut), the whole reason under it.
    const said = directionAddRefusalText(refusal);
    screen.toast.error(
      screen.t('operations.crewPlan.direction.addRefusedTitle', { text: refusal.name }),
      screen.t(said.key, said.vars),
    );
  },
});

/** The row whose «الاتجاه» box has the focus (`data-direction-picker`), or null. */
const focusedDirectionRow = (): string | null => {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  return active?.closest('[data-direction-picker]')?.getAttribute('data-direction-picker') ?? null;
};

/**
 * The screen's adds (`directionAddQueue`), each row's state for its box, and the toasts: the area
 * added (and that «تراجع» takes back the row's direction, never the area) — or added but the row
 * not changed — or why not. `scope` is the board's day (one value for a board of one day); an add
 * lands only on its own day. `onAdded` puts the area on the row if the row still holds `from` —
 * the LATEST render's, so a row is read fresh — and answers whether it did.
 */
export const useDirectionAreaAdd = (
  scope: string,
  onAdded: (rowKey: string, area: string, from: string | null) => boolean,
): {
  forRow: (
    rowKey: string,
    direction: string | null,
    archived: readonly string[] | null,
  ) => DirectionAdd;
} => {
  const t = useT();
  const qc = useQueryClient();
  const create = useMutation(directionAreaMutation(qc));
  const [pending, setPending] = useState<ReadonlyMap<string, string>>(new Map());
  const [refused, setRefused] = useState<ReadonlyMap<string, HeldRefusal>>(new Map());
  const latest = useRef({ onAdded, t, scope, mutateAsync: create.mutateAsync });
  useEffect(() => {
    latest.current = { onAdded, t, scope, mutateAsync: create.mutateAsync };
  });
  // Another day: every refusal said is about the day left.
  useEffect(() => {
    setRefused((map) => (map.size === 0 ? map : new Map()));
  }, [scope]);
  // Refusals whose row has since taken another direction (seen by `forRow`), dropped after render.
  const stale = useRef<string[]>([]);
  useEffect(() => {
    if (stale.current.length === 0) return;
    const gone = stale.current;
    stale.current = [];
    setRefused((map) => gone.reduce((next, slot) => without(next, slot), map));
  });
  const queue = useRef<ReturnType<typeof directionAddQueue> | null>(null);
  queue.current ??= directionAddQueue(
    (name) => latest.current.mutateAsync(name),
    () =>
      directionAddScreenEvents({
        scope: () => latest.current.scope,
        onAdded: (rowKey, area, from) => latest.current.onAdded(rowKey, area, from),
        t: (key, params) => latest.current.t(key, params),
        focusedRow: focusedDirectionRow,
        pend: (slot, name) =>
          setPending((map) => (name === null ? without(map, slot) : new Map(map).set(slot, name))),
        hold: (slot, held) => setRefused((map) => new Map(map).set(slot, held)),
        forget: (slot) => setRefused((map) => without(map, slot)),
        toast,
      }),
  );
  const adds = queue.current;

  return {
    forRow: (rowKey, direction, archived) => {
      const slot = directionAddSlot(scope, rowKey);
      const held = refused.get(slot);
      const holds = refusalStillHolds(held, direction);
      if (held !== undefined && holds === null) stale.current.push(slot);
      return {
        archived,
        pending: pending.get(slot) ?? null,
        refused: holds,
        onAdd: (name) => {
          adds.add(slot, name, direction);
        },
        onSettle: () => setRefused((map) => without(map, slot)),
      };
    },
  };
};
