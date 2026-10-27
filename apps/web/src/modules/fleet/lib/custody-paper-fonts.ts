// The custody papers' fonts, promoted to `shared/lib/paper-fonts.ts` so ATM's papers draw with the
// same table (docs/12-planning/atm-settlements-phase1.md §8). Re-exported unchanged: no Fleet caller
// moves, and the faces, the stacks and the registration are the same objects.
export {
  PAPER_FACES,
  PAPER_FONT_CSS,
  PAPER_UNICODE_RANGE,
  STACK,
  measureText,
  paperFontsReady,
  type PaperFace,
} from '../../../shared/lib/paper-fonts';
