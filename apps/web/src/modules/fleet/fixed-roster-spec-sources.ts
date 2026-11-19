// The «الطقم الثابت» screen's source, for the specs that read it — the twin of
// `roster-spec-sources.ts`. Not a spec itself (no `.spec`).
//
// The screen was one file (`pages/FixedRosterPage.tsx`). It is now a thin page shell, one board
// model, the computer's board and the touch board — so a claim about "the screen" reads the files
// that make it.
//
//   shell   the page: URL keys, remembered filters, the sort, the header, which board to draw
//   model   the board's state (draft, undo, save), its rules and the Arabic refusal line
//   desk    the computer's board (≥ 1280px): the table, its cells, the drivers panel, the pen dialog
//   touch   the phone and tablet board and its parts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const FIXED_FILES = {
  shell: ['pages/FixedRosterPage.tsx'],
  model: ['lib/fixed-roster-model.ts', 'lib/fixed-roster-board.ts', 'lib/fixed-save-refusal.ts'],
  desk: [
    'components/roster/FixedDeskBoard.tsx',
    'components/roster/fixed-desk-cells.tsx',
    'components/roster/FixedDriversPanel.tsx',
    'components/roster/FixedCrewDialog.tsx',
  ],
  touch: ['components/roster/FixedTouchBoard.tsx', 'components/roster/fixed-touch-parts.tsx'],
} as const;

export type FixedPart = keyof typeof FIXED_FILES;

/** Every file of the parts asked for, relative to `modules/fleet/`, in the order asked. */
export const fixedFiles = (parts: readonly FixedPart[]): string[] =>
  parts.flatMap((part) => [...FIXED_FILES[part]]);

/**
 * The parts' files, concatenated in the order asked — with comments stripped unless `raw`, because
 * the headers explain at length what the screen does NOT have (a day, an availability verdict) and
 * would match a claim either way. A missing file throws: a claim about a file that is not there is
 * a broken spec, not a passing one.
 */
export const fixedSource = (
  parts: readonly FixedPart[],
  { raw = false }: { raw?: boolean } = {},
): string => {
  const text = fixedFiles(parts)
    .map((file) => readFileSync(join(HERE, file), 'utf8'))
    .join('\n');
  return raw ? text : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
};
