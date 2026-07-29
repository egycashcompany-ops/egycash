// The event catalogue, checked against the code that actually publishes (A-2.1).
//
// `packages/contracts` describes the event surface; `apps/api` is the thing that emits it. Nothing
// connects the two at compile time, so this test connects them by reading the source: it resolves
// every `emit(...)` call site back to an event name and compares what it finds against what the
// catalogue claims.
//
// This is here because the catalogue is a PLATFORM API. A published contract that quietly stops
// matching its implementation is worse than no contract — an automation subscribing to an event
// nobody emits sits enabled and silent forever, and there is no error anywhere to find.
//
// It is source-scanning rather than runtime tracing on purpose: tracing only sees the events a
// test happens to trigger, which is a small and unrepresentative subset.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as contracts from '@ecms/contracts';
import {
  EVENT_CATALOG,
  EVENT_MULTI_PUBLISHER,
  eventCatalogEntry,
  isCatalogedEventName,
} from '@ecms/contracts';
import { WorkflowEvents } from '../../modules/hr/recruitment/workflow/workflow-events';

const API_SRC = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Emitted, but deliberately NOT in the catalogue: an internal request hop between a service and
 * its worker, not a business fact. Automating on it would mean automating on an implementation
 * detail of PDF rendering.
 */
const INTERNAL_EVENT_NAMES = new Set(['hr.contract.renderRequested']);

/**
 * The one emit site that publishes MANY event names from a single call — the recruitment workflow
 * engine mirroring its transitions onto the platform bus. Its payload is the transition, not any
 * one entity, so the payload-key check below cannot apply to it; `EVENT_MULTI_PUBLISHER` is where
 * that divergence is recorded instead.
 */
const MIRROR_FILE = 'workflow-dispatcher.ts';

const EVENT_NAME = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+$/;
const MEMBER = /\b([A-Z][A-Za-z0-9_]*)\.([A-Za-z0-9_]+)\b/g;

// Every `…Events` constant in play, so `HrLeaveEvents.Requested` in the source can be resolved to
// `hr.leave.requested` without evaluating anything. `WorkflowEvents` is API-side — the recruitment
// engine keeps its names next to its transition table — and belongs here for the same reason.
const EVENT_GROUPS: Record<string, Record<string, string>> = {
  ...(Object.fromEntries(
    Object.entries(contracts as Record<string, unknown>).filter(
      ([key, value]) =>
        key.endsWith('Events') &&
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value),
    ),
  ) as Record<string, Record<string, string>>),
  WorkflowEvents,
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });

const resolveMember = (group: string, member: string): string | undefined =>
  EVENT_GROUPS[group]?.[member];

/** The span of the first argument to `emit(`, and the index just past it. */
const firstArgument = (src: string, from: number): { text: string; end: number } | null => {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const ch = src[i] ?? '';
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return { text: src.slice(from, i), end: i };
      depth -= 1;
    } else if (ch === ',' && depth === 0) return { text: src.slice(from, i), end: i };
  }
  return null;
};

/** Top-level keys of an object literal starting at `open`. Nested and spread keys are skipped. */
const literalKeys = (src: string, open: number): string[] => {
  let depth = 0;
  let close = open;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i] ?? '';
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  return [...src.slice(open, close + 1).matchAll(/(?:^|\n)\s{0,80}([A-Za-z_$][\w$]*)\s*:/g)].map(
    (match) => match[1] ?? '',
  );
};

interface EmitSite {
  file: string;
  names: string[];
  payloadKeys: string[];
}

