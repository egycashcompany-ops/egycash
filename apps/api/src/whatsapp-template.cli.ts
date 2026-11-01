// Registers — and checks on — the WhatsApp template the one-time setup link goes out as (Telnyx).
//
//   node apps/api/dist/whatsapp-template.cli.js            # print what would be registered
//   node apps/api/dist/whatsapp-template.cli.js --status   # has Meta approved it yet?
//   node apps/api/dist/whatsapp-template.cli.js --write    # submit it to Meta for approval
//   node apps/api/dist/whatsapp-template.cli.js --write --waba <WABA id>   # several accounts
//   node apps/api/dist/whatsapp-template.cli.js --write --name ecms_account_activation_v2
//
// On a developer machine: `npm run whatsapp:template -- --status`.
//
// WHY A COMMAND AND NOT A FORM IN THE TELNYX PORTAL. The portal can build the same template, but
// then its {{1}}, {{2}}, {{3}} and its button's URL are typed by hand to match what the code sends,
// and a mismatch is not an error anyone sees: Meta refuses each message, one undelivered employee at
// a time. This submits `activationTemplateRegistration()` — the same file the sends are built from.
//
// It reads WHATSAPP_API_TOKEN (the Telnyx API key), WEB_PUBLIC_URL (the button's address),
// WHATSAPP_ACTIVATION_TEMPLATE (the name; `ecms_account_activation` when unset — `--name` overrides
// it, so a new version can be registered while the live sends keep using the old one) and
// WHATSAPP_TEMPLATE_LANGUAGE. It does not boot the platform and touches no database.
//
// RE-RUNNABLE. `--write` looks first, in the WhatsApp Business Account it is about to write to. A
// template already there under the same name and language is reported, not submitted twice — and
// if ITS button points somewhere other than this deployment's `/activate`, that is said loudly:
// the button's address is fixed at approval, and sending through a template approved for an old
// address hands every new employee's token to whoever holds that address now.
import { runTemplateCommand } from './whatsapp-template/run';

runTemplateCommand(process.argv.slice(2), {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  fail: (line) => {
    process.stderr.write(`${line}\n`);
    process.exitCode = 1;
  },
}).catch((error: unknown) => {
  process.stderr.write(
    `whatsapp template: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
