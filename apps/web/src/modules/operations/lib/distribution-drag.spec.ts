// Round 25 — «لما بعمل دراج و دروب لل محصنة على العربيه مش بتتحط بتتحط فى حالة دوست على نقل الى بس غير
// كدا مفيش حاجه بتتغير». What a drag on «توزيع المحصنات» carries, where it lands and what the drop does
// — the crew board's rules (Round 22), pinned for this screen.
import { describe, expect, it } from 'vitest';
import { translate } from '../../../platform/localization/i18n';
import {
  SHIPMENT_DRAG_TYPE,
  acceptsShipmentDragOver,
  beginShipmentDrag,
  dropRefusalToast,
  dropTargetFromMarks,
  dropTargetKey,
  droppedShipment,
  resolveShipmentDrop,
  type DropVan,
} from './distribution-drag';

const VANS: Record<string, DropVan> = {
  'cr-101': { crewAssignmentId: 'cr-101', captains: [{}], securedType: true },
  'cr-104': { crewAssignmentId: 'cr-104', captains: [{}, {}], securedType: true },
  'cr-130': { crewAssignmentId: 'cr-130', captains: [], securedType: true },
  'cr-106': { crewAssignmentId: 'cr-106', captains: [{}], securedType: false },
};
const vanOf = (id: string): DropVan | undefined => VANS[id];

describe('what a chip’s dragstart writes', () => {
  it('the id under our type AND as text/plain, and copyMove — nothing else', () => {
    const written: Record<string, string> = {};
    const data = {
      setData: (format: string, value: string) => {
        written[format] = value;
      },
      effectAllowed: 'none' as DataTransfer['effectAllowed'],
    };
    beginShipmentDrag(data, 's-1');
    expect(written).toEqual({ [SHIPMENT_DRAG_TYPE]: 's-1', 'text/plain': 's-1' });
    // A hook that takes MOVE away leaves a move-only drag with nothing; copyMove keeps COPY.
    expect(data.effectAllowed).toBe('copyMove');
  });
});

describe('which shipment a drop carries', () => {
  const known = (id: string): boolean => id === 's-1' || id === 's-2';

  it('our own drag’s id first — whatever the browser shows of the drag', () => {
    expect(droppedShipment({ own: 's-1', custom: '', text: '' }, known)).toBe('s-1');
    expect(droppedShipment({ own: 's-1', custom: 's-2', text: 's-2' }, known)).toBe('s-1');
  });

  it('then our type, then text/plain — a PC whose hook drops our type still drops', () => {
    expect(droppedShipment({ own: null, custom: 's-2', text: '' }, known)).toBe('s-2');
    expect(droppedShipment({ own: null, custom: '', text: ' s-2 ' }, known)).toBe('s-2');
  });

  it('a text from another window, or nothing, is no shipment', () => {
    expect(droppedShipment({ own: null, custom: '', text: 'hello' }, known)).toBeNull();
    expect(droppedShipment({ own: null, custom: '', text: '' }, known)).toBeNull();
  });
});

describe('the screen accepts OUR drag everywhere, and only ours', () => {
  it('a drag of ours is accepted wherever the pointer is — the browser’s last answer stays «yes»', () => {
    expect(acceptsShipmentDragOver('s-1')).toBe(true);
  });

  it('a file, a link or a text from elsewhere is left to the browser', () => {
    expect(acceptsShipmentDragOver(null)).toBe(false);
  });
});

describe('where a drop lands — the marks under the pointer', () => {
  it('anywhere on a van card is that van — its head, its captain’s line, its empty load, a chip on it', () => {
    expect(dropTargetFromMarks({ van: 'cr-101', unplaced: false })).toEqual({
      kind: 'van',
      crewAssignmentId: 'cr-101',
    });
    // A van card inside the vans' column, never the left one; the nearest van wins.
    expect(dropTargetFromMarks({ van: 'cr-101', unplaced: true })).toEqual({
      kind: 'van',
      crewAssignmentId: 'cr-101',
    });
  });

  it('anywhere on the left column — its head too — takes it off its van', () => {
    expect(dropTargetFromMarks({ van: null, unplaced: true })).toEqual({ kind: 'unplaced' });
  });

  it('elsewhere — the toolbar, the day bar, the gap between the vans — is no target', () => {
    expect(dropTargetFromMarks({ van: null, unplaced: false })).toBeNull();
    expect(dropTargetFromMarks({ van: '', unplaced: false })).toBeNull();
  });

  it('a target as one key, the page’s «under the pointer» state', () => {
    expect(dropTargetKey({ kind: 'van', crewAssignmentId: 'cr-101' })).toBe('van|cr-101');
    expect(dropTargetKey({ kind: 'unplaced' })).toBe('unplaced');
    expect(dropTargetKey(null)).toBeNull();
  });
});

