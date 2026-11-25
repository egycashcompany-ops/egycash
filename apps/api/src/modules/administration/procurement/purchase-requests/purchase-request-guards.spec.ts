// The purchase request's source-scan guards (design §5.16 specs 9, 10, 12 and 13; P2 plan §12.1).
// Each holds a rule no type can: a status written from a second place, a write that skips its
// version, the engine asked a question the host must not ask, or a content write that could reach
// a request already ended. P2.2 wrote the draft's; P2.3 adds the submission's conditional write,
// the repository's like every other, and its transaction — the number first, nothing announced
// inside it; P2.4 adds the decision's own writes to the same scans, and spec 11's pairs; P2.6 adds
// the file links, the one write outside the service, which writes the list alone.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMINISTRATION_PURCHASE_REQUEST_STATUSES, CONTENT_EDITABLE } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { statusesWhere, transitionsFrom } from '../../shared/lifecycle';
import { PURCHASE_REQUEST_TRANSITIONS } from './purchase-request-lifecycle';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = join(HERE, '..', '..');

/** Every non-spec source file of the module, relative to the module's folder. */
const sources = (dir = MODULE, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(relative(MODULE, full));
    }
  }
  return out;
};
const read = (file: string): string => readFileSync(join(MODULE, file), 'utf8');
const FEATURE = 'procurement/purchase-requests/';
const SERVICE = `${FEATURE}purchase-request.service.ts`;
const REPOSITORY = `${FEATURE}purchase-request.repository.ts`;
const FILES = `${FEATURE}purchase-request-files.ts`;

/**
 * Each call of `callee` in `source`, from its name to the parenthesis that closes it — the
 * arguments read whole, however the call is indented or wrapped.
 */
const callsOf = (source: string, callee: string): string[] =>
  [...source.matchAll(new RegExp(`${callee.replace(/[.$]/g, '\\$&')}\\(`, 'g'))].map((match) => {
    let depth = 0;
    for (let at = match.index + match[0].length - 1; at < source.length; at += 1) {
      if (source[at] === '(') depth += 1;
      else if (source[at] === ')' && --depth === 0) return source.slice(match.index, at + 1);
    }
    return source.slice(match.index);
  });

describe('the scan', () => {
  it('reads the module’s sources at all — a scan that matched nothing would pass', () => {
    expect(sources().length).toBeGreaterThan(30);
    expect(sources()).toContain(SERVICE);
  });
});

