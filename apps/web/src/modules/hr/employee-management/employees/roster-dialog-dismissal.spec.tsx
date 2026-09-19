// The roster preview is not thrown away by a click that missed.
//
// «انا عاوز لما ادوس على الاكس بس يقفل مش اى ميس كليك يقفل التاب». Uploading the employee file is
// the longest-running thing in the product: the workbook is read and compared against 2,600
// records while a spinner turns, and the preview that comes back is the only chance to see what an
// upload would write before agreeing to it. `Dialog` closed on any click outside its panel, so one
// stray click on the backdrop — or one tap beside the panel on a phone, where the panel is narrow
// and the backdrop is most of the screen — ended the run or discarded a preview part-way through
// being read. Getting it back meant uploading and waiting all over again.
//
// Pinned at the source rather than by driving the component: the dialog reaches its preview only
// after a mutation resolves, which a static render cannot produce, while the property that matters
// — that this caller opts out, and that the two deliberate exits survive — is plainly readable in
// the file and in the shared component it uses.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIALOG_UI = readFileSync(join(HERE, '../../../../shared/ui/Dialog.tsx'), 'utf8');
const ROSTER = readFileSync(join(HERE, 'components/RosterImportDialog.tsx'), 'utf8');

describe('the roster import dialog survives a click that missed', () => {
  /** THE ASSERTION THE BUG WAS. Without this prop the backdrop closes the dialog. */
  it('opts out of closing on a click outside the panel', () => {
    expect(ROSTER).toContain('dismissOnOutsideClick={false}');
  });

  it('opts out on the dialog that holds the upload, not somewhere incidental', () => {
    const dialogTag = ROSTER.slice(ROSTER.indexOf('<Dialog'), ROSTER.indexOf('>', ROSTER.indexOf('title={t(')));
    expect(dialogTag).toContain('dismissOnOutsideClick={false}');
    expect(dialogTag).toContain("t('employees.roster.title')");
  });

  /**
   * Opting out must not trap anybody. Escape is a decision — nobody presses it while reaching for
   * a scrollbar — and a keyboard user needs a way out that does not depend on finding a button.
   */
  it('still closes on Escape, and still has an × that closes it', () => {
    expect(DIALOG_UI).toContain("if (e.key === 'Escape') onClose()");
    expect(DIALOG_UI).toContain("aria-label={t('common.close')}");
  });

  it('the shared dialog gates the outside-click listener on the flag', () => {
    expect(DIALOG_UI).toContain('useOnClickOutside(panelRef, onClose, open && dismissOnOutsideClick)');
  });

  /**
   * The default stays ON. Every other module's dialogs carry the same trap, and turning it off for
   * all of them on the way past would change dozens of screens nobody asked about.
   */
  it('leaves the default alone, so no other dialog changes', () => {
    expect(DIALOG_UI).toContain('dismissOnOutsideClick = true');
  });
});
