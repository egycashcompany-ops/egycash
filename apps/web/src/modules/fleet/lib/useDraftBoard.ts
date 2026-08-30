// One board's draft: the rows the reader has changed and not yet saved.
//
// This is the EXISTING draft rule of both roster screens, moved into one place and given a
// memory. The rule itself is unchanged and still the load-bearing part:
//
//   const draft = edit.base === saved ? edit.rows : saved;
//
// A draft is held together with the server board it was taken FROM, compared by identity. So
// the draft resets itself the moment the server answers with a different board — a new date, a
// completed save — and stays put in between, which is what stops a background refetch undoing
// a drag. Derived during render rather than in an effect, because an effect runs after the
// first paint (the board would flash) and never runs at all under `renderToStaticMarkup`,
// which is how these screens are tested.
//
// What is new is only the third case: when there is no draft in hand for this board, one may
// be restored from storage. Nothing else about the flow moves.
import { useMemo, useState } from 'react';
import { clearDraft, readDraft, writeDraft, type EditableFields } from './draft-storage';

export interface DraftBoard<T> {
  /** What the screen renders and edits: the restored or in-hand draft, else the server board. */
  draft: T[];
  /** Edit the draft. Persisted immediately, so a reload finds it. */
  setDraft: (next: (rows: T[]) => T[]) => void;
  /** «إلغاء» — throw the draft away, in memory and in storage, and go back to the server's board. */
  discard: () => void;
  /** After a SUCCESSFUL save: the draft is now the saved state, so it stops being a draft. */
  accept: () => void;
}

export const useDraftBoard = <T extends { vehicleId: string }>(
  /**
   * Where this board's draft lives. For the daily roster it carries the date, and that is what
   * keeps one day's edits off another day: the read below is memoised on this key, so changing
   * the date re-reads storage instead of reusing what is in hand, and changing back finds that
   * day's own draft still there.
   */
  key: string,
  saved: readonly T[],
  /**
   * The fields a restore may take from storage, each with the shape its values must have.
   * Everything else comes from the server's row — and so does any editable field whose stored
   * value the server would refuse. See `readDraft`.
   */
  editable: EditableFields,
): DraftBoard<T> => {
  const [edit, setEdit] = useState<{ base: readonly T[]; rows: T[] }>({ base: [], rows: [] });
  // Bumped whenever this screen writes to or clears storage, so the read below re-runs. Without
  // it a restore would be computed once per (key, board) and could not see our own clear.
  const [generation, setGeneration] = useState(0);

  // `generation` is a dependency on purpose: it is the invalidation signal, not an accident of
  // the dependency array. Storage is read again when the key changes (another day), when the
  // server board changes (a save, a refetch), or when this screen itself wrote or cleared.
  const restored = useMemo(
    () => readDraft(key, saved, editable),
    [key, saved, editable, generation],
  );

  const draft = edit.base === saved ? edit.rows : (restored ?? [...saved]);

  const setDraft = (next: (rows: T[]) => T[]): void => {
    const rows = next(draft);
    setEdit({ base: saved, rows });
    writeDraft(key, rows);
    setGeneration((n) => n + 1);
  };

  const forget = (): void => {
    clearDraft(key);
    setGeneration((n) => n + 1);
  };

  return {
    draft,
    setDraft,
    // «إلغاء» must clear STORAGE as well as state. Discarding in memory alone would put the
    // work back on screen at the next reload, which is the opposite of what the button says.
    discard: (): void => {
      setEdit({ base: saved, rows: [...saved] });
      forget();
    },
    // After a save the persisted rows describe what the server now holds, so they are no longer
    // anybody's unsaved work and must not come back on the next reload. `readDraft` already
    // declines to restore a draft equal to the board — which covers the moment between the
    // cache being replaced and this call — but a server that NORMALISED something on the way in
    // would leave a real difference behind, and that difference is the server's answer, not a
    // pending edit. So the key is dropped outright rather than left to the equality check.
    accept: forget,
  };
};
