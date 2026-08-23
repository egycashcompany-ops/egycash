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
import { logger } from '../../../infrastructure/logging/logger';
import { env } from '../../../infrastructure/config/env';
import { getSecretStore } from '../../../platform/secrets';
import { registerAtmMailSource, type AtmMailMessage, type AtmMailSource } from './mail-source';

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
  /** Plaintext, or a JSON `SecretRef` the platform store can open. */
  clientSecret: string;
  /** The mailbox to read — `/users/{userEmail}/messages`, as the legacy did. */
  userEmail: string;
  timeoutMs: number;
}

class GraphMailSource implements AtmMailSource {
  readonly providerId = 'microsoftGraph';

  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: GraphMailConfig) {}

  available(): boolean {
    return true;
  }

  /** The client secret, opened through the platform store when it was configured as a ref. */
  private async clientSecret(): Promise<string> {
    const raw = this.config.clientSecret;
    if (!raw.trimStart().startsWith('{')) return raw;
    const ref: unknown = JSON.parse(raw);
    return getSecretStore().open(ref as never, SECRET_CONTEXT);
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
      client_secret: await this.clientSecret(),
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
      const response = await fetch(url, { ...init, headers, signal: controller.signal });
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

    const out: AtmMailMessage[] = [];
    for (const message of payload.value ?? []) {
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

/**
 * Registers the Graph source when the deployment configured a mailbox. Called at module load;
 * silent and inert when the four settings are not all present, which is the pre-existing
 * behaviour of every install that has no mailbox.
 */
export const registerGraphMailSource = (): void => {
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
      clientSecret: ATM_MAIL_GRAPH_CLIENT_SECRET,
      userEmail: ATM_MAIL_GRAPH_USER,
      timeoutMs: env.ATM_MAIL_GRAPH_TIMEOUT_MS,
    }),
  );
  logger.info({ mailbox: ATM_MAIL_GRAPH_USER }, 'atm: microsoft graph mail source registered');
};
