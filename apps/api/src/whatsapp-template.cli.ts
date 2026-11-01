// Registers — and checks on — the WhatsApp template the one-time setup link goes out as (Telnyx).
//
//   node apps/api/dist/whatsapp-template.cli.js            # print what would be registered
//   node apps/api/dist/whatsapp-template.cli.js --status   # has Meta approved it yet?
//   node apps/api/dist/whatsapp-template.cli.js --write    # submit it to Meta for approval
//   node apps/api/dist/whatsapp-template.cli.js --write --waba <WABA id>   # several accounts
//
// On a developer machine: `npm run whatsapp:template -- --status`.
//
// WHY A COMMAND AND NOT A FORM IN THE TELNYX PORTAL. The portal can build the same template, but
// then its {{1}}, {{2}}, {{3}} and its button's URL are typed by hand to match what the code sends,
// and a mismatch is not an error anyone sees: Meta refuses each message, one undelivered employee at
// a time. This submits `activationTemplateRegistration()` — the same file the sends are built from.
//
// It reads WHATSAPP_API_TOKEN (the Telnyx API key), WEB_PUBLIC_URL (the button's address),
// WHATSAPP_ACTIVATION_TEMPLATE (the name; `ecms_account_activation` when unset) and
// WHATSAPP_TEMPLATE_LANGUAGE. It does not boot the platform and touches no database.
//
// RE-RUNNABLE. `--write` looks first, and a template already registered under the same name and
// language is reported, not submitted twice.
import { env } from './infrastructure/config/env';
import { outboundFetch } from './infrastructure/http/outbound';
import { TELNYX_API_BASE, telnyxFailureDetail } from './infrastructure/messaging/whatsapp';
import {
  activationTemplateRegistration,
  buttonAddressProblem,
  DEFAULT_ACTIVATION_TEMPLATE_NAME,
} from './platform/users/activation-whatsapp-template';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const fail = (line: string): void => {
  process.stderr.write(`${line}\n`);
  process.exitCode = 1;
};

const flagValue = (argv: readonly string[], name: string): string => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? '' : (argv[at + 1] ?? '');
};

interface TemplateRow {
  id?: string;
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  rejection_reason?: string;
}

interface WabaRow {
  waba_id?: string;
  name?: string;
  status?: string;
  phone_numbers_count?: number;
}

