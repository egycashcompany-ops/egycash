// Which work types count for the maintenance alarm.
//
// The list decides every vehicle's baseline, so getting it wrong is not a narrow bug: emptying it
// turns the whole fleet to `noService` at once, with every visit still sitting in the database and
// nothing on any screen saying why.
//
// Two ways it was wrong. It filtered on `isActive`, which conflates "you may no longer CHOOSE
// this" with "this never counted" — and only ONE row is seeded with `countsForAlarm`, so
// archiving that row was a single click away from erasing the alarm system's entire history. And
// it read a PAGE, which `BaseRepository.list` clamps to MAX_PAGE_SIZE, so past the hundredth type
// it would have stopped counting rather than failed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_PAGE_SIZE } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const repository = readFileSync(join(HERE, 'catalog-item.repository.ts'), 'utf8');
const engine = readFileSync(join(HERE, '../maintenance/maintenance-alarm.ts'), 'utf8');

const method = (source: string, name: string): string => {
  const start = source.indexOf(`  async ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n  }\n', start));
};

describe('archiving a work type does not un-make the services it named', () => {
  it('the counting list does NOT filter on isActive', () => {
    const body = method(repository, 'countingWorkTypeIds');
    expect(body, 'counts for the alarm').toContain('countsForAlarm: true');
    expect(body, 'and only work types').toContain("kind: 'workType'");
    expect(body, 'but archived ones still count').not.toContain('isActive');
  });

  it('the alarm engine asks that method and nothing else', () => {
    expect(engine).toContain('fleetCatalogItemRepository.countingWorkTypeIds()');
    // No second, private copy of the question — the drift this whole finding is about.
    expect(engine, 'no inline catalog filter survives').not.toMatch(/kind:\s*'workType'/);
    expect(engine).not.toContain('countsForAlarm: true');
  });

  it('`isActive` still guards the WRITE path — an archived type is unchoosable', () => {
    // The distinction the fix rests on. Reading history must ignore `isActive`; choosing a type
    // for a NEW visit must not. If `findActiveOfKind` ever stopped checking it, archiving would
    // become meaningless in the other direction.
    expect(method(repository, 'findActiveOfKind')).toContain('doc.isActive');
    const service = readFileSync(join(HERE, '../maintenance/maintenance.service.ts'), 'utf8');
    expect(service).toContain("assertCatalogRef(input.workTypeId, 'workType', 'workTypeId')");
  });
});

describe('the list is not silently truncated', () => {
  it('it is a distinct query, not a page', () => {
    const body = method(repository, 'countingWorkTypeIds');
    expect(body).toContain(".distinct('_id'");
    expect(body, 'no page bound').not.toMatch(/pageSize|page:/);
  });

  it('and a page would have been bounded — which is why it is not one', () => {
    // `BaseRepository.list` clamps with `Math.min(params.pageSize, MAX_PAGE_SIZE)`, so asking for
    // more than the cap is not a way out; the previous code asked for exactly the cap.
    const base = readFileSync(join(HERE, '../../../shared/base/base.repository.ts'), 'utf8');
    expect(base).toContain('Math.min(params.pageSize, MAX_PAGE_SIZE)');
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it('soft-deleted rows are still excluded — deleted is not archived', () => {
    // Archiving says "no longer offered"; a soft delete says "this row was a mistake". Only the
    // first is a statement about history.
    expect(method(repository, 'countingWorkTypeIds')).toContain('isDeleted: false');
  });
});
