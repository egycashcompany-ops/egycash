// Snapshot redaction (ADR-018 §7.3, §7.4) — PURE, so the one thing that must never leak is
// testable exhaustively without a database, a queue or a provider.
//
// Execution snapshots are business data and get retained. A workflow that authenticates to an
// external system passes its credential through nodes, so without this the secret ends up in
// `automation_executions.inputSnapshot`, in the execution timeline a support engineer opens, and
// in whatever the retention policy exports. Redaction happens BEFORE the snapshot is written, not
// on the way out — a value that reaches the collection is already leaked.
//
// Two independent strategies, on purpose. Neither is sufficient alone:
//   - by NAME catches a secret in a field nobody registered (`{ password: '…' }` from a node's own
//     output), including values this process never held;
//   - by VALUE catches a registered secret in a field with an innocent name (`{ url:
//     'https://user:p@ss@host' }`), which no name list can anticipate.

export const REDACTED = '[redacted]';

/**
 * Field names whose VALUE is a secret regardless of what it contains. Matched case-insensitively
 * against the key, as a substring — `apiKey`, `x-api-key`, `refreshToken` and `clientSecret` all
 * have to hit, and enumerating exact names would miss the next one a node invents.
 */
// Separators are optional throughout, because the same field arrives as `apiKey`, `api_key` and
// `X-API-Key` depending on whether it came from JSON, an env var or an HTTP header.
const SECRET_NAME_PATTERN =
  /(pass|pwd|secret|token|api[-_]?key|credential|authorization|auth[-_]?header|private[-_]?key|signature|session)/i;

/** Below this length a "secret" match is more likely a coincidence than a leak. */
const MIN_MATCHABLE_SECRET = 6;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace every occurrence of a known secret inside a string, wherever it sits — a query string, a
 * Basic auth header, a JSON blob a node stringified. Substring replacement rather than equality:
 * a secret embedded in a URL is the common case, and equality would sail straight past it.
 */
const redactValuesInString = (text: string, secrets: readonly string[]): string => {
  let result = text;
  for (const secret of secrets) {
    if (secret.length < MIN_MATCHABLE_SECRET) continue;
    result = result.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
  }
  return result;
};

interface RedactOptions {
  /** Plaintext secret values in play for this execution. Never logged, never stored. */
  secrets?: readonly string[];
  /** Guard against a cyclic or pathological structure — snapshots are attacker-influenced data. */
  maxDepth?: number;
}

/**
 * A redacted deep copy. Never mutates the input: the caller is usually holding the real payload to
 * hand to the provider, and redacting it in place would send `[redacted]` to the integration.
 */
export const redactSnapshot = (value: unknown, options: RedactOptions = {}): unknown => {
  const secrets = options.secrets ?? [];
  const maxDepth = options.maxDepth ?? 12;

  const walk = (node: unknown, depth: number, keyIsSecret: boolean): unknown => {
    if (keyIsSecret) return REDACTED;
    // Past the depth limit the shape is either cyclic or absurd. Dropping the subtree is the safe
    // failure: an omitted branch cannot leak, a passed-through one can.
    if (depth > maxDepth) return REDACTED;

    if (typeof node === 'string') return redactValuesInString(node, secrets);
    if (node === null || typeof node !== 'object') return node;

    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1, false));

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      out[key] = walk(child, depth + 1, SECRET_NAME_PATTERN.test(key));
    }
    return out;
  };

  return walk(value, 0, false);
};

/**
 * Whether a redacted snapshot still contains a secret. Used as a belt-and-braces assertion at the
 * write boundary rather than as a filter: if this ever returns true the snapshot is dropped
 * entirely, because "we think we cleaned it" is not a standard to store a credential under.
 */
export const containsSecret = (snapshot: unknown, secrets: readonly string[]): boolean => {
  if (secrets.length === 0) return false;
  const serialized = JSON.stringify(snapshot) ?? '';
  return secrets.some(
    (secret) => secret.length >= MIN_MATCHABLE_SECRET && serialized.includes(secret),
  );
};

/** The name test on its own, for callers redacting something that is not a snapshot tree. */
export const isSecretFieldName = (name: string): boolean => SECRET_NAME_PATTERN.test(name);
