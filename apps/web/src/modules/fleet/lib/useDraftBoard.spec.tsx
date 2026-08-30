// The hook that makes a reload survivable — exercised, not just read.
//
// `draft-storage.spec.ts` proves the storage RULES (what restores, what is refused, which key).
// This file proves the WIRING: that a mount actually restores what is in storage, that editing
// writes, that «إلغاء» and a completed save clear. A hook whose rules are perfect and whose
// wiring is absent loses the reader's work exactly as before.
//
// The web suite has no DOM, so the hook is driven through `renderToStaticMarkup` — which runs
// `useState` and `useMemo` for one render and never runs effects. That is not a limitation
// here, it is the point: this draft is derived DURING render precisely so it works under those
// conditions, and a future rewrite that moved the restore into an effect would fail this file.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readDraft, writeDraft } from './draft-storage';
import { useDraftBoard, type DraftBoard } from './useDraftBoard';

const store = new Map<string, string>();
vi.stubGlobal('window', {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

interface Row {
  vehicleId: string;
  code: string;
  driver1EmployeeId: string | null;
}
const row = (vehicleId: string, code: string, d1: string | null = null): Row => ({
  vehicleId,
  code,
  driver1EmployeeId: d1,
});

const EDITABLE = { driver1EmployeeId: 'id' } as const;

/** Real 24-hex ids — the restore rule checks the shape, so the fixtures must hold real ones. */
const minted = new Map<string, string>();
const oid = (tag: string): string => {
  const found = minted.get(tag);
  if (found !== undefined) return found;
  const id = `6500000000000000000${String(minted.size + 1).padStart(5, '0')}`;
  minted.set(tag, id);
  return id;
};
const KEY = 'ecms.test.draft';
const BOARD: Row[] = [row('v1', '150'), row('v2', '151')];

/** Mount the hook once and hand back what it returned. */
const mount = (key = KEY, saved: readonly Row[] = BOARD): DraftBoard<Row> => {
  let captured: DraftBoard<Row> | null = null;
  const Probe = (): null => {
    captured = useDraftBoard(key, saved, EDITABLE);
    return null;
  };
  renderToStaticMarkup(<Probe />);
  if (captured === null) throw new Error('the hook did not run');
  return captured;
};

const crews = (rows: readonly Row[]): (string | null)[] => rows.map((r) => r.driver1EmployeeId);

beforeEach(() => store.clear());

describe('a fresh board', () => {
  it('starts from the server’s rows when nothing is stored', () => {
    expect(crews(mount().draft)).toEqual([null, null]);
  });

  it('writes nothing until something is edited', () => {
    mount();
    expect(store.size, 'a mount is not an edit').toBe(0);
  });
});

describe('a reload finds the work that was not saved', () => {
  it('RESTORES the stored draft on mount — this is the whole feature', () => {
    // The scenario: edit, do not save, refresh. React state is gone and the query cache is
    // empty, so the only thing that can bring the edit back is storage.
    writeDraft(KEY, [row('v1', '150', oid('e1')), row('v2', '151')]);
    expect(crews(mount().draft), 'the edit came back').toEqual([oid('e1'), null]);
  });

  it('restores it without an effect — it is there on the FIRST render', () => {
    // `renderToStaticMarkup` never runs effects. That this passes at all is the proof.
    writeDraft(KEY, [row('v1', '150', oid('e1')), row('v2', '151')]);
    expect(mount().draft[0]?.driver1EmployeeId).toBe(oid('e1'));
  });

  it('restores nothing for a board that has no stored draft', () => {
    writeDraft('ecms.test.other', [row('v1', '150', oid('e1'))]);
    expect(crews(mount().draft)).toEqual([null, null]);
  });

  it('restores the draft belonging to THIS key, not another', () => {
    writeDraft('ecms.test.day1', [row('v1', '150', oid('day-1')), row('v2', '151')]);
    writeDraft('ecms.test.day2', [row('v1', '150', oid('day-2')), row('v2', '151')]);
    expect(mount('ecms.test.day1').draft[0]?.driver1EmployeeId).toBe(oid('day-1'));
    expect(mount('ecms.test.day2').draft[0]?.driver1EmployeeId).toBe(oid('day-2'));
  });

  it('survives a stored draft that is nonsense', () => {
    store.set(KEY, '{{{ not json');
    expect(() => mount()).not.toThrow();
    expect(crews(mount().draft), 'and falls back to the server board').toEqual([null, null]);
  });
});

describe('editing writes it down', () => {
  it('persists the edit, so the NEXT mount finds it', () => {
    const board = mount();
    board.setDraft((rows) => rows.map((r) => (r.vehicleId === 'v1' ? { ...r, driver1EmployeeId: oid('e1') } : r)));
    expect(readDraft(KEY, BOARD, EDITABLE), 'it reached storage').not.toBeNull();
    expect(crews(mount().draft), 'and a reload brings it back').toEqual([oid('e1'), null]);
  });
});

describe('discarding and saving both end the draft', () => {
  const withDraft = (): DraftBoard<Row> => {
    writeDraft(KEY, [row('v1', '150', oid('e1')), row('v2', '151')]);
    return mount();
  };

  it('«إلغاء» clears STORAGE, so the work does not come back on the next reload', () => {
    // Discarding in memory alone would put the edits back on screen after a refresh, which is
    // the opposite of what the button says.
    withDraft().discard();
    expect(store.get(KEY), 'the key is gone').toBeUndefined();
    expect(crews(mount().draft), 'and the board is the server’s again').toEqual([null, null]);
  });

  it('a completed save clears it too — saved work is not a draft', () => {
    withDraft().accept();
    expect(store.get(KEY)).toBeUndefined();
    expect(crews(mount().draft), 'a later reload reads the server, not the old draft').toEqual([
      null,
      null,
    ]);
  });

  it('accepting one board does not throw away another’s', () => {
    writeDraft('ecms.test.day1', [row('v1', '150', oid('a')), row('v2', '151')]);
    writeDraft('ecms.test.day2', [row('v1', '150', oid('b')), row('v2', '151')]);
    mount('ecms.test.day1').accept();
    expect(store.has('ecms.test.day1')).toBe(false);
    expect(mount('ecms.test.day2').draft[0]?.driver1EmployeeId, 'day 2 is untouched').toBe(oid('b'));
  });
});

describe('the draft never invents server state', () => {
  it('takes a vehicle the draft never mentioned from the server', () => {
    writeDraft(KEY, [row('v1', '150', oid('e1'))]);
    const grown = [...BOARD, row('v3', '152', oid('from-server'))];
    expect(crews(mount(KEY, grown).draft)).toEqual([oid('e1'), null, oid('from-server')]);
  });

  it('holds no draft at all before the board arrives', () => {
    writeDraft(KEY, [row('v1', '150', oid('e1'))]);
    expect(mount(KEY, []).draft, 'nothing to restore against yet').toEqual([]);
  });
});