describe('what a drop does', () => {
  const van = (crewAssignmentId: string) => ({ kind: 'van' as const, crewAssignmentId });

  it('unplaced → a van with a captain: placed', () => {
    expect(resolveShipmentDrop(null, van('cr-101'), vanOf)).toEqual({
      kind: 'place',
      crewAssignmentId: 'cr-101',
    });
  });

  it('a van → another van: placed there', () => {
    expect(resolveShipmentDrop('cr-101', van('cr-104'), vanOf)).toEqual({
      kind: 'place',
      crewAssignmentId: 'cr-104',
    });
  });

  it('a van → the left column: taken off', () => {
    expect(resolveShipmentDrop('cr-101', { kind: 'unplaced' }, vanOf)).toEqual({
      kind: 'unplace',
    });
  });

  it('dropped where it already is — its own van, or the left for one on none: nothing', () => {
    expect(resolveShipmentDrop('cr-101', van('cr-101'), vanOf)).toEqual({ kind: 'stay' });
    expect(resolveShipmentDrop(null, { kind: 'unplaced' }, vanOf)).toEqual({ kind: 'stay' });
  });

  it('a van without a captain refuses — and says why', () => {
    expect(resolveShipmentDrop(null, van('cr-130'), vanOf)).toEqual({
      kind: 'refuse',
      crewAssignmentId: 'cr-130',
      reason: 'noCaptain',
    });
  });

  it('a row that is not «محصنة», kept for what it carries, refuses a new one', () => {
    expect(resolveShipmentDrop(null, van('cr-106'), vanOf)).toEqual({
      kind: 'refuse',
      crewAssignmentId: 'cr-106',
      reason: 'notSecured',
    });
    // Off it, it lets go.
    expect(resolveShipmentDrop('cr-106', { kind: 'unplaced' }, vanOf)).toEqual({
      kind: 'unplace',
    });
  });

  // Critic — a محصنة SAVED on a kept row, moved off it in the draft, could not come back by a drag:
  // the save takes it there (its keep rule: the leg is already on that very row).
  it('a row that is not «محصنة» takes BACK the shipment saved on it — and only that one', () => {
    for (const at of ['cr-101', null]) {
      expect(resolveShipmentDrop(at, van('cr-106'), vanOf, false, 'cr-106')).toEqual({
        kind: 'place',
        crewAssignmentId: 'cr-106',
      });
    }
    // Saved elsewhere, or on none: still refused.
    expect(resolveShipmentDrop('cr-101', van('cr-106'), vanOf, false, 'cr-101')).toEqual({
      kind: 'refuse',
      crewAssignmentId: 'cr-106',
      reason: 'notSecured',
    });
    expect(resolveShipmentDrop(null, van('cr-106'), vanOf, false, null)).toMatchObject({
      kind: 'refuse',
      reason: 'notSecured',
    });
    // Its saved row on a van that has lost its captain: still no.
    expect(resolveShipmentDrop(null, van('cr-130'), vanOf, false, 'cr-130')).toMatchObject({
      kind: 'refuse',
      reason: 'noCaptain',
    });
    // A started leg moves nowhere.
    expect(resolveShipmentDrop('cr-101', van('cr-106'), vanOf, true, 'cr-106')).toEqual({
      kind: 'stay',
    });
  });

  it('off the targets, onto a van the screen no longer lists, or a leg the captain started: nothing', () => {
    expect(resolveShipmentDrop(null, null, vanOf)).toEqual({ kind: 'stay' });
    expect(resolveShipmentDrop(null, van('cr-gone'), vanOf)).toEqual({ kind: 'stay' });
    expect(resolveShipmentDrop('cr-101', van('cr-104'), vanOf, true)).toEqual({ kind: 'stay' });
  });
});

describe('a refused drop, said in full (verifier)', () => {
  // The toaster cuts a toast's TITLE to one line: «السيارة 106: هذا الصف ليس من نوع محصنة، فلا يأخذ …»
  // lost the end of the reason. The van is the title; the reason, whole, is the description.
  for (const locale of ['ar', 'en'] as const) {
    const t = (key: string): string => translate(locale, key);
    it(`[${locale}] the van as the title, the whole reason under it — no placeholder left`, () => {
      const notSecured = dropRefusalToast('notSecured', 'السيارة 106', t);
      expect(notSecured.title).toBe('السيارة 106');
      expect(notSecured.description).toBe(t('operations.distribution.notSecuredDrop'));
      const noCaptain = dropRefusalToast('noCaptain', 'بدون سيارة (2)', t);
      expect(noCaptain.title).toBe('بدون سيارة (2)');
      expect(noCaptain.description).toBe(t('operations.distribution.noCaptainDrop'));
      for (const words of [notSecured, noCaptain]) {
        expect(words.description).not.toMatch(/\{\{|operations\./);
        expect(words.description.length).toBeGreaterThan(20);
      }
      expect(notSecured.description).not.toBe(noCaptain.description);
    });
  }
  it('[ar] the reason ends where the sentence does — «محصنات جديدة.», «محصنات.»', () => {
    const t = (key: string): string => translate('ar', key);
    expect(dropRefusalToast('notSecured', 'x', t).description).toMatch(/محصنات جديدة\.$/);
    expect(dropRefusalToast('noCaptain', 'x', t).description).toMatch(/محصنات\.$/);
  });
});
