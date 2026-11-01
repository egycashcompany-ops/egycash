// The template command's logic — `whatsapp-template.cli.ts` is only its entry point, so the
// decisions below (which account, whether a template already exists, whether its button is stale)
// can be tested against a fake Telnyx rather than read and trusted.
import { env } from '../infrastructure/config/env';
import { outboundFetch } from '../infrastructure/http/outbound';
import { TELNYX_API_BASE, telnyxFailureDetail } from '../infrastructure/messaging/whatsapp';
import {
  activationTemplateRegistration,
  buttonAddressProblem,
  DEFAULT_ACTIVATION_TEMPLATE_NAME,
} from '../platform/users/activation-whatsapp-template';
import { setupLinkUrl } from '../platform/users/setup-link';

/** Where the command speaks. `fail` is a line on stderr AND a non-zero exit. */
export interface CommandIo {
  out(line: string): void;
  fail(line: string): void;
}

/** `--name value` → 'value'; absent → ''; present without a value (`--waba --write`) → null. */
export const flagValue = (argv: readonly string[], name: string): string | null => {
  const at = argv.indexOf(`--${name}`);
  if (at === -1) return '';
  const value = argv[at + 1];
  return value === undefined || value.startsWith('--') ? null : value;
};

interface TemplateRow {
  id?: string;
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  rejection_reason?: string;
  components?: { type?: string; buttons?: { type?: string; url?: string }[] }[];
  whatsapp_business_account?: { id?: string };
}

interface WabaRow {
  id?: string;
  waba_id?: string;
  name?: string;
  status?: string;
}

/** The account a write goes to, by every id Telnyx may name it with. */
interface Waba {
  wabaId: string;
  ids: ReadonlySet<string>;
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
  const query = new URLSearchParams({ 'filter[search]': name, 'page[size]': '250' });
  const rows = listOf<TemplateRow>(await telnyx(`/whatsapp/message_templates?${query.toString()}`));
  return rows.filter((row) => row.name === name);
};

/**
 * Whether a template row lives in this account. A row that does not say is counted as this
 * account's: the cost of that guess is a refusal to submit, never a duplicate or a silent skip.
 */
const belongsTo = (row: TemplateRow, waba: Waba): boolean => {
  const id = row.whatsapp_business_account?.id;
  return id === undefined || waba.ids.has(id);
};

/** The address the template's URL button was approved for, as Telnyx returns it. */
export const registeredButtonUrl = (row: TemplateRow): string | null => {
  for (const component of row.components ?? []) {
    if ((component.type ?? '').toUpperCase() !== 'BUTTONS') continue;
    const button = (component.buttons ?? []).find((b) => (b.type ?? '').toUpperCase() === 'URL');
    if (button?.url !== undefined) return button.url;
  }
  return null;
};

const describeTemplate = (row: TemplateRow): string => {
  const rejected =
    row.rejection_reason !== undefined &&
    row.rejection_reason !== '' &&
    row.rejection_reason !== 'NONE'
      ? ` (rejected: ${row.rejection_reason})`
      : '';
  const button = registeredButtonUrl(row);
  return (
    `  ${row.name ?? '?'} [${row.language ?? '?'}] — ${row.status ?? 'unknown'}${rejected}` +
    (row.id !== undefined ? `  · id ${row.id}` : '') +
    (row.whatsapp_business_account?.id !== undefined
      ? `  · WABA ${row.whatsapp_business_account.id}`
      : '') +
    (button !== null ? `\n    button → ${button}` : '')
  );
};

/** A row whose button points somewhere this deployment's links do not go. Unknown is not stale. */
const staleButton = (row: TemplateRow, expected: string): boolean => {
  const button = registeredButtonUrl(row);
  return button !== null && button !== expected;
};

