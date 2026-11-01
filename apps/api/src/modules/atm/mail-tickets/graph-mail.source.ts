// Microsoft Graph as an `AtmMailSource` — the port of the legacy reader's transport half
// (Automation/src/index.js:33-58 token, :103-140 list, :215-232 mark read + categorize).
//
// Only the transport. No parsing, no machine matching, no branch resolution: those are the
// ingestion seam's, which is what lets this file be replaced without touching a business rule.
//
// OPT-IN, like the OCR sidecar (`paddle-ocr-provider.ts`): without `ATM_MAIL_GRAPH_*` set, nothing
// registers and the null source keeps the poll task inert. The client secret is read through the
// platform secret store when a sealed ref is configured, so a deployment never has to put it in
// plaintext env — but plaintext env still works, because that is what the legacy had and a
// migration that demands a secret-store rollout first is a migration that does not happen.
//
// Since /atm/settings (the owner, 2026-10-28: the credentials are typed on a screen, the secret
// stored encrypted) the same transport also reads the mailbox the screen's document names — built
// per document by `createGraphMailboxSource`, with the secret opened from its sealed ref on demand.
import { outboundFetch } from '../../../infrastructure/http/outbound';
import { logger } from '../../../infrastructure/logging/logger';
import { env } from '../../../infrastructure/config/env';
import { getSecretStore } from '../../../platform/secrets';
import {
  registerAtmMailSource,
  registerAtmMailSourceFactory,
  type AtmMailMessage,
  type AtmMailPage,
  type AtmMailSource,
  type AtmMailSourceFactory,
} from './mail-source';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const SECRET_CONTEXT = 'atm.mail.graphClientSecret';

interface GraphMessage {
  id?: unknown;
  subject?: unknown;
  isRead?: unknown;
  receivedDateTime?: unknown;
  from?: { emailAddress?: { address?: unknown } };
  body?: { content?: unknown };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface GraphMailConfig {
  tenantId: string;
  clientId: string;
  /**
   * The client secret, produced when a token is due — from the environment (plaintext, or a JSON
   * `SecretRef` the platform store opens) or from the mailbox document's sealed ref.
   */
  clientSecret: () => Promise<string>;
  /** The mailbox to read — `/users/{userEmail}/messages`, as the legacy did. */
  userEmail: string;
  timeoutMs: number;
}

/** The environment's secret: plaintext as configured, or opened when configured as a sealed ref. */
const environmentSecret = (raw: string) => async (): Promise<string> => {
  if (!raw.trimStart().startsWith('{')) return raw;
  const ref: unknown = JSON.parse(raw);
  return getSecretStore().open(ref as never, SECRET_CONTEXT);
};

/** Graph's messages as the ingestion seam reads them; one it cannot use is left out, unread. */
const toMailMessages = (listed: readonly GraphMessage[]): AtmMailMessage[] => {
  const out: AtmMailMessage[] = [];
  for (const message of listed) {
    const id = text(message.id);
    const bodyText = text(message.body?.content);
    // A message with no id cannot be marked read, and one with no body cannot be parsed — the
    // legacy skipped the second case explicitly (index.js:128-131) and never met the first.
    if (id === '' || bodyText === '') continue;
    const received = new Date(text(message.receivedDateTime));
    out.push({
      providerMessageId: id,
      // The TRUE receipt time. The legacy captured it and then overwrote it with "now"
      // (index.js:134 vs :137), which is why its log page timestamps were ingest times; the
      // port doc records that as the one legacy bug this transport does not reproduce.
      receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
      senderEmail: text(message.from?.emailAddress?.address),
      subject: text(message.subject),
      bodyText,
      isRead: message.isRead === true,
    });
  }
  return out;
};

class GraphMailSource implements AtmMailSource {
  readonly providerId = 'microsoftGraph';

  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: GraphMailConfig) {}

  available(): boolean {
    return true;
  }

