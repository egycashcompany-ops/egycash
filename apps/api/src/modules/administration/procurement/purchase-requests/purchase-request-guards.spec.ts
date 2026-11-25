// The purchase request's source-scan guards (design §5.16 specs 9, 10, 12 and 13; P2 plan §12.1,
// P2.2's share). Each holds a rule no type can: a status written from a second place, a write that
// skips its version, the engine asked a question the host must not ask, or a content write that
// could reach a request already ended. P2.3 and P2.4 add the submission's and the decision's own
// writes to the same scans, and spec 11's pairs.
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

  it('inside the feature, every write of a request is the service’s', () => {
    const writes =
      /\brepository\.(create|updateById|softDeleteById|restoreById|createManyUnordered)\(|\.(findOneAndUpdate|updateOne|updateMany|bulkWrite)\(/;
    const writers = sources()
      .filter((file) => file.startsWith(FEATURE))
      .filter((file) => writes.test(read(file)));
    expect(writers).toEqual([SERVICE]);
  });
});

describe('spec 10: every write is version-checked or status-filtered', () => {
  const service = read(SERVICE);

  it('every `updateById` carries the body’s version', () => {
    const calls = [...service.matchAll(/repository\.updateById\(([\s\S]*?)\n {4}\}\);/g)];
    expect(calls.length, 'the scan found the edit').toBeGreaterThan(0);
    for (const call of calls) expect(call[1]).toMatch(/version: input\.version/);
  });

  it('no conditional write leaves out the version or the status from its filter', () => {
    // The filter is read as the literal it is, nested braces and calls included, up to the update
    // document that follows it; a filter held in a variable cannot be read, so it is refused.
    // P2.2 writes no conditional update, so this has nothing to scan yet: P2.3's submission is the
    // first, and adds `expect(writes.length).toBeGreaterThan(0)` with it.
    expect(service).not.toMatch(/findOneAndUpdate\(\s*[A-Za-z_$][\w$]*\s*,/);
    const writes = [...service.matchAll(/findOneAndUpdate\(\s*(\{[\s\S]*?\})\s*,\s*\{\s*\$/g)];
    expect(writes.length, 'every conditional write was read').toBe(
      service.match(/findOneAndUpdate\(/g)?.length ?? 0,
    );
    for (const write of writes) {
      expect(write[1]).toMatch(/\b__v\b/);
      expect(write[1]).toMatch(/\bstatus\b/);
    }
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
    // The module's code series open transactions; P2.3's submission opens the request's first.
    const blocks = sources().flatMap((file) =>
      transactions(read(file)).map((block) => ({ file, block })),
    );
    expect(blocks.length, 'the scan found transactions at all').toBeGreaterThan(0);
    for (const { file, block } of blocks) {
      expect(block, file).not.toMatch(/approvalService\.decide\(/);
    }
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
