import { describe, expect, it } from 'vitest';
import { type CompliancePersonDto } from '@ecms/contracts';
import { baseNameOf, carryFolderEdits, folderChanges } from './folder-form';

const person = (userId: string): CompliancePersonDto => ({
  userId,
  name: { ar: 'م', en: 'M' },
  username: null,
  isActive: true,
});

describe('what a folder edit sends', () => {
  const folder = { name: 'العقود', viewers: [person('a'), person('b')] };

  it('is nothing when nothing changed — the list in another order included', () => {
    expect(folderChanges(folder, ' العقود ', ['b', 'a'])).toBeNull();
  });

  it('is the new name alone, trimmed', () => {
    expect(folderChanges(folder, ' عقود 2026 ', ['a', 'b'])).toEqual({ name: 'عقود 2026' });
  });

  it('is the new list alone, as chosen', () => {
    expect(folderChanges(folder, 'العقود', ['a'])).toEqual({ viewerUserIds: ['a'] });
    expect(folderChanges(folder, 'العقود', ['a', 'b', 'c'])).toEqual({
      viewerUserIds: ['a', 'b', 'c'],
    });
  });
});

describe('a file’s own name', () => {
  it('drops the extension and keeps a name without one', () => {
    expect(baseNameOf('سياسة الالتزام.docx')).toBe('سياسة الالتزام');
    expect(baseNameOf('report.final.pdf')).toBe('report.final');
    expect(baseNameOf('.hidden')).toBe('.hidden');
    expect(baseNameOf('README')).toBe('README');
  });
});

describe('a save refused because the folder was saved elsewhere', () => {
  const opened = { name: 'العقود', viewers: [person('a'), person('b')] };

  it('keeps what this person changed and takes everything else from the folder as it now is', () => {
    // This person added c and renamed it; someone else meanwhile took b off and added d.
    const fresh = { name: 'العقود', viewers: [person('a'), person('d')] };
    const carried = carryFolderEdits(
      opened,
      { name: 'عقود 2026', viewers: [person('a'), person('b'), person('c')] },
      fresh,
    );
    expect(carried.name).toBe('عقود 2026');
    // b stays off — the other save took it away, and this person did not add it back.
    expect(carried.viewers.map((p) => p.userId)).toEqual(['a', 'd', 'c']);
  });

  it('takes the new name when this person left the name alone', () => {
    const fresh = { name: 'عقود الموردين', viewers: opened.viewers };
    expect(carryFolderEdits(opened, { name: 'العقود', viewers: opened.viewers }, fresh).name).toBe(
      'عقود الموردين',
    );
  });

  it('keeps a removal this person made, even of someone the other save kept', () => {
    const fresh = { name: 'العقود', viewers: [person('a'), person('b'), person('e')] };
    const carried = carryFolderEdits(opened, { name: 'العقود', viewers: [person('a')] }, fresh);
    expect(carried.viewers.map((p) => p.userId)).toEqual(['a', 'e']);
  });
});
