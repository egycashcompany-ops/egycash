// The zone editor's draft, kept on this device (docs/12-planning/atm-map-zones.md DM-29, §8.5).
//
// Leaving the page through a module switch or the idle logout cannot be intercepted (`navigate()`
// is not an anchor), so the draft is written to `localStorage` after each history step and offered
// back on the next visit — but only when it was drawn on the revision the server still has. A draft
// on an older revision would re-apply edits over somebody else's save, so it is announced as
// outdated and cleared instead.
//
// THE KEY CARRIES THE USER. `ecms.atmMap.zoneDraft.<userId>.<branchId>`: on a shared browser another
// account is never offered this user's draft (critic S-22).
//
// Every access is wrapped (the `useRememberedFilters` precedent): private mode, a full quota or
// disabled storage must never break the editor. `saveDraft` says whether the draft was kept, so the
// conflict dialog does not promise a draft "kept on this device" that is not (§8.8).
import { type AtmMapLatLng } from '@ecms/contracts';
import { type DraftZone } from './zone-editor';

export interface StoredDraft {
  baseRevision: number;
  draft: DraftZone[];
  savedAt: string;
}

/** The part of `Storage` this file uses — injectable, so a suite can hand in one that throws. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const draftKey = (userId: string, branchId: string): string =>
  `ecms.atmMap.zoneDraft.${userId}.${branchId}`;

const browserStorage = (): DraftStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const isPoint = (value: unknown): value is AtmMapLatLng =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as AtmMapLatLng).lat) &&
  Number.isFinite((value as AtmMapLatLng).lng);

const isZone = (value: unknown): value is DraftZone => {
  if (typeof value !== 'object' || value === null) return false;
  const zone = value as DraftZone;
  return (
    typeof zone.id === 'string' &&
    typeof zone.name === 'string' &&
    typeof zone.color === 'string' &&
    Array.isArray(zone.points) &&
    zone.points.every(isPoint)
  );
};

/** What is stored for (user, branch), or null — nothing stored, unreadable, or not a draft. */
export const loadDraft = (
  userId: string,
  branchId: string,
  storage: DraftStorage | null = browserStorage(),
): StoredDraft | null => {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(draftKey(userId, branchId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (
      typeof parsed.baseRevision !== 'number' ||
      typeof parsed.savedAt !== 'string' ||
      !Array.isArray(parsed.draft) ||
      !parsed.draft.every(isZone)
    ) {
      return null;
    }
    return { baseRevision: parsed.baseRevision, draft: parsed.draft, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
};

/** Keep the draft; `false` when storage refused it (quota, private mode, disabled). */
export const saveDraft = (
  userId: string,
  branchId: string,
  value: StoredDraft,
  storage: DraftStorage | null = browserStorage(),
): boolean => {
  if (storage === null) return false;
  try {
    storage.setItem(draftKey(userId, branchId), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const clearDraft = (
  userId: string,
  branchId: string,
  storage: DraftStorage | null = browserStorage(),
): void => {
  if (storage === null) return;
  try {
    storage.removeItem(draftKey(userId, branchId));
  } catch {
    /* a draft that cannot be cleared is offered once more, and its revision check still holds */
  }
};

/**
 * What to do with a stored draft when the editor opens on `revision`: offer it («استعادة المسودة /
 * تجاهلها»), announce it as outdated and clear it, or nothing.
 */
export const draftOffer = (
  stored: StoredDraft | null,
  revision: number,
): 'restore' | 'outdated' | null => {
  if (stored === null) return null;
  return stored.baseRevision === revision ? 'restore' : 'outdated';
};

/**
 * What the page does with the stored draft after a render (DM-29; §8.6 "after each history push"):
 *   · nothing while a drag is under way — one write per finished gesture, and never a shape the
 *     gesture's end may still put back;
 *   · keep the draft when it differs from the loaded set;
 *   · clear it when it does not — except while a stored draft is still offered («استعادة المسودة /
 *     تجاهلها»): opening the editor changes nothing, and the person has not chosen yet.
 */
export const autosaveAction = (state: {
  gestureActive: boolean;
  offerPending: boolean;
  dirty: number;
}): 'none' | 'save' | 'clear' => {
  if (state.gestureActive) return 'none';
  if (state.dirty > 0) return 'save';
  return state.offerPending ? 'none' : 'clear';
};