const telnyx = async (path: string, init: RequestInit = {}): Promise<unknown> => {
  const res = await outboundFetch(`${TELNYX_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`,
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(await telnyxFailureDetail(res, []));
  return res.json();
};

const listOf = <T>(payload: unknown): T[] => {
  const data =
    typeof payload === 'object' && payload !== null ? (payload as { data?: unknown }).data : null;
  return Array.isArray(data) ? (data as T[]) : [];
};

/** The registered templates with exactly this name — Telnyx's search matches parts of names too. */
const findTemplates = async (name: string): Promise<TemplateRow[]> => {
  const query = new URLSearchParams({ 'filter[search]': name, 'page[size]': '100' });
  const rows = listOf<TemplateRow>(await telnyx(`/whatsapp/message_templates?${query.toString()}`));
  return rows.filter((row) => row.name === name);
};

const describeTemplate = (row: TemplateRow): string =>
  `  ${row.name ?? '?'} [${row.language ?? '?'}] — ${row.status ?? 'unknown'}` +
  (row.rejection_reason !== undefined &&
  row.rejection_reason !== '' &&
  row.rejection_reason !== 'NONE'
    ? ` (rejected: ${row.rejection_reason})`
    : '') +
  (row.id !== undefined ? `  · id ${row.id}` : '');

/** The account's WABA: the one given, else the only one connected. */
const resolveWaba = async (given: string): Promise<string | null> => {
  if (given !== '') return given;
  const accounts = listOf<WabaRow>(await telnyx('/whatsapp/business_accounts'));
  if (accounts.length === 1 && typeof accounts[0]?.waba_id === 'string') return accounts[0].waba_id;
  if (accounts.length === 0) {
    fail(
      'No WhatsApp Business Account is connected to this Telnyx account.\n' +
        '  Finish the WhatsApp signup in the Telnyx portal first (Messaging → WhatsApp).',
    );
    return null;
  }
  fail('This Telnyx account has several WhatsApp Business Accounts — name one with --waba:');
  for (const account of accounts) {
    fail(`  --waba ${account.waba_id ?? '?'}   ${account.name ?? ''} (${account.status ?? '?'})`);
  }
  return null;
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const status = argv.includes('--status');
  const name =
    env.WHATSAPP_ACTIVATION_TEMPLATE === ''
      ? DEFAULT_ACTIVATION_TEMPLATE_NAME
      : env.WHATSAPP_ACTIVATION_TEMPLATE;
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE;
  const addressProblem = buttonAddressProblem(env.WEB_PUBLIC_URL);

  if (!write && !status) {
    // The dry run needs nothing — no key, no network — so it can be read before anything is set.
    const wabaId = flagValue(argv, 'waba');
    out(
      JSON.stringify(
        activationTemplateRegistration({
          wabaId: wabaId === '' ? '<WABA id>' : wabaId,
          name,
          language,
        }),
        null,
        2,
      ),
    );
    out('');
    out(`This is what --write submits to Meta, through Telnyx, as «${name}» [${language}].`);
    if (addressProblem !== null) {
      out(
        `Note: WEB_PUBLIC_URL (${env.WEB_PUBLIC_URL}) ${addressProblem} — set the real address first.`,
      );
    }
    return;
  }

  if (env.WHATSAPP_API_TOKEN === '') {
    fail('Set WHATSAPP_API_TOKEN to the Telnyx API key first.');
    return;
  }

  if (status) {
    const rows = await findTemplates(name);
    if (rows.length === 0) {
      out(`«${name}» is not registered yet. Submit it with --write.`);
      return;
    }
    out(`«${name}» on Telnyx:`);
    for (const row of rows) out(describeTemplate(row));
    if (!rows.some((row) => row.language === language && row.status === 'APPROVED')) {
      out(`Not approved in [${language}] yet — WhatsApp messages keep failing until it is.`);
    }
    return;
  }

  if (addressProblem !== null) {
    fail(
      `WEB_PUBLIC_URL (${env.WEB_PUBLIC_URL}) ${addressProblem}.\n` +
        "  The template's button is that address, and Meta approves it as written — set the\n" +
        "  deployment's real https address (e.g. https://ecms.egycash.com.eg) and run again.",
    );
    return;
  }

  const existing = (await findTemplates(name)).filter((row) => row.language === language);
  if (existing.length > 0) {
    out(`«${name}» [${language}] is already registered — nothing submitted:`);
    for (const row of existing) out(describeTemplate(row));
    return;
  }

  const wabaId = await resolveWaba(flagValue(argv, 'waba'));
  if (wabaId === null) return;

  const created = await telnyx('/whatsapp/message_templates', {
    method: 'POST',
    body: JSON.stringify(activationTemplateRegistration({ wabaId, name, language })),
  });
  const row =
    typeof created === 'object' && created !== null
      ? ((created as { data?: TemplateRow }).data ?? {})
      : {};
  out(`Submitted «${name}» [${language}] to Meta for approval:`);
  out(describeTemplate({ name, language, ...row }));
  out('');
  out('Approval usually takes up to a day. Check with --status; once it says APPROVED, set');
  out(
    `  WHATSAPP_PROVIDER=telnyx  WHATSAPP_ACTIVATION_TEMPLATE=${name}  WHATSAPP_TEMPLATE_LANGUAGE=${language}`,
  );
};

main().catch((error: unknown) => {
  fail(`whatsapp template: ${error instanceof Error ? error.message : String(error)}`);
});
