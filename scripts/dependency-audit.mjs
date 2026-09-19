// The dependency gate (Security Architecture §4, "Dependency risk").
//
// Fails the pipeline for a HIGH or CRITICAL advisory in a production dependency. Until now the
// gate blocked criticals only, and shipped the build whenever npm's advisory endpoints could not
// be reached — after the 2026-07-26 registry incident, when every pipeline would otherwise have
// failed for days. Both of those were the wrong default and are changed here:
//
//   · high blocks too. A high is "exploitable, serious"; that is not a severity to ship on
//     silently. It is the severity of the multer and nodemailer advisories this gate found the
//     day it was widened.
//   · an outage FAILS. The registry is retried three times with backoff; if it still cannot
//     answer, the run is red — unless `dependency-audit.waivers.json` carries a dated
//     `outage` waiver, which is a reviewed, expiring decision to ship without the check rather
//     than the default behaviour of a script nobody reads. The same file waives an individual
//     advisory the same way: by id, with a reason and an expiry. Past its date a waiver fails
//     the run until it is renewed or the dependency is fixed, exactly as feature flags do
//     (`check-flag-expiry.mjs`).
//
// Moderate and low advisories are reported, never fatal: they are what the weekly Dependabot
// PRs are for.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = new URL('..', import.meta.url);
const WAIVERS_URL = new URL('./dependency-audit.waivers.json', import.meta.url);
const BLOCKING = new Set(['high', 'critical']);
const ATTEMPTS = 3;

const today = new Date().toISOString().slice(0, 10);
const waivers = JSON.parse(readFileSync(WAIVERS_URL, 'utf8'));

const fail = (message) => {
  process.stderr.write(`::error::${message}\n`);
  process.exit(1);
};

/** `npm audit --json`, or null when the registry did not give an answer this script can read. */
const audit = () => {
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['audit', '--omit=dev', '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  try {
    const report = JSON.parse(result.stdout);
    // A registry error still comes back as JSON, without the metadata block.
    if (report?.metadata?.vulnerabilities === undefined) return null;
    return report;
  } catch {
    return null;
  }
};

let report = null;
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  report = audit();
  if (report !== null) break;
  if (attempt < ATTEMPTS) {
    process.stdout.write(
      `npm audit gave no usable answer (attempt ${String(attempt)}/${String(ATTEMPTS)}); retrying\n`,
    );
    await sleep(attempt * 5_000);
  }
}

if (report === null) {
  const outage = waivers.outage ?? null;
  if (outage !== null && outage.until >= today) {
    process.stdout.write(
      `::warning::dependency audit SKIPPED — advisory endpoints unreachable and an outage waiver is in force until ${outage.until} (${outage.reason})\n`,
    );
    process.exit(0);
  }
  fail(
    'npm audit could not reach the advisory endpoints after 3 attempts. This is NOT a pass. ' +
      'If npmjs.com is down, a reviewer can add a dated `outage` waiver to scripts/dependency-audit.waivers.json.',
  );
}

// ── Advisories, by id ─────────────────────────────────────────────────────────

/** Every advisory object in the report, once, keyed by its GHSA id (the tail of its URL). */
const advisories = new Map();
for (const entry of Object.values(report.vulnerabilities ?? {})) {
  for (const via of entry.via) {
    if (typeof via !== 'object') continue;
    const id =
      String(via.url ?? '')
        .split('/')
        .pop() || `source-${String(via.source)}`;
    if (!advisories.has(id)) advisories.set(id, { id, ...via });
  }
}

const waived = new Map((waivers.advisories ?? []).map((w) => [w.id, w]));
const expired = [...waived.values()].filter((w) => w.until < today);
const unused = [...waived.values()].filter((w) => !advisories.has(w.id));

const blocking = [...advisories.values()].filter(
  (a) => BLOCKING.has(a.severity) && !waived.has(a.id),
);
const tolerated = [...advisories.values()].filter(
  (a) => BLOCKING.has(a.severity) && waived.has(a.id),
);
const counts = report.metadata.vulnerabilities;

// ── Report ────────────────────────────────────────────────────────────────────

for (const waiver of unused) {
  process.stdout.write(
    `::warning::waiver ${waiver.id} matches no current advisory — remove it from dependency-audit.waivers.json\n`,
  );
}
for (const advisory of tolerated) {
  const waiver = waived.get(advisory.id);
  process.stdout.write(
    `waived ${advisory.severity} ${advisory.id} in ${advisory.name} ${advisory.range} until ${waiver.until}: ${waiver.reason}\n`,
  );
}
process.stdout.write(
  `advisories in production dependencies: ${String(counts.critical)} critical, ${String(counts.high)} high, ${String(counts.moderate)} moderate, ${String(counts.low)} low\n`,
);

if (expired.length > 0) {
  for (const waiver of expired) {
    process.stderr.write(
      `EXPIRED WAIVER: ${waiver.id} (${waiver.package}) expired ${waiver.until} — fix the dependency or renew the waiver via PR review.\n`,
    );
  }
  fail(`${String(expired.length)} dependency waiver(s) past their expiry`);
}

if (blocking.length > 0) {
  for (const advisory of blocking) {
    process.stderr.write(
      `${advisory.severity.toUpperCase()}: ${advisory.title} — ${advisory.name} ${advisory.range} (${advisory.url})\n`,
    );
  }
  fail(
    `${String(blocking.length)} high/critical advisor${blocking.length === 1 ? 'y' : 'ies'} in production dependencies. ` +
      'Update the dependency, or — with a reason and an expiry — waive it in scripts/dependency-audit.waivers.json.',
  );
}

process.stdout.write(
  `dependency audit OK: no unwaived high or critical advisories (${String(tolerated.length)} waived, ${String(counts.moderate + counts.low)} lower-severity for Dependabot)\n`,
);
