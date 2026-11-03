// One way into a phase's batches — from that phase's own page.
//
// «إيه الفرق بين دفعات الفحص دي /evaluation-batches … وبين دفعات الفحص الأمني …
// /evaluation-batches/phase/securityCheck … أعتقد دا تكرار لا حاجة له». It was: the bare list mixed
// every phase in one table, and the security-check and driving-test pages both linked to it. Now
// each phase's button opens that phase's list, and the bare address only redirects.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECRUITMENT = resolve(HERE, '..');
const read = (path: string): string => readFileSync(join(RECRUITMENT, path), 'utf8');

const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.') ? [full] : [];
  });

describe('a phase’s batches are reached from that phase', () => {
  it('opens the phase’s own list from the phase page', () => {
    expect(read('evaluations/pages/EvaluationPhaseQueuePage.tsx')).toContain(
      'navigate(`/evaluation-batches/phase/${phase.key}`)',
    );
  });

  /** The mixed list is the duplication the owner asked to remove: nothing may link to it again. */
  it('links nowhere to the bare, every-phase list', () => {
    const offenders = sources(resolve(RECRUITMENT, '../..'))
      // Code only: a comment that names the old address is a record, not a link.
      .filter((file) => /(['"`])\/evaluation-batches\1/.test(code(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(file.indexOf('modules/')));
    expect(offenders).toEqual([]);
  });

  it('turns the bare address into a redirect to the evaluations', () => {
    expect(read('routes.tsx')).toContain('<Route index element={<Navigate to="/evaluations" replace />} />');
  });
  // The missing phase column is pinned beside the rest of the list's shape, in
  // batch-screens-per-phase.spec.ts.
});
