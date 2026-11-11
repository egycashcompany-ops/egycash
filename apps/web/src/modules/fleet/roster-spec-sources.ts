// The «تعيين السيارات» screen's source, for the specs that read it.
//
// The screen used to be one file (`pages/RosterPage.tsx`) and its specs read that file. It is now a
// thin page shell, one board model, the computer's board, the touch board and the pieces both
// share — so a claim about "the page" reads the files that make the page. Not a spec itself (no
// `.spec`), like `fleet-dashboard-fixtures.ts`.
//
//   shell   the page: URL keys, remembered filters, the sort, which board to draw
//   model   the day's state (draft, undo, save) and the layout rule
//   desk    the computer's board (≥ 1280px)
//   shared  the driver lists and the small parts both boards draw
//   touch   the phone and tablet board
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ROSTER_FILES = {
  shell: ['pages/RosterPage.tsx'],
  model: ['lib/roster-board.ts', 'lib/roster-layout.ts'],
  desk: [
    'components/roster/RosterDeskBoard.tsx',
    'components/roster/roster-desk-cells.tsx',
    'components/roster/roster-desk-parts.tsx',
  ],
  shared: ['components/roster/roster-drivers.tsx', 'components/roster/roster-parts.tsx'],
  touch: [
    'components/roster/RosterTouchBoard.tsx',
    'components/roster/RosterCarCard.tsx',
    'components/roster/RosterBottomSheet.tsx',
    'components/roster/roster-touch-parts.tsx',
  ],
} as const;

export type RosterPart = keyof typeof ROSTER_FILES;

/** Every file of the parts asked for, relative to `modules/fleet/`, in the order asked. */
export const rosterFiles = (parts: readonly RosterPart[]): string[] =>
  parts.flatMap((part) => [...ROSTER_FILES[part]]);

/**
 * The parts' files, concatenated in the order asked — with comments stripped unless `raw`, because
 * the headers explain the rules at length and would match a claim either way. A missing file
 * throws: a claim about a file that is not there is a broken spec, not a passing one.
 */
export const rosterSource = (
  parts: readonly RosterPart[],
  { raw = false }: { raw?: boolean } = {},
): string => {
  const text = rosterFiles(parts)
    .map((file) => readFileSync(join(HERE, file), 'utf8'))
    .join('\n');
  return raw ? text : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
};
