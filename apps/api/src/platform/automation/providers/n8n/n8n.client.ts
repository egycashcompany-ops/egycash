// A reusable n8n HTTP client (A-5).
//
// The ONE place ECMS talks HTTP to n8n. Everything about the transport lives here — base URL,
// auth header, timeout, retry, structured logging — so every future consumer (the automation
// provider today; HR, Fleet, Contracts, ATM tomorrow, always THROUGH the provider seam, never
// importing n8n directly) gets the same hardened client rather than its own fetch call.
//
// Nothing here is n8n-workflow-aware. It sends authenticated requests and reports what happened.
// Building workflows, mapping triggers, interpreting responses — none of that is the client's job.
import { setTimeout as delay } from 'node:timers/promises';
import { logger } from '../../../../infrastructure/logging/logger';

export interface N8nClientOptions {
  /** From `N8N_BASE_URL`. Never hardcoded. Trailing slash trimmed so path joins are predictable. */
  baseUrl: string;
  /** From `N8N_API_KEY`. Sent as `X-N8N-API-KEY`; omitted when absent. */
  apiKey?: string | undefined;
  timeoutMs?: number;
  /** Transport-failure retries (never a 4xx — that would fail identically). */
  maxRetries?: number;
}

export interface N8nResponse {
  status: number;
  ok: boolean;
  /** Parsed JSON when the body is JSON, else the raw text; never logged wholesale. */
  body: unknown;
}

/** Per-request headers (correlation id, idempotency key). `undefined` values are dropped. */
export type RequestHeaders = Record<string, string | undefined>;

/** A transport or non-2xx failure. Carries a status when there was a response, `null` otherwise. */
export class N8nRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'N8nRequestError';
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class N8nClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: N8nClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  private headers(extra: RequestHeaders = {}): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      // n8n's REST API and header-auth webhooks both accept this header. Never logged.
      ...(this.apiKey === undefined ? {} : { 'x-n8n-api-key': this.apiKey }),
      // Correlation + idempotency travel with the request so the run is traceable across ECMS and
      // n8n, and a retried trigger is dedupable downstream. `undefined` entries are dropped.
      ...Object.fromEntries(
        Object.entries(extra).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    };
  }

  /**
   * One authenticated request, with bounded retry on transport failures and retryable statuses.
   * Throws `N8nRequestError` on final failure; callers decide whether that is fatal (the provider's
   * dispatch lets it propagate to `automationService`, which turns it into a best-effort skip).
   *
   * `extraHeaders` carries the correlation id (`x-request-id`) and idempotency key
   * (`idempotency-key`) — kept identical across retries so n8n sees one logical trigger.
   */
  async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: RequestHeaders = {},
  ): Promise<N8nResponse> {
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method,
          headers: this.headers(extraHeaders),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await response.text();
        const parsed = text === '' ? null : this.tryJson(text);

        if (!response.ok) {
          if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
            // Log the STATUS, never the body — an error body can echo the request payload.
            logger.warn(
              { status: response.status, method, path, attempt },
              'n8n request returned a retryable status; retrying',
            );
            await delay(2 ** attempt * 200);
            continue;
          }
          throw new N8nRequestError(`n8n responded ${response.status}`, response.status);
        }
        return { status: response.status, ok: true, body: parsed };
      } catch (error) {
        lastError = error;
        // A 4xx (thrown above) is not retryable and rethrows immediately.
        if (error instanceof N8nRequestError && error.status !== null && !RETRYABLE_STATUS.has(error.status)) {
          throw error;
        }
        if (attempt < this.maxRetries) {
          logger.warn({ method, path, attempt }, 'n8n request failed (transport); retrying');
          await delay(2 ** attempt * 200);
          continue;
        }
      }
    }
    throw lastError instanceof N8nRequestError
      ? lastError
      : new N8nRequestError('n8n request failed after retries', null);
  }

  /**
   * Reachability, for `/health`. NEVER throws — health is how the platform LEARNS n8n is down, and
   * a throw would turn a monitoring signal into an outage. Uses the REST healthz endpoint, which
   * needs no auth and no workflow to exist.
   */
  async health(): Promise<{ reachable: boolean; detail?: string }> {
    try {
      const response = await this.request('GET', '/healthz');
      return { reachable: response.ok, detail: `n8n healthz ${response.status}` };
    } catch (error) {
      return {
        reachable: false,
        detail: error instanceof Error ? error.message : 'n8n unreachable',
      };
    }
  }

  private tryJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
