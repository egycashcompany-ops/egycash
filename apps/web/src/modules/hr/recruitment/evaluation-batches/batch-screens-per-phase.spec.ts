// The batch screens are ONE PHASE EACH, checked by source.
//
// A security check and a driving test are two different errands: two bodies receive them, two
// people read them, two forms carry them. The screen used to show both in one table with a
// `phase` column as the only thing telling them apart — which is why they were reported as
// "the same thing". These pin the four decisions that undid that, each of which a runtime test
// would miss because each is about what the screen REFUSES to do:
//
//   1. THE LIST IS ADDRESSED BY PHASE KEY. The navigation catalog is seeded statically and cannot
//      know an ObjectId, so the route carries the stable key and the page resolves it.
//   2. AN UNRESOLVED PHASE NEVER LISTS EVERYTHING. Firing the query before the catalog answers, or
//      after it fails to match, would show the mixed list this page exists to prevent.
//   3. THE PHASE COLUMN IS DROPPED WHEN SCOPED. Every row would carry the same value.
//   4. EVERY KEY IT PRINTS EXISTS IN BOTH LANGUAGES.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
/** Prose may describe the old behaviour; only CODE may still perform it. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const LIST = code(read('./pages/EvaluationBatchesPage.tsx'));
const DETAIL = code(read('./pages/EvaluationBatchDetailPage.tsx'));
const QUERIES = code(read('./api/evaluation-batch-queries.ts'));
const ROUTES = code(read('../routes.tsx'));

describe('the list is reached per phase', () => {
  it('routes a phase KEY, beside the unscoped list and the detail page', () => {
    expect(ROUTES).toContain('path="phase/:phaseKey"');
    expect(ROUTES).toContain('path="evaluation-batches"');
    // The detail route stays a bare `:id`; `phase` is a static segment, so no ObjectId is ever
    // mistaken for a phase key.
    expect(ROUTES).toContain('path=":id"');
  });

  it('reads the key from the route and resolves it through the phase catalog', () => {
    expect(LIST).toContain('useParams<{ phaseKey?: string }>()');
    expect(LIST).toContain('useEvaluationPhases()');
    expect(LIST).toContain('phases?.find((p) => p.key === phaseKey)');
  });

  it('sends the resolved id to the API as the phase filter', () => {
    expect(LIST).toContain('{ phaseId: phase.id }');
  });
});

describe('an unresolved phase never widens into every phase', () => {
  it('holds the query until the key resolves', () => {
    expect(LIST).toContain('awaitingPhase');
    expect(LIST).toContain('!awaitingPhase');
    // The gate has to exist on the hook, or passing it would do nothing at all.
    expect(QUERIES).toContain('enabled = true');
    expect(QUERIES).toContain('enabled,');
  });

  it('shows an unknown key as an error rather than as an unfiltered list', () => {
    expect(LIST).toContain('phaseUnknown');
    expect(LIST).toContain("t('batches.unknownPhase')");
    expect(LIST).toContain('rows={phaseUnknown ? [] : rows}');
  });
});

describe('the scoped list drops what it no longer needs', () => {
  it('renders the phase column only when unscoped', () => {
    expect(LIST).toContain('phaseKey === undefined');
    expect(LIST).toContain("key: 'phase'");
  });

  it('titles the page with the phase, not with the generic label', () => {
    expect(LIST).toContain('localized(phase.name, locale)');
  });
});

describe('the crumb returns somebody to the queue they came from', () => {
  it('points at the batch phase, never at the mixed list', () => {
    expect(DETAIL).toContain('/evaluation-batches/phase/${batch.phaseKey}');
    expect(DETAIL).not.toContain("to: '/evaluation-batches'");
  });
});

describe('translations', () => {
  it('has the new key in both languages, and they differ', () => {
    const en = translate('en', 'batches.unknownPhase');
    const ar = translate('ar', 'batches.unknownPhase');
    expect(en).not.toBe('batches.unknownPhase');
    expect(ar).not.toBe('batches.unknownPhase');
    expect(ar).not.toBe(en);
  });
});
