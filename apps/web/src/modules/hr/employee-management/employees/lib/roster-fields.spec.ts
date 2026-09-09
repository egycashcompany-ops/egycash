// A preview an HR manager cannot read is not a preview.
import { describe, expect, it } from 'vitest';
import { isHiddenFromPreview, rosterFieldLabel, visibleChanges } from './roster-fields';

const t = (key: string): string => `T:${key}`;

describe('naming a changed field', () => {
  it('gives a document path a human name', () => {
    expect(rosterFieldLabel(t, 'personal.contact.primaryPhone')).toBe(
      'T:employees.roster.field.primaryPhone',
    );
  });

  it('names placement with the same words the list column uses', () => {
    expect(rosterFieldLabel(t, 'employment.departmentId')).toBe('T:employees.columns.department');
  });

  /** A missing label is a mapping to add. Showing the path is how somebody notices. */
  it('falls back to the path rather than to a blank or a guess', () => {
    expect(rosterFieldLabel(t, 'personal.somethingNew')).toBe('personal.somethingNew');
  });
});

describe('what the preview folds away', () => {
  /** A move writes both the employment block and the top-level mirror. It is ONE move. */
  it('hides the top-level placement mirrors', () => {
    expect(isHiddenFromPreview('departmentId')).toBe(true);
    expect(isHiddenFromPreview('employment.departmentId')).toBe(false);
  });

  it('hides the search name, which only ever moves with the name above it', () => {
    expect(isHiddenFromPreview('personal.searchName')).toBe(true);
  });

  it('shows a department move exactly once', () => {
    const changes = [
      { path: 'employment.departmentId' },
      { path: 'departmentId' },
      { path: 'personal.contact.primaryPhone' },
    ];
    expect(visibleChanges(changes).map((c) => c.path)).toEqual([
      'employment.departmentId',
      'personal.contact.primaryPhone',
    ]);
  });

  it('shows a rename once, not twice', () => {
    const changes = [{ path: 'personal.fullNameAr' }, { path: 'personal.searchName' }];
    expect(visibleChanges(changes).map((c) => c.path)).toEqual(['personal.fullNameAr']);
  });
});