  /**
   * Client-credentials token, cached until a minute before expiry — the legacy's own margin
   * (index.js:45), which keeps a long poll from being cut off mid-flight by an expiring token.
   */
  private async accessToken(): Promise<string> {
    if (this.token !== null && Date.now() < this.tokenExpiresAt) return this.token;
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      scope: 'https://graph.microsoft.com/.default',
      client_secret: await this.config.clientSecret(),
      grant_type: 'client_credentials',
    });
    const response = await this.fetchJson<{ access_token?: unknown; expires_in?: unknown }>(
      `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`,
      { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      false,
    );
    const token = text(response.access_token);
    if (token === '') throw new Error('microsoft graph returned no access token');
    const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : 3600;
    this.token = token;
    this.tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
    return token;
  }

  /** One request. Never logs the body or the secret — only status and URL shape. */
  private async fetchJson<T>(url: string, init: RequestInit, authorize = true): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (authorize) headers.authorization = `Bearer ${await this.accessToken()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await outboundFetch(url, { ...init, headers, signal: controller.signal });
      if (!response.ok) {
        // A 401 means the cached token went stale early; drop it so the next call re-authenticates.
        if (response.status === 401) this.token = null;
        throw new Error(`microsoft graph ${String(response.status)} on ${new URL(url).pathname}`);
      }
      if (response.status === 204) return {} as T;
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async listUnread(limit: number): Promise<AtmMailMessage[]> {
    const path =
      `${GRAPH_ROOT}/users/${encodeURIComponent(this.config.userEmail)}/messages` +
      `?$filter=isRead%20eq%20false&$orderby=receivedDateTime%20asc&$top=${String(limit)}` +
      `&$select=id,subject,from,body,receivedDateTime,isRead`;
    const payload = await this.fetchJson<{ value?: GraphMessage[] }>(path, { method: 'GET' });
    return toMailMessages(payload.value ?? []);
  }

  /**
   * Newest first, `$skip` past the unread mail already looked at. `receivedDateTime` leads the
   * `$filter` because Graph requires every `$orderby` property to appear there, first and in the
   * same order — otherwise it refuses the listing (`InefficientFilter`). The bound is every date.
   */
  async listUnreadPage(limit: number, skip: number): Promise<AtmMailPage> {
    const path =
      `${GRAPH_ROOT}/users/${encodeURIComponent(this.config.userEmail)}/messages` +
      `?$filter=receivedDateTime%20ge%201900-01-01T00:00:00Z%20and%20isRead%20eq%20false` +
      `&$orderby=receivedDateTime%20desc&$top=${String(limit)}&$skip=${String(skip)}` +
      `&$select=id,subject,from,body,receivedDateTime,isRead`;
    const payload = await this.fetchJson<{ value?: GraphMessage[] }>(path, { method: 'GET' });
    const listed = payload.value ?? [];
    return { messages: toMailMessages(listed), listed: listed.length };
  }

  async markHandled(providerMessageId: string, category: string | null): Promise<void> {
    const patch: { isRead: true; categories?: string[] } = { isRead: true };
    if (category !== null) patch.categories = [category];
    await this.fetchJson(
      `${GRAPH_ROOT}/users/${encodeURIComponent(this.config.userEmail)}/messages/${encodeURIComponent(providerMessageId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
        headers: { 'content-type': 'application/json' },
      },
    );
  }
}

/** The source for a mailbox document saved on /atm/settings — Graph is the one provider today. */
export const createGraphMailboxSource: AtmMailSourceFactory = (connection) =>
  new GraphMailSource({
    tenantId: connection.tenantId,
    clientId: connection.clientId,
    clientSecret: connection.openSecret,
    userEmail: connection.userEmail,
    timeoutMs: env.ATM_MAIL_GRAPH_TIMEOUT_MS,
  });

/**
 * Registers Graph as the provider for a mailbox document (always — whether one exists is the
 * poll's question, asked per run), and the environment's Graph source when the deployment
 * configured a mailbox there. Called at module load; the environment half is silent and inert when
 * the four settings are not all present, which is the pre-existing behaviour of every install that
 * has no mailbox.
 */
export const registerGraphMailSource = (): void => {
  registerAtmMailSourceFactory(createGraphMailboxSource);
  const {
    ATM_MAIL_GRAPH_TENANT_ID,
    ATM_MAIL_GRAPH_CLIENT_ID,
    ATM_MAIL_GRAPH_CLIENT_SECRET,
    ATM_MAIL_GRAPH_USER,
  } = env;
  if (
    ATM_MAIL_GRAPH_TENANT_ID === undefined ||
    ATM_MAIL_GRAPH_CLIENT_ID === undefined ||
    ATM_MAIL_GRAPH_CLIENT_SECRET === undefined ||
    ATM_MAIL_GRAPH_USER === undefined
  ) {
    return;
  }
  registerAtmMailSource(
    new GraphMailSource({
      tenantId: ATM_MAIL_GRAPH_TENANT_ID,
      clientId: ATM_MAIL_GRAPH_CLIENT_ID,
      clientSecret: environmentSecret(ATM_MAIL_GRAPH_CLIENT_SECRET),
      userEmail: ATM_MAIL_GRAPH_USER,
      timeoutMs: env.ATM_MAIL_GRAPH_TIMEOUT_MS,
    }),
  );
  logger.info({ mailbox: ATM_MAIL_GRAPH_USER }, 'atm: microsoft graph mail source registered');
};
