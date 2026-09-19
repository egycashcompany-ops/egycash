// Secret scanning as a CI stop (Security Architecture §4, "Secrets leakage").
//
// The document has said "secret scanning in CI" since the first review; until now nothing ran.
// This does: every TRACKED file is read and matched against the credential shapes below, and a
// hit fails the pipeline before a single dependency is installed. Tracked files only, on purpose —
// a developer's `.env` is untracked and theirs; what this guards is the commit.
//
// The rules are deliberately the high-confidence ones. A scanner that flags every `token: 'abc'`
// in a test is a scanner everybody learns to ignore; the rules here match the shapes real
// credentials actually have (a private key block, an AWS key id, a connection string carrying a
// password), and the one loose rule — a URL with `user:password@` in it — is validated against
// the obvious placeholders. A genuine false positive is allowlisted by fingerprint in
// `check-secrets.allowlist.json`, with a reason, in the same PR that reviews it.
//
// Nothing found is ever printed whole: the log shows the rule, the place, and a few characters.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const ALLOWLIST_URL = new URL('./check-secrets.allowlist.json', import.meta.url);

/** Files that are bytes, not text — matching a JPEG against regexes is noise and time. */
const BINARY =
  /\.(?:jpe?g|png|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz|xlsx?|docx?|pptx?|mp[34]|mov|bin|wasm)$/i;

/** A `user:password@` where the password is plainly a stand-in, not a credential. */
const PLACEHOLDER_PASSWORD =
  /^(?:<[^>]*>|\$\{[^}]*\}|\$[A-Z_]+|p|pass|password|passwd|pwd|secret|changeme|change-me|example|xxx+|\*+|\.{3}|your[-_]?password|redacted)$/i;

/**
 * Each rule: a name, a regex (global), and an optional `verify(match) => boolean` that turns a
 * loose regex into a precise rule. Match group 1, when present, is the part that must be real.
 */
const RULES = [
  {
    name: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { name: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    name: 'aws-secret-access-key',
    pattern: /aws[_-]?secret[_-]?access[_-]?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})\b/gi,
  },
  {
    name: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{80,})\b/g,
  },
  { name: 'slack-token', pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  {
    name: 'slack-webhook',
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
  },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g },
  { name: 'sendgrid-key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { name: 'twilio-api-key', pattern: /\bSK[0-9a-fA-F]{32}\b/g },
  { name: 'meta-access-token', pattern: /\bEAA[A-Za-z0-9]{80,}\b/g },
  { name: 'azure-storage-key', pattern: /AccountKey=([A-Za-z0-9+/=]{60,})/g },
  {
    name: 'sentry-dsn',
    pattern: /https:\/\/[0-9a-f]{32}@[a-z0-9.-]*ingest(?:\.[a-z]{2})?\.sentry\.io\/\d+/g,
  },
  // A signed JWT. n8n API keys and many OAuth tokens are exactly this shape.
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: 'connection-string-password',
    pattern:
      /\b(?:mongodb(?:\+srv)?|redis|rediss|amqps?|postgres(?:ql)?|mysql|smtps?):\/\/[^:/\s'"@]+:([^@\s'"]+)@/g,
    verify: (password) => password.length >= 6 && !PLACEHOLDER_PASSWORD.test(password),
  },
];

/** Paths that must never be tracked at all, whatever they contain. */
const FORBIDDEN_PATHS = [
  {
    name: 'env-file-tracked',
    test: (p) => /(?:^|\/)\.env(?:\.[^/]+)?$/.test(p) && !/\.(?:example|sample|template)$/.test(p),
  },
  {
    name: 'key-file-tracked',
    test: (p) =>
      /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(p) ||
      /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/.test(p),
  },
];

const fingerprint = (path, match) =>
  `${path}#${createHash('sha1').update(match).digest('hex').slice(0, 12)}`;

/** Enough to recognise, never enough to use. */
const redact = (match) =>
  match.length <= 8
    ? `${match.slice(0, 2)}…`
    : `${match.slice(0, 5)}…${match.slice(-2)} (${String(match.length)} chars)`;

const allowlist = new Map(
  JSON.parse(readFileSync(ALLOWLIST_URL, 'utf8')).map((entry) => [entry.fingerprint, entry]),
);
const usedAllowlist = new Set();

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter((path) => path !== '');

const findings = [];

for (const path of tracked) {
  for (const rule of FORBIDDEN_PATHS) {
    if (rule.test(path)) findings.push({ rule: rule.name, path, line: 0, shown: path });
  }
  if (BINARY.test(path)) continue;
  let text;
  try {
    text = readFileSync(new URL(path, ROOT), 'utf8');
  } catch {
    continue; // a submodule or a path git knows that the checkout does not have
  }
  if (text.includes('\0')) continue; // binary without a telling extension
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const secret = match[1] ?? match[0];
      if (rule.verify !== undefined && !rule.verify(secret)) continue;
      const print = fingerprint(path, match[0]);
      if (allowlist.has(print)) {
        usedAllowlist.add(print);
        continue;
      }
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({ rule: rule.name, path, line, shown: redact(match[0]), fingerprint: print });
    }
  }
}

const stale = [...allowlist.keys()].filter((print) => !usedAllowlist.has(print));
for (const print of stale) {
  process.stdout.write(
    `::warning::check-secrets allowlist entry no longer matches anything — remove it: ${print}\n`,
  );
}

if (findings.length > 0) {
  for (const finding of findings) {
    const where = finding.line === 0 ? finding.path : `${finding.path}:${String(finding.line)}`;
    process.stderr.write(
      `SECRET (${finding.rule}) at ${where}: ${finding.shown}` +
        (finding.fingerprint === undefined
          ? ''
          : `\n    if this is not a credential, allowlist it with a reason: ${finding.fingerprint}`) +
        '\n',
    );
  }
  process.stderr.write(
    `\n${String(findings.length)} finding(s). A real credential must be ROTATED, not just removed — it is in the history now.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `secret scan OK (${String(tracked.length)} tracked files, ${String(RULES.length)} rules, ${String(allowlist.size)} allowlisted)\n`,
);
