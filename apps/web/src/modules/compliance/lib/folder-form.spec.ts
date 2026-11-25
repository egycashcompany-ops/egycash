import { describe, expect, it } from 'vitest';
import { type CompliancePersonDto } from '@ecms/contracts';
import { baseNameOf, folderChanges } from './folder-form';

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