describe('spec 9: one writer of a request’s status', () => {
  it('no file outside the feature reaches its repository, and only the index list its model', () => {
    const repository = sources().filter(
      (file) => !file.startsWith(FEATURE) && read(file).includes('purchase-request.repository'),
    );
    expect(repository).toEqual([]);
    const model = sources().filter(
      (file) =>
        !file.startsWith(FEATURE) && /\bAdministrationPurchaseRequestModel\b/.test(read(file)),
    );
    expect(model).toEqual(['administration-indexes.ts']);
  });

  it('inside the feature, every write of a request is the service’s — but the file links’', () => {
    const writes =
      /\brepository\.(create|updateById|softDeleteById|restoreById|createManyUnordered)\(|\.(findOneAndUpdate|updateOne|updateMany|bulkWrite)\(/;
    const writers = sources()
      .filter((file) => file.startsWith(FEATURE))
      .filter((file) => writes.test(read(file)));
    // The repository writes for one caller: the file links (P2.6), below.
    expect(writers).toEqual([REPOSITORY, SERVICE]);
  });

  it('the repository’s one write is the file links’, which write the list and never the status (P2.6)', () => {
    const repository = read(REPOSITORY);
    expect(repository.match(/\.findOneAndUpdate\(/g), 'one write, the link write').toHaveLength(1);
    const link = repository.slice(repository.indexOf('private async linkWrite('));
    expect(link).toMatch(/\.findOneAndUpdate\(/);
    // Its two callers change the list alone, and the write itself sets only who wrote and moves
    // the version: no status is ever written here.
    expect([...repository.matchAll(/\{ \$(push|pull): \{ attachments: /g)]).toHaveLength(2);
    expect(link).toMatch(
      /\{ \.\.\.change, \$set: \{ updatedBy: new Types\.ObjectId\(by\) \}, \$inc: \{ __v: 1 \} \}/,
    );
    // And inside the feature, only the request's files call them.
    const callers = sources()
      .filter((file) => file.startsWith(FEATURE))
      .filter((file) => /\brepository\.(pushAttachment|pullAttachment)\(/.test(read(file)));
    expect(callers).toEqual([FILES]);
  });
});

describe('spec 10: every write is version-checked or status-filtered', () => {
  const service = read(SERVICE);

  it('every `updateById` carries the body’s version — the edit’s and the submission’s', () => {
    const calls = callsOf(service, 'repository.updateById');
    expect(calls.length, 'the scan found the edit and the submission').toBe(2);
    for (const call of calls) expect(call).toMatch(/version: input\.version/);
  });

  it('the service builds no query: every write is the repository’s conditional one', () => {
    // Coding standards §2: a service builds no Mongoose query, so no write can leave out the
    // version or the draft condition the repository's seam puts in every filter.
    expect(service).not.toMatch(/\.(findOneAndUpdate|updateOne|updateMany|bulkWrite)\(/);
    expect(service).not.toMatch(/\bAdministrationPurchaseRequestModel\b/);
    const seam = readFileSync(
      join(MODULE, '..', '..', 'shared', 'base', 'base.repository.ts'),
      'utf8',
    );
    const [updateById] = callsOf(seam, 'this.baseFilter').filter((call) =>
      call.includes('__v: meta.version'),
    );
    expect(updateById, 'the seam’s version-held filter').toBeDefined();
    expect(updateById).toMatch(/\.\.\.this\.writeConditions\(\)/);
  });

  it('the file link holds the version and the draft status in its filter (P2.6)', () => {
    const repository = read(REPOSITORY);
    const filter =
      /private async linkWrite\([\s\S]*?this\.baseFilter\(scope, \{([\s\S]*?)\}\)/.exec(
        repository,
      )?.[1];
    expect(filter, 'the scan read the filter').toBeDefined();
    expect(filter).toMatch(/__v: version/);
    // `writeConditions()` is the draft set (spec 13).
    expect(filter).toMatch(/\.\.\.this\.writeConditions\(\)/);
  });

  it('a file write answers the requester and the status before the version, and the version before the list’s bound (P2 plan §4.2)', () => {
    const files = read(FILES);
    const add = files.slice(files.indexOf('\n  async add('), files.indexOf('\n  async remove('));
    const load = add.indexOf('await loadForWrite(');
    const version = add.indexOf('assertCurrentVersion(doc, input.version)');
    const bound = add.indexOf('isListFull(doc.attachments.length)');
    expect(load).toBeGreaterThan(0);
    expect(version).toBeGreaterThan(load);
    expect(bound).toBeGreaterThan(version);
    const refusal = files.slice(files.indexOf('export const attachmentWriteRefusal'));
    expect(refusal.indexOf('isRequester(')).toBeLessThan(refusal.indexOf('CONTENT_EDITABLE['));
  });

  it('the version is answered before the act’s rules, and after the status (P2 plan §4.2)', () => {
    const update = service.slice(service.indexOf('  async update('));
    const status = update.indexOf('CONTENT_EDITABLE[before.status]');
    const version = update.indexOf('assertCurrentVersion(before, input.version)');
    const rules = update.indexOf('this.linesFor(');
    expect(status).toBeGreaterThan(0);
    expect(version).toBeGreaterThan(status);
    expect(rules).toBeGreaterThan(version);
  });

  it('so is a submission’s: reach and ownership, the status, the version, then its rules', () => {
    const submit = service.slice(
      service.indexOf('  async submit('),
      service.indexOf('\n  }\n', service.indexOf('  async submit(')),
    );
    const order = [
      'keyCoversUnit(ctx, CREATE',
      'isRequester(before, ctx.userId)',
      'assertSubmittable(before)',
      'assertCurrentVersion(before, input.version)',
      'submitProblem(',
      'approvalUnitOf(before)',
      'chainForSubmission(',
      'unitOfWork(',
    ].map((step) => [step, submit.indexOf(step)] as const);
    for (const [step, at] of order) expect(at, step).toBeGreaterThan(0);
    expect(order.map(([step]) => step)).toEqual(
      [...order].sort((a, b) => a[1] - b[1]).map(([step]) => step),
    );
  });
});

describe('spec 12: the engine is asked only what the host may ask', () => {
  it('no file of the module asks `approvalService.statusFor(` (P2 plan §1.2 item 17)', () => {
    expect(sources().filter((file) => read(file).includes('statusFor('))).toEqual([]);
  });

  /**
   * Each `unitOfWork(` callback, from the call to the line that closes it at the call's own indent
   * — or to the end of the file, which reads too much rather than too little.
   */
  const transactions = (source: string): string[] =>
    [...source.matchAll(/^( *).*\bunitOfWork\(/gm)].map((call) => {
      const end = source.indexOf(`\n${call[1] ?? ''}})`, call.index);
      return source.slice(call.index, end === -1 ? undefined : end);
    });

  it('no `decide(` of the engine runs inside a `unitOfWork(` callback', () => {
    // The module's code series open transactions, and the request's submission opens its first.
    const blocks = sources().flatMap((file) =>
      transactions(read(file)).map((block) => ({ file, block })),
    );
    expect(blocks.length, 'the scan found transactions at all').toBeGreaterThan(0);
    expect(blocks.map(({ file }) => file)).toContain(SERVICE);
    for (const { file, block } of blocks) {
      expect(block, file).not.toMatch(/approvalService\.decide\(/);
    }
  });

  it('the submission’s transaction takes the number first, and announces nothing inside it', () => {
    // Design §5.1.3, T: the counter is the first write, so a lost race gives its number back; the
    // callback may run more than once, so the audit, the notice and the event wait for the commit.
    const [block] = transactions(read(SERVICE));
    expect(block, 'the submission’s transaction').toBeDefined();
    const number = block?.indexOf('nextNumber(') ?? -1;
    expect(number).toBeGreaterThan(0);
    const [write] = callsOf(block ?? '', 'repository.updateById');
    expect(write, 'the conditional write inside it').toBeDefined();
    expect(block?.indexOf('repository.updateById(')).toBeGreaterThan(number);
    // Written on the transaction's session, so an abort takes the move back with the number.
    expect(write).toMatch(/\bsession\b/);
    expect(block).not.toMatch(/audit[A-Za-z]*\(|notify[A-Za-z]*\(|announce[A-Za-z]*\(|\bemit\(/);
    // The engine's chain and its approvers are read before the transaction begins (P2 plan §8.2).
    expect(block).not.toMatch(/chainForSubmission\(|approvalService\./);
  });
});

describe('spec 13: no content write can match a request that has ended', () => {
  const terminal = ADMINISTRATION_PURCHASE_REQUEST_STATUSES.filter(
    (status) => transitionsFrom(PURCHASE_REQUEST_TRANSITIONS, status).length === 0,
  );

  it('the content set holds no terminal status', () => {
    expect(terminal).toEqual(['rejected', 'cancelled', 'closed']);
    expect(statusesWhere(CONTENT_EDITABLE).filter((s) => terminal.includes(s))).toEqual([]);
  });

  it('the repository’s every content write is filtered by that set, and names the refusal', () => {
    const repository = read(`${FEATURE}purchase-request.repository.ts`);
    expect(repository).toMatch(
      /protected override writeConditions\(\)[^{]*\{\s*return \{ status: \{ \$in: statusesWhere\(CONTENT_EDITABLE\) \} \};/,
    );
    expect(repository).toMatch(
      /protected override assertWritable\([\s\S]*?if \(!CONTENT_EDITABLE\[current\.status\]\) throw invalidTransition/,
    );
  });
});
