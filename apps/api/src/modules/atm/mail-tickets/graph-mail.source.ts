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
import { randomUUID } from 'node:crypto';
import { OutboundBlockedError, outboundFetch } from '../../../infrastructure/http/outbound';
import { logger } from '../../../infrastructure/logging/logger';
import { env } from '../../../infrastructure/config/env';
import { getSecretStore } from '../../../platform/secrets';
import {
  registerAtmMailSource,
  registerAtmMailSourceFactory,
  type AtmMailMessage,
  type AtmMailPage,
  type AtmMailSource,
  type AtmMailWindow,
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

/**
 * A receipt time as Graph writes it (`2026-11-13T07:59:12Z`, fractions allowed) — the only shape a
 * page's `before` may take, since it is written into the query's `$filter` as it stands.
 */
const GRAPH_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$/;

/**
 * Graph's own name for an error (`UnknownError`, `ErrorTimeoutExpired`, `invalid_client`) — the
 * only part of an error body that goes into the message the screen shows, and only in this shape.
 */
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
/** How much of Graph's error text the log keeps. */
const ERROR_TEXT_MAX = 300;

interface GraphFailureDetail {
  /** The HTTP status; null when nothing came back in time. */
  status: number | null;
  /** Graph's error code, when it gave one in the shape above. */
  graphCode: string | null;
  /**
   * Graph's error text, cut short — for the log, never the screen. For an outbound refusal: the
   * door's reason, which the screen shows as well.
   */
  graphMessage: string | null;
  /** The id Graph gave the request (`request-id`), the one Microsoft support asks for. */
  requestId: string | null;
  /** The `Retry-After` Graph asked for, as it wrote it. */
  retryAfter: string | null;
}

/**
 * A request Graph refused or did not answer (2026-11-13: «This operation was aborted» said neither
 * which request nor what Graph made of it). The message names the status — or the wait — and the
 * path, plus Graph's error code; never the secret, never the body. The rest rides along as fields
 * for the log: the ids Microsoft support can find the request by, how long it took.
 */
export class GraphRequestError extends Error {
  readonly status: number | null;
  readonly graphCode: string | null;
  readonly graphMessage: string | null;
  readonly requestId: string | null;
  readonly retryAfter: string | null;

  constructor(
    message: string,
    detail: GraphFailureDetail,
    /** The id this transport sent (`client-request-id`), so even a request never answered has one. */
    readonly clientRequestId: string,
    readonly elapsedMs: number,
    /** What failed underneath — a connection's error, its stack and its cause — for the log. */
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GraphRequestError';
    this.status = detail.status;
    this.graphCode = detail.graphCode;
    this.graphMessage = detail.graphMessage;
    this.requestId = detail.requestId;
    this.retryAfter = detail.retryAfter;
  }
}

/** A failure that carries nothing from Graph — no status, no body, no id. */
const NO_ANSWER: GraphFailureDetail = {
  status: null,
  graphCode: null,
  graphMessage: null,
  requestId: null,
  retryAfter: null,
};

/**
 * The reason a request failed before Graph answered: the system code of the error or of its
 * `cause` (`ECONNRESET`, `UND_ERR_SOCKET`, `ECONNREFUSED`), else none; and the text, cut short, for
 * the log. A host that does not resolve never gets here under the default policy: the outbound
 * door resolves it first and refuses (`OutboundBlockedError`, below).
 */
const connectionFailureOf = (error: unknown): { code: string | null; text: string | null } => {
  const layers = [error, error instanceof Error ? error.cause : undefined];
  let code: string | null = null;
  let text: string | null = null;
  for (const layer of layers) {
    if (layer === null || typeof layer !== 'object') continue;
    const own = (layer as { code?: unknown }).code;
    if (typeof own === 'string' && ERROR_CODE.test(own)) code = own;
    if (layer instanceof Error && layer.message !== '')
      text = layer.message.slice(0, ERROR_TEXT_MAX);
  }
  return { code, text };
};

const textField = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * What an error response says about itself. Graph writes `{ error: { code, message, innerError:
 * { 'request-id' } } }`; the token endpoint `{ error: 'invalid_client', error_description,
 * trace_id }`. A body that is neither, or never arrives, says nothing.
 */
const failureOf = async (response: Response): Promise<GraphFailureDetail> => {
  let body: unknown = null;
  try {
    body = JSON.parse(await response.text());
  } catch {
    body = null;
  }
  const error =
    body !== null && typeof body === 'object' ? (body as { error?: unknown }).error : null;
  const nested =
    error !== null && typeof error === 'object'
      ? (error as { code?: unknown; message?: unknown; innerError?: { 'request-id'?: unknown } })
      : null;
  const code = nested === null ? textField(error) : textField(nested.code);
  const text =
    nested === null
      ? textField((body as { error_description?: unknown } | null)?.error_description)
      : textField(nested.message);
  return {
    status: response.status,
    graphCode: code !== null && ERROR_CODE.test(code) ? code : null,
    graphMessage: text === null ? null : text.slice(0, ERROR_TEXT_MAX),
    requestId:
      textField(response.headers.get('request-id')) ??
      textField(nested?.innerError?.['request-id']) ??
      textField((body as { trace_id?: unknown } | null)?.trace_id),
    retryAfter: textField(response.headers.get('retry-after')),
  };
};

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

  /**
   * One request. Its failure is a `GraphRequestError`: status — or the wait, or the connection's
   * own code — and path, Graph's error code, the request's ids; never the secret, never a body.
   */
  private async fetchJson<T>(url: string, init: RequestInit, authorize = true): Promise<T> {
    const clientRequestId = randomUUID();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'client-request-id': clientRequestId,
      'return-client-request-id': 'true',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (authorize) headers.authorization = `Bearer ${await this.accessToken()}`;
    const path = new URL(url).pathname;
    const started = Date.now();
    const failed = (
      message: string,
      detail: GraphFailureDetail,
      cause?: unknown,
    ): GraphRequestError =>
      new GraphRequestError(message, detail, clientRequestId, Date.now() - started, cause);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await outboundFetch(url, { ...init, headers, signal: controller.signal });
      if (!response.ok) {
        // A 401 means the cached token went stale early; drop it so the next call re-authenticates.
        if (response.status === 401) this.token = null;
        const detail = await failureOf(response);
        const code = detail.graphCode === null ? '' : ` (${detail.graphCode})`;
        throw failed(`microsoft graph ${String(response.status)} on ${path}${code}`, detail);
      }
      if (response.status === 204) return {} as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof GraphRequestError) throw error;
      if (controller.signal.aborted) {
        const seconds = String(Math.round(this.config.timeoutMs / 1000));
        throw failed(
          `microsoft graph did not answer within ${seconds} s on ${path}`,
          NO_ANSWER,
          error,
        );
      }
      // Refused by the outbound door before a socket opened — the host does not resolve, is not on
      // the allowlist, or resolves to a private address. Its reason names only the host and the
      // address, and is what tells them apart, so the screen keeps it.
      if (error instanceof OutboundBlockedError) {
        throw failed(
          `microsoft graph request refused on ${path}: ${error.reason}`,
          { ...NO_ANSWER, graphMessage: error.reason.slice(0, ERROR_TEXT_MAX) },
          error,
        );
      }
      // The connection itself failed (reset, TLS, DNS, a refused host) or the answer could not be
      // read: undici says only «fetch failed», the reason is on its `cause`.
      const reason = connectionFailureOf(error);
      const named = reason.code === null ? '' : ` (${reason.code})`;
      throw failed(
        `microsoft graph request failed on ${path}${named}`,
        { ...NO_ANSWER, graphCode: reason.code, graphMessage: reason.text },
        error,
      );
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
   * Newest first, within a range of receipt times — never every date, never by `$skip`. The mailbox
   * weighs every mail in the range: asked for the newest unread of every date, then of two days, it
   * gave up after some twenty seconds (2026-11-13, «502 UnknownError»), so the caller keeps the
   * range short (`mail-poll.service.ts`). `receivedDateTime` leads the `$filter` because Graph requires every `$orderby`
   * property to appear there, first and in the same order — otherwise it refuses the listing
   * (`InefficientFilter`).
   */
  async listUnreadPage(limit: number, window: AtmMailWindow): Promise<AtmMailPage> {
    for (const bound of [window.since, window.before]) {
      if (bound !== null && !GRAPH_INSTANT.test(bound)) {
        throw new Error('microsoft graph listing: the page bound is not a receipt time');
      }
    }
    const range =
      window.before === null
        ? `receivedDateTime ge ${window.since}`
        : `receivedDateTime ge ${window.since} and receivedDateTime lt ${window.before}`;
    const path =
      `${GRAPH_ROOT}/users/${encodeURIComponent(this.config.userEmail)}/messages` +
      `?$filter=${encodeURIComponent(`${range} and isRead eq false`)}` +
      `&$orderby=receivedDateTime%20desc&$top=${String(limit)}` +
      `&$select=id,subject,from,body,receivedDateTime,isRead`;
    const payload = await this.fetchJson<{ value?: GraphMessage[] }>(path, { method: 'GET' });
    const listed = payload.value ?? [];
    const last = listed[listed.length - 1];
    const oldest = last === undefined ? '' : text(last.receivedDateTime);
    return {
      messages: toMailMessages(listed),
      listed: listed.length,
      oldest: oldest === '' ? null : oldest,
    };
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
