// The precondition both go-live tools share, checked before either of them boots.
//
// THE PROBLEM. `reset-workforce` and `import-workforce` each call `bootPlatform` before they do
// anything, and the boot is not passive: `hr.seed` runs the D2 login backfill, which creates a
// login for every employed employee that lacks one and SENDS each of them a WhatsApp message and
// an email carrying a one-time setup link.
//
// So `HR_PROVISION_MISSING_LOGINS` is a precondition of RUNNING THESE TOOLS AT ALL, not of writing
// with them. A dry run boots the same platform and delivers the same messages, before it has
// counted a single row — which makes "dry run" a promise the tool could not keep. A guard placed
// after the boot, or behind `--write`, is checked long after the messages have gone out.
//
// WHY IT REFUSES RATHER THAN WARNS, and why it refuses the harmless invocation too. On a database
// where every employee already has a login the backfill sends nothing, so this occasionally
// refuses a run that would have been fine. That is the cheap mistake: the operator sets one
// variable and runs again. The other mistake delivers a setup link to ~1,670 real people at once
// and cannot be recalled — there is no undo for a message that has been delivered.
import { env } from './infrastructure/config/env';

/**
 * Refuse to proceed while the boot would provision logins and message the people it provisions.
 *
 * Call this FIRST in a CLI's `main`, before `bootPlatform` — after it, the messages are already
 * sent and refusing achieves nothing.
 */
export const assertLoginProvisioningDisabled = (command: string): void => {
  if (!env.HR_PROVISION_MISSING_LOGINS) return;
  throw new Error(
    `refusing to run ${command} while HR_PROVISION_MISSING_LOGINS=true. Booting the platform ` +
      'runs the login backfill, which creates a login for every employed employee that has none ' +
      'and sends each of them a WhatsApp message and an email with a setup link — that happens ' +
      'before this command reads anything, so a dry run would send them too, and nothing can ' +
      'recall a delivered message. Set HR_PROVISION_MISSING_LOGINS=false in the .env this command ' +
      'loads, run it again, and turn it back on when accounts are genuinely meant to go out.',
  );
};
