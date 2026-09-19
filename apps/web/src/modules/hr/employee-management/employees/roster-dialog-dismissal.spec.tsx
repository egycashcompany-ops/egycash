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
   * «لو دوست عليها برضو يقولى تنبيه ان اقفل ولا اسيبه يحمل». Blocking the backdrop stopped the
   * stray click; this is the other half, for the presses that are real but may still be a reflex
   * during a forty-second wait. All three exits route through ONE question, because an × that
   * asks and an Escape that does not would only move the accident to the keyboard.
   */
  it('asks before closing while the upload is still working, on every exit', () => {
    expect(ROSTER).toContain('const requestClose = (): void => {');
    expect(ROSTER).toContain('if (run.isPending) {');
    // the ×/Escape path, and the footer button — the same handler, not two behaviours
    expect(ROSTER).toContain('onClose={requestClose}');
    expect(ROSTER).toContain('<Button variant="secondary" onClick={requestClose}>');
  });

  it('asks nothing once the work is done — a finished preview closes on one press', () => {
    const start = ROSTER.indexOf('const requestClose');
    const fn = ROSTER.slice(start, ROSTER.indexOf('useEffect(', start));
    expect(fn).toContain('close();');
  });

  /**
   * The question must have a way through it. A confirmation with no «close anyway» is a trap
   * wearing a question mark.
   */
  it('offers both answers, and the destructive one really closes', () => {
    expect(ROSTER).toContain("t('employees.roster.closeWhileBusy.keep')");
    expect(ROSTER).toContain('<Button variant="danger" onClick={close}>');
  });

  /**
   * THE HONEST HALF. Closing does not call the request back: while an apply is running the
   * records keep being written on the server. Telling somebody «nothing will happen» there would
   * be a lie about 2,600 people, so the two cases have two texts and the code picks by which is
   * in flight — the same test the spinner's own label uses.
   */
  it('says something different while writing than while only reading', () => {
    expect(ROSTER).toContain("'employees.roster.closeWhileBusy.applying'");
    expect(ROSTER).toContain("'employees.roster.closeWhileBusy.reading'");
    expect(ROSTER).toContain("(run.variables?.apply.length ?? 0) > 0");
  });

  it('drops the question if the work finishes while it is on screen', () => {
    expect(ROSTER).toContain('if (!run.isPending) setConfirmClose(false);');
  });

  /**
   * The default stays ON. Every other module's dialogs carry the same trap, and turning it off for
   * all of them on the way past would change dozens of screens nobody asked about.
   */
  it('leaves the default alone, so no other dialog changes', () => {
    expect(DIALOG_UI).toContain('dismissOnOutsideClick = true');
  });
});
