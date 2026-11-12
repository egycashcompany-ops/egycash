// «سجل الخزينة» — whether «تقرير الخزينة»'s band is open, kept per viewer.
//
// WHY IT FOLDS. The band takes a fixed third of the screen so the history under it keeps the rest —
// but on a 1366×768 screen "the rest" is about two rows of history. A treasurer who has read what
// the vault holds and is now working down the history folds the report away, the way the boards'
// «إخفاء الإحصائيات» folds the figures, and the history takes the room.
//
// WHY IT IS REMEMBERED HERE AND NOT IN THE URL. It changes only what is drawn, never which rows are
// counted, so it is a preference of this browser (the map's layers are the precedent,
// `atm/lib/map-prefs.ts`), under its own key — not a filter, and never part of a link somebody else
// opens. Open by default: the report is the screen's top half, and a first visit shows it.
//
// Every access is wrapped (the `useRememberedFilters` precedent): private mode, a full quota or
// storage switched off leaves the default, and nothing breaks.

export const HELD_BAND_KEY = 'ecms.operations.vaultHistory.reportOpen';

export type PrefStorage = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): PrefStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** What this browser kept: closed only when it says so — anything else is the default, open. */
export const loadHeldBandOpen = (storage: PrefStorage | null = browserStorage()): boolean => {
  try {
    return storage?.getItem(HELD_BAND_KEY) !== '0';
  } catch {
    return true;
  }
};

export const saveHeldBandOpen = (
  open: boolean,
  storage: PrefStorage | null = browserStorage(),
): void => {
  try {
    storage?.setItem(HELD_BAND_KEY, open ? '1' : '0');
  } catch {
    /* not remembering is not an error worth showing anyone */
  }
};

/**
 * Is the band drawn? What the viewer chose — unless nothing comes under it. A treasurer who may not
 * read the history (no `operationsShipment.view`) has the report as the whole screen and no board
 * toolbar to fold it from, so it is always open for him, whatever this browser remembers from
 * another viewer.
 */
export const heldBandShown = (remembered: boolean, canSeeHistory: boolean): boolean =>
  !canSeeHistory || remembered;
