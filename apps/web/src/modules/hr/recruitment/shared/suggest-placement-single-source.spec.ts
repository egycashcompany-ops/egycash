// One "اقتراح وظيفة وفرع" button, and no second one.
//
// There were three. On the applicant detail screen two of them were visible at once and read as the
// same sentence in Arabic — "اقتراح وظيفة" beside "اقتراح وظيفة وفرع" — and the third, on the same
// page header, called the identical function "إعادة التعيين". Every one of them worked, so no
// behavioural test could have caught it: the defect was that the app offered one action under three
// names, one of which quietly meant something else (a wish recorded on a stage record that moved
// nobody).
//
// This is the same guard the applicant picker and the branch filter carry, for the same reason: the
// realistic failure is not a bad edit but a well-meant local copy, and a copy is invisible to
// typecheck, lint and every behavioural test in the suite.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../../../');
const DEFINITION = join(HERE, 'SuggestPlacementButton.tsx');
const DIALOG = resolve(HERE, '../applicants/components/ReassignDialog.tsx');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.spec.tsx') ? [full] : [];
  });

const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const rel = (path: string): string => relative(SRC, path);

describe('the suggest-placement action has a single source', () => {
  it('is defined exactly once in the whole app', () => {
    const definitions = files
      .filter((f) => /export const SuggestPlacementButton\b/.test(f.text))
      .map((f) => rel(f.path));
    expect(definitions).toEqual([rel(DEFINITION)]);
  });

  it('owns the label, so nothing else can render a button that says the same thing', () => {
    // The i18n key rather than the Arabic text: a second button would be written in code, and
    // whoever writes it will reach for the key. A raw Arabic string would fail the next check.
    const users = files.filter((f) => f.text.includes("'recommendation.suggest'")).map((f) => rel(f.path));
    expect(users).toEqual([rel(DEFINITION)]);
  });

  it('is the only screen surface that opens the reassign dialog for one candidate', () => {
    // The bulk dialog is a different action over a selection and has its own component; this is
    // about the single-candidate path, which is what grew three entry points.
    const renderers = files.filter((f) => f.text.includes('<ReassignDialog')).map((f) => rel(f.path));
    expect(renderers).toEqual([rel(DEFINITION)]);
  });

  it('is imported from that definition by every screen that renders it', () => {
    const renderers = files.filter(
      (f) => f.text.includes('<SuggestPlacementButton') && f.path !== DEFINITION,
    );
    // Only the shared card, which every stage screen already uses. If this grows, a screen has
    // started rendering the action beside the card instead of through it — which is exactly how
    // the applicant page ended up with two.
    expect(renderers.map((f) => rel(f.path))).toEqual([rel(join(HERE, 'RecommendationCard.tsx'))]);

    for (const file of renderers) {
      const importMatch = /import \{ SuggestPlacementButton \} from '([^']+)'/.exec(file.text);
      expect(importMatch, `${rel(file.path)} renders the button without importing it`).not.toBeNull();
      const resolved = `${resolve(dirname(file.path), importMatch?.[1] ?? '')}.tsx`;
      expect(resolved, `${rel(file.path)} imports a different button`).toBe(DEFINITION);
    }
  });

  it('carries the permission and the dialog with it, so a caller cannot forget either', () => {
    const definition = readFileSync(DEFINITION, 'utf8');
    expect(definition).toContain("permission=\"applicant.reassign\"");
    expect(definition).toContain('<ReassignDialog');
  });

  it('leaves no way to record a placement that moves nobody', () => {
    // The advisory stage recommendation was the second concept behind the second button: saved on
    // the interview/evaluation record, shown next to the real placement, and never applied.
    for (const name of ['RecommendationDialog', 'useSetInterviewRecommendation', 'useSetEvaluationRecommendation']) {
      const users = files.filter((f) => f.text.includes(name)).map((f) => rel(f.path));
      expect(users, `${name} is back`).toEqual([]);
    }
    // And the dialog opens on the candidate's own placement — there is no other placement to
    // pre-fill from any more.
    expect(readFileSync(DIALOG, 'utf8')).not.toContain('prefill');
  });
});
