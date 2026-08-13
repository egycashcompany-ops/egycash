// Structural invariants of the overlap warning (C1 — HR3-B).
//
// The web suite runs in `node`, so nothing here renders — and for this feature it does not need
// to. What must be guaranteed is guaranteed by the SOURCE: that every dialog that creates an
// action asks the question, that the answer changes nothing about whether the action can be
// submitted, and that both locales can say it.
//
// The middle one is the whole phase. "Warning" and "gate" differ by a single `disabled` prop, and
// a gate here would refuse work the engine has always accepted — so it is asserted, not trusted.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const SHELL = read('./ActionDialog.tsx');
const DIALOG_FILES = ['./CareerDialogs.tsx', './LifecycleDialogs.tsx', './ExitRehireDialogs.tsx'];
const QUERIES = read('../../api/employee-queries.ts');
const API = read('../../api/employee-api.ts');

/** Each `<ActionDialog …>` opening tag, props only. */
const openingTags = (source: string): string[] =>
  [...stripComments(source).matchAll(/<ActionDialog\b([\s\S]*?)>\n/g)].map((m) => m[1] as string);

describe('every action dialog asks what it would collide with', () => {
  it('declares the overlap prop naming the type it is about to create', () => {
    for (const file of DIALOG_FILES) {
      const tags = openingTags(read(file));
      expect(tags.length, file).toBeGreaterThan(0);
      for (const [index, tag] of tags.entries()) {
        expect(tag, `${file} #${String(index)}`).toContain('overlap={{ employeeId: employee.id');
      }
    }
  });

  // Eleven dialogs across three files — a new one added without the prop is a dialog that
  // silently never warns, which is exactly what the count is here to catch.
  it('and no dialog is left out', () => {
    const total = DIALOG_FILES.reduce((sum, file) => sum + openingTags(read(file)).length, 0);
    const declared = DIALOG_FILES.reduce(
      (sum, file) => sum + (stripComments(read(file)).match(/overlap=\{\{/g) ?? []).length,
      0,
    );
    expect(declared).toBe(total);
  });
});

describe('it warns, and does not gate', () => {
  const code = stripComments(SHELL);

  /**
   * The footer holds the submit button. Nothing about the overlap answer may reach it: not the
   * `disabled` flag, not the label, not the variant.
   */
  it('the submit button knows nothing about the overlap', () => {
    const start = code.indexOf('footer={');
    // …up to the end of the `<Dialog …>` opening tag, so the dialog BODY (which does mention the
    // overlap, because that is where the banner goes) stays out of the slice.
    const footer = code.slice(start, code.indexOf('\n    >', start));
    expect(start).toBeGreaterThan(0);
    expect(footer.length).toBeGreaterThan(0);
    expect(footer).not.toContain('overlap');
    expect(footer).toContain('onClick={onSubmit}');
  });

  it('the warning renders as text, with no control of its own to click', () => {
    const warning = code.slice(code.indexOf('const OverlapWarning'), code.indexOf('export const ActionDialog'));
    expect(warning.length).toBeGreaterThan(0);
    expect(warning).not.toContain('<Button');
    expect(warning).not.toContain('<button');
    expect(warning).not.toContain('onSubmit');
  });

  // No answer, no banner — a slow or failed query must not become an empty amber box.
  it('renders nothing until there is something to say', () => {
    expect(code).toContain('if (data === undefined || data.length === 0) return null;');
  });
});

describe('the question is asked only where it is needed, and re-asked when it changes', () => {
  // Under the actions subtree, which `useInvalidateAfterAction` already invalidates — creating
  // or cancelling an action is precisely what changes the answer.
  it('caches under the actions key', () => {
    expect(stripComments(QUERIES)).toContain(
      "queryKey: [MODULE, FEATURE, 'actions', id, 'overlaps', type]",
    );
    expect(stripComments(QUERIES)).toContain(
      "void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'actions', id] });",
    );
  });

  it('reads the endpoint the server actually exposes', () => {
    expect(stripComments(API)).toContain('/actions/overlaps');
  });

  // HR3-B added no permission: the warning follows `employee.view`, the key the profile it lives
  // on already required. Nothing in the dialog shell may name a key at all.
  it('names no permission of its own', () => {
    expect(stripComments(SHELL)).not.toContain("can('");
    expect(stripComments(SHELL)).not.toContain('useCan');
  });
});

describe('both locales can say it', () => {
  const KEYS = ['employees.actions.overlap.title', 'employees.actions.overlap.order'];

  it('resolves in Arabic and English', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of KEYS) {
        expect(translate(locale, key), `${locale}:${key}`).not.toBe(key);
      }
    }
  });

  it('and says something different in each — a copied English string is a missing translation', () => {
    for (const key of KEYS) {
      expect(translate('ar', key), key).not.toBe(translate('en', key));
    }
  });
});
