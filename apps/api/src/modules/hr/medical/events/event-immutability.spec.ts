// D9 — a medical event records what was said on a day, and is never edited.
//
// THE SEAM IS A WRITE CONDITION THAT NOTHING SATISFIES, not a rule services are asked to remember.
// The alternative — trusting every future service never to call `updateById` — holds until somebody
// adds a «fix a typo in the provider's name» endpoint in good faith. This way that endpoint does
// not work, and the person writing it finds out on their first run rather than after it ships.
//
// The stronger half is that the event stores NO LINK TO ITS DOCUMENT. A row that can never be
// written cannot have a file id assigned after an upload, and making an exception for «just this
// one field» would be a hole in the seam sized exactly for the next exception. The file points at
// the event instead.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

/** The EVENT repository only — the profile's, above it in the file, is writable and must stay so. */
const eventRepo = (): string => {
  const all = strip(read('../medical.repository.ts'));
  const from = all.indexOf('class MedicalEventRepository');
  expect(from, 'the event repository exists').toBeGreaterThan(-1);
  const next = all.indexOf('\nclass ', from + 1);
  return next === -1 ? all.slice(from) : all.slice(from, next);
};

describe('nothing can write a medical event after it is recorded', () => {
  it('declares a write condition that matches nothing', () => {
    const repo = eventRepo();
    expect(repo).toContain('writeConditions()');
    expect(repo).toContain('_id: null');
  });

  /**
   * And explains it. Without `assertWritable`, a blocked write surfaces as a version conflict and
   * the caller is told to refresh and try again — advice that will never come true.
   */
  it('explains the refusal rather than reporting a stale version', () => {
    expect(eventRepo()).toContain('assertWritable');
    expect(eventRepo()).toContain('BusinessRuleError');
  });

  /** The PROFILE stays writable. A guard that froze both would break correcting a blood type. */
  it('leaves the profile repository alone', () => {
    const all = strip(read('../medical.repository.ts'));
    const profile = all.slice(
      all.indexOf('class MedicalProfileRepository'),
      all.indexOf('class MedicalEventRepository'),
    );
    expect(profile).not.toContain('writeConditions');
  });
});

describe('the event holds no mutable link', () => {
  it('stores no document id', () => {
    const model = strip(read('medical-event.model.ts'));
    expect(model).not.toContain('documentFileId');
    expect(model).not.toContain('documentFileName');
  });

  /**
   * And the service uploads the file AGAINST the event rather than writing a link back onto it —
   * the one direction that does not require the row to change.
   */
  it('files the document against the event', () => {
    const service = strip(read('medical-event.service.ts'));
    expect(service).toContain('MEDICAL_EVENT_ENTITY_TYPE');
    expect(service).toContain('entityId: String(doc._id)');
  });
});

/**
 * NO UPDATE AND NO DELETE ROUTE (D9). Their absence is the design, so it is asserted rather than
 * left to be noticed — a `router.patch` here would be an endpoint that always fails, which reads
 * to a caller like a bug in the server rather than a decision about records.
 */
describe('no route offers to change one', () => {
  it('declares neither a patch nor a delete', () => {
    const all = strip(read('../medical.routes.ts'));
    const from = all.indexOf('buildMedicalEventsRouter');
    expect(from).toBeGreaterThan(-1);
    // Bounded by the NEXT builder, not by the end of the file. An open-ended slice grows a false
    // failure the day somebody appends a router — and M4's insurance router, which legitimately
    // has a `patch`, is exactly that day.
    const next = all.indexOf('export const build', from + 1);
    const block = next === -1 ? all.slice(from) : all.slice(from, next);
    expect(block).not.toContain('router.patch');
    expect(block).not.toContain('router.delete');
    expect(block).not.toContain('router.put');
  });
});