const scan = (): { sites: EmitSite[]; referenced: Set<string> } => {
  const sites: EmitSite[] = [];
  const referenced = new Set<string>();

  for (const file of sourceFiles(API_SRC)) {
    const src = readFileSync(file, 'utf8');

    // Any mention of an event constant counts as "the system knows this event". Weaker than an
    // emit site, and necessary: `file.processors.ts` dispatches through a lookup table, so its
    // three completion events never appear literally inside an `emit(` call.
    for (const match of src.matchAll(MEMBER)) {
      const name = resolveMember(match[1] ?? '', match[2] ?? '');
      if (name !== undefined) referenced.add(name);
    }

    for (const call of src.matchAll(/\bemit\(/g)) {
      const start = (call.index ?? 0) + call[0].length;
      const argument = firstArgument(src, start);
      if (argument === null) continue;

      const names: string[] = [];
      for (const match of argument.text.matchAll(MEMBER)) {
        const name = resolveMember(match[1] ?? '', match[2] ?? '');
        if (name !== undefined) names.push(name);
      }
      for (const literal of argument.text.matchAll(/'([^']+)'/g)) {
        // `mode === 'amend' ? A : B` also lives in an event argument; only event-shaped strings.
        if (EVENT_NAME.test(literal[1] ?? '')) names.push(literal[1] ?? '');
      }
      if (names.length === 0) continue;

      let cursor = argument.end + 1;
      while (cursor < src.length && /\s/.test(src[cursor] ?? '')) cursor += 1;
      sites.push({
        file,
        names,
        payloadKeys: src[cursor] === '{' ? literalKeys(src, cursor) : [],
      });
    }
  }
  return { sites, referenced };
};

const { sites, referenced } = scan();
const emitted = new Set(sites.flatMap((site) => site.names));

describe('the catalogue matches what the code emits', () => {
  it('found emit sites at all — a scanner that silently matches nothing proves nothing', () => {
    expect(sites.length).toBeGreaterThan(50);
    expect(emitted.size).toBeGreaterThan(50);
  });

  it('catalogues every event the API emits', () => {
    const missing = [...emitted].filter(
      (name) => !isCatalogedEventName(name) && !INTERNAL_EVENT_NAMES.has(name),
    );
    expect(missing).toEqual([]);
  });

  it('catalogues every name the recruitment workflow engine publishes', () => {
    // The engine keeps its own event constants next to its transition table. They reach the
    // platform bus through the dispatcher, so an automation can subscribe to them — which means
    // the catalogue has to know about them.
    const missing = Object.values(WorkflowEvents).filter((name) => !isCatalogedEventName(name));
    expect(missing).toEqual([]);
  });

  it('backs every `stable` event with something in the running system', () => {
    const orphans = EVENT_CATALOG.filter(
      (entry) => entry.status === 'stable' && !referenced.has(entry.name),
    );
    expect(orphans.map((entry) => entry.name)).toEqual([]);
  });

  it('keeps `planned` events genuinely unpublished', () => {
    // The direction that matters: when a planned event gains a publisher, this fails until
    // somebody promotes it to `stable` — so the catalogue cannot keep telling users it is dead.
    const published = EVENT_CATALOG.filter(
      (entry) => entry.status === 'planned' && emitted.has(entry.name),
    );
    expect(published.map((entry) => entry.name)).toEqual([]);
  });
});

describe('payload shapes', () => {
  it('emits no field the catalogue does not describe', () => {
    // One-directional on purpose: a key the scanner cannot see (a spread, a helper function) is
    // harmless, but a key that IS visible and is NOT in the catalogue means the published schema
    // is wrong — which is how `hr.contract.amended`'s `sourceContractId` was caught.
    const undescribed: string[] = [];
    for (const site of sites) {
      if (site.file.endsWith(MIRROR_FILE)) continue;
      for (const name of site.names) {
        const entry = eventCatalogEntry(name);
        if (entry === undefined || !entry.payloadDeclared) continue;
        const known = new Set(
          entry.fields.filter((field) => !field.path.includes('.')).map((field) => field.path),
        );
        for (const key of site.payloadKeys) {
          if (!known.has(key)) undescribed.push(`${name}.${key}`);
        }
      }
    }
    expect([...new Set(undescribed)]).toEqual([]);
  });

  it('records exactly the names with two publishers, no more and no fewer', () => {
    // `EVENT_MULTI_PUBLISHER` is hand-written in contracts, which cannot see this source. This is
    // what stops it going stale: the table has to equal the intersection the scanner computes.
    const mirrored = new Set<string>(Object.values(WorkflowEvents));
    const direct = new Set(
      sites.filter((site) => !site.file.endsWith(MIRROR_FILE)).flatMap((site) => site.names),
    );
    const actual = [...direct].filter((name) => mirrored.has(name)).sort();
    expect(Object.keys(EVENT_MULTI_PUBLISHER).sort()).toEqual(actual);
  });
});
