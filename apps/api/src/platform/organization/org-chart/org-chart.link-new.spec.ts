import { describe, expect, it } from 'vitest';
import { decideLink } from './org-chart.link-new';

const entry = (id: string, ar: string, en = ar, status: 'active' | 'inactive' = 'active') => ({
  id,
  code: id.toUpperCase(),
  name: { ar, en },
  status,
});
const none = (): boolean => false;

describe('linking a NEW row at creation (P-ORG-3 §5.6)', () => {
  it('links to the one active entry its name folds to', () => {
    const decision = decideLink({ name: { ar: 'نقل الاموال', en: 'Cash' } }, [entry('e1', 'نقل الأموال')], [], none);
    expect(decision).toEqual({ kind: 'link', entryId: 'e1' });
  });

  it('creates an entry for a name the company does not have yet', () => {
    expect(decideLink({ name: { ar: 'الجودة', en: 'Quality' } }, [entry('e1', 'العمليات')], [], none)).toEqual({
      kind: 'create',
    });
  });

  it('leaves the row unlinked, as before, in every case the operator command owns', () => {
    const name = { ar: 'العمليات', en: 'Operations' };
    // Two entries fold alike.
    expect(decideLink({ name }, [entry('e1', 'العمليات'), entry('e2', 'العمليات ')], [], none).kind).toBe('leave');
    // This branch already has a row linked to it.
    expect(decideLink({ name }, [entry('e1', 'العمليات')], [], (id) => id === 'e1').kind).toBe('leave');
    // An unlinked row of that name exists: that group is the command's to link.
    expect(decideLink({ name }, [], [{ name, catalogId: null }], none).kind).toBe('leave');
    // An entry has exactly this English name while none folds the same (the fold reads the Arabic):
    // creating a second entry would clash on the catalog's own rule.
    expect(decideLink({ name: { ar: 'جديدة', en: 'Quality' } }, [entry('e1', 'الجودة', 'Quality')], [], none).kind).toBe(
      'leave',
    );
    expect(
      decideLink({ name: { ar: 'جديدة', en: 'Quality' } }, [entry('e1', 'أخرى', 'quality', 'inactive')], [], none).kind,
    ).toBe('leave');
  });

  it('never links to a stopped entry', () => {
    const decision = decideLink({ name: { ar: 'العمليات', en: 'Ops' } }, [entry('e1', 'العمليات', 'Ops', 'inactive')], [], none);
    // The stopped entry does not match by fold, and its exact name blocks a second one.
    expect(decision.kind).toBe('leave');
  });
});