/** The account to write to: the one named with `--waba`, else the only one connected. */
const resolveWaba = async (given: string, { fail }: CommandIo): Promise<Waba | null> => {
  const accounts = listOf<WabaRow>(await telnyx('/whatsapp/business_accounts'));
  const idsOf = (account: WabaRow | undefined, fallback: string): Set<string> =>
    new Set([fallback, account?.id, account?.waba_id].filter((id): id is string => !!id));
  if (given !== '') {
    const match = accounts.find((account) => account.waba_id === given || account.id === given);
    return { wabaId: match?.waba_id ?? given, ids: idsOf(match, given) };
  }
  const only = accounts.length === 1 ? accounts[0] : undefined;
  if (only?.waba_id !== undefined) return { wabaId: only.waba_id, ids: idsOf(only, only.waba_id) };
  if (accounts.length === 0) {
    fail(
      'No WhatsApp Business Account is connected to this Telnyx account.\n' +
        '  Finish the WhatsApp signup in the Telnyx portal first (Messaging → WhatsApp).',
    );
    return null;
  }
  fail('Name the WhatsApp Business Account to register in with --waba:');
  for (const account of accounts) {
    fail(`  --waba ${account.waba_id ?? '?'}   ${account.name ?? ''} (${account.status ?? '?'})`);
  }
  return null;
};

/** The whole command, given its arguments (without `node` and the script) and where to speak. */
export const runTemplateCommand = async (argv: readonly string[], io: CommandIo): Promise<void> => {
  const { out, fail } = io;
  const write = argv.includes('--write');
  const status = argv.includes('--status');
  const wabaFlag = flagValue(argv, 'waba');
  const nameFlag = flagValue(argv, 'name');
  if (wabaFlag === null || nameFlag === null) {
    fail(`${wabaFlag === null ? '--waba' : '--name'} needs a value.`);
    return;
  }
  if (nameFlag !== '' && !/^[a-z0-9_]+$/.test(nameFlag)) {
    fail(
      '--name: lowercase letters, digits and underscores only (Meta’s rule for template names).',
    );
    return;
  }
  const name =
    nameFlag !== ''
      ? nameFlag
      : env.WHATSAPP_ACTIVATION_TEMPLATE !== ''
        ? env.WHATSAPP_ACTIVATION_TEMPLATE
        : DEFAULT_ACTIVATION_TEMPLATE_NAME;
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE;
  const expectedButton = setupLinkUrl('{{1}}');
  const addressProblem = buttonAddressProblem(env.WEB_PUBLIC_URL);

  if (!write && !status) {
    // The dry run needs nothing — no key, no network — so it can be read before anything is set.
    out(
      JSON.stringify(
        activationTemplateRegistration({
          wabaId: wabaFlag === '' ? '<WABA id>' : wabaFlag,
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
    const all = await findTemplates(name);
    const rows =
      wabaFlag === ''
        ? all
        : all.filter((row) => belongsTo(row, { wabaId: wabaFlag, ids: new Set([wabaFlag]) }));
    if (rows.length === 0) {
      out(`«${name}» is not registered yet. Submit it with --write.`);
      return;
    }
    out(`«${name}» on Telnyx:`);
    for (const row of rows) out(describeTemplate(row));
    const usable = rows.filter(
      (row) => row.language === language && !staleButton(row, expectedButton),
    );
    if (rows.some((row) => row.language === language && staleButton(row, expectedButton))) {
      fail(
        `«${name}» [${language}] was approved for a different address than this deployment's\n` +
          `  ${expectedButton}\n` +
          '  Do not send through it. Register a new one: --write --name <new name>.',
      );
    }
    if (!usable.some((row) => row.status === 'APPROVED')) {
      out(
        `Not approved in [${language}] for this address yet — WhatsApp messages fail until it is.`,
      );
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

  const waba = await resolveWaba(wabaFlag, io);
  if (waba === null) return;

  const existing = (await findTemplates(name)).filter(
    (row) => row.language === language && belongsTo(row, waba),
  );
  if (existing.length > 0) {
    if (existing.some((row) => staleButton(row, expectedButton))) {
      fail(
        `«${name}» [${language}] already exists, approved for a different address:\n` +
          existing.map(describeTemplate).join('\n') +
          `\n  This deployment's button is ${expectedButton}.\n` +
          '  A name cannot be registered twice — register under a new one with --name, and switch\n' +
          '  WHATSAPP_ACTIVATION_TEMPLATE to it once --status says APPROVED.',
      );
      return;
    }
    out(`«${name}» [${language}] is already registered — nothing submitted:`);
    for (const row of existing) out(describeTemplate(row));
    return;
  }

  const created = await telnyx('/whatsapp/message_templates', {
    method: 'POST',
    body: JSON.stringify(activationTemplateRegistration({ wabaId: waba.wabaId, name, language })),
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
