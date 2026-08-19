/**
 * Drawer numbering engine — ported verbatim from the gold system
 * (`backend/src/utils/drawerNumbering.js`). The arithmetic is business logic: it decides the
 * number physically painted on a drawer, so nothing here is "tidied up" on the way across.
 *
 * A vault is a grid of `rows` × `cols`. The administrator chooses how drawers are numbered by
 * combining three independent axes:
 *
 *   orientation         : 'horizontal' (row-major) | 'vertical' (column-major)
 *   horizontalDirection : 'ltr' (left→right)       | 'rtl' (right→left)
 *   verticalDirection   : 'ttb' (top→bottom)       | 'btt' (bottom→top)
 *
 * - horizontal → walk a whole row before moving to the next row. Row order obeys
 *   verticalDirection; within a row, column order obeys horizontalDirection.
 * - vertical   → walk a whole column before moving to the next column. Column order obeys
 *   horizontalDirection; within a column, row order obeys verticalDirection.
 *
 * Output drawers carry their physical position (row, col) AND their sequence `number`, so the
 * visual board can render the grid in place while showing the operator-facing numbering.
 */
import {
  GOLD_H_DIRECTIONS,
  GOLD_ORIENTATIONS,
  GOLD_V_DIRECTIONS,
  type GoldHDirection,
  type GoldOrientation,
  type GoldVDirection,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';

export const GOLD_DEFAULT_LAYOUT = {
  orientation: 'horizontal' as GoldOrientation,
  horizontalDirection: 'ltr' as GoldHDirection,
  verticalDirection: 'ttb' as GoldVDirection,
};

export interface GeneratedDrawer {
  row: number;
  col: number;
  number: number;
  label: string;
}

export interface GenerateDrawersConfig {
  rows: number;
  cols: number;
  orientation?: GoldOrientation;
  horizontalDirection?: GoldHDirection;
  verticalDirection?: GoldVDirection;
  startNumber?: number;
  labelFn?: (n: number, row: number, col: number) => string;
}

const rangeAsc = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

export const generateDrawers = ({
  rows,
  cols,
  orientation = GOLD_DEFAULT_LAYOUT.orientation,
  horizontalDirection = GOLD_DEFAULT_LAYOUT.horizontalDirection,
  verticalDirection = GOLD_DEFAULT_LAYOUT.verticalDirection,
  startNumber = 1,
  labelFn,
}: GenerateDrawersConfig): GeneratedDrawer[] => {
  const r = Number(rows);
  const c = Number(cols);
  const start = Number.isInteger(Number(startNumber)) ? Number(startNumber) : 1;

  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 1 || c < 1) {
    throw new BusinessRuleError('rows and cols must be positive integers');
  }
  if (!GOLD_ORIENTATIONS.includes(orientation)) {
    throw new BusinessRuleError(`orientation must be one of ${GOLD_ORIENTATIONS.join(', ')}`);
  }
  if (!GOLD_H_DIRECTIONS.includes(horizontalDirection)) {
    throw new BusinessRuleError(
      `horizontalDirection must be one of ${GOLD_H_DIRECTIONS.join(', ')}`,
    );
  }
  if (!GOLD_V_DIRECTIONS.includes(verticalDirection)) {
    throw new BusinessRuleError(`verticalDirection must be one of ${GOLD_V_DIRECTIONS.join(', ')}`);
  }

  // Row visiting order (top→bottom = 0..r-1)
  let rowOrder = rangeAsc(r);
  if (verticalDirection === 'btt') rowOrder = rowOrder.slice().reverse();

  // Column visiting order (left→right = 0..c-1)
  let colOrder = rangeAsc(c);
  if (horizontalDirection === 'rtl') colOrder = colOrder.slice().reverse();

  const label = labelFn ?? ((n: number): string => String(n));

  const drawers: GeneratedDrawer[] = [];
  let seq = start;

  if (orientation === 'horizontal') {
    // outer = rows, inner = cols
    for (const row of rowOrder) {
      for (const col of colOrder) {
        drawers.push({ row, col, number: seq, label: label(seq, row, col) });
        seq += 1;
      }
    }
  } else {
    // vertical → outer = cols, inner = rows
    for (const col of colOrder) {
      for (const row of rowOrder) {
        drawers.push({ row, col, number: seq, label: label(seq, row, col) });
        seq += 1;
      }
    }
  }

  return drawers;
};

/** Convenience: a `{ "row,col": number }` lookup map, for previews and tests. */
export const toPositionMap = (drawers: GeneratedDrawer[]): Record<string, number> => {
  const map: Record<string, number> = {};
  for (const d of drawers) map[`${String(d.row)},${String(d.col)}`] = d.number;
  return map;
};

/** The drawer label the gold system prints: `<vault code>-007`. */
export const drawerLabeller =
  (vaultCode: string) =>
  (n: number): string =>
    `${vaultCode}-${String(n).padStart(3, '0')}`;
