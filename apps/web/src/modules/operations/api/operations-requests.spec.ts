// The requests the Operations screens actually put on the wire, checked against the schemas that
// receive them (B8).
//
// WHY THIS EXISTS. Every Operations table rendered "تعذّر التحميل" in the browser while every
// gate in the repository was green. The cause was mundane: pages asked for `pageSize: 200` and
// `500`, the platform ceiling is 100, and the query schemas are `.strict()` — so the API answered
// 400 and TanStack Query surfaced the rejection as the table's error state.
//
// Nothing could have caught it. The frontend builds a query STRING; the backend parses it with a
// zod schema; between them is only a URL. Typecheck sees a `QueryParams` object on one side and a
// `ListOperationsReferenceQuery` on the other and never puts them in the same room.
//
// So this file puts them in the same room. It builds the query exactly as `buildQuery` does and
// parses it with the REAL exported schema — the same object the API mounts. No mock, no fake, no
// database: a failure here is a 400 in the browser.
import { describe, expect, it } from 'vitest';
import {
  CancelVaultReceiptSchema,
  ConfirmSecuredPickupSchema,
  ListOperationsBankBranchesQuerySchema,
  ListOperationsCrewRequirementsQuerySchema,
  ListOperationsReferenceQuerySchema,
  ListOperationsShipmentsQuerySchema,
  ListSecuredDueQuerySchema,
  ListVaultInventoryQuerySchema,
  MAX_PAGE_SIZE,
  OperationsCrewAttendanceQuerySchema,
  OperationsCrewBoardQuerySchema,
  OperationsCrewDirectoryQuerySchema,
  OperationsDayBoardQuerySchema,
  OperationsDeletedShipmentsQuerySchema,
  OperationsReportQuerySchema,
  OperationsSecuredBoardQuerySchema,
  OperationsSecuredDispatchBoardQuerySchema,
  OperationsShipmentHistoryQuerySchema,
  OperationsVaultQueueQuerySchema,
  OrderOperationsCurrenciesSchema,
} from '@ecms/contracts';
import { buildQuery, type QueryParams } from '../../../shared/lib/api-client';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every source file in the Operations web module — the two guards below read call sites. */
const moduleSources = (): { name: string; text: string }[] => {
  const out: { name: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !entry.includes('.spec.'))
        out.push({ name: full.slice(MODULE_ROOT.length + 1), text: readFileSync(full, 'utf8') });
    }
  };
  walk(MODULE_ROOT);
  return out;
};

/** The query string a request carries, decoded the way Express decodes `req.query`. */
const asServerQuery = (params: QueryParams): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(buildQuery(params).replace(/^\?/, '')));

/** Every list request an Operations screen issues, paired with the schema that receives it. */
const REQUESTS = [
  {
    screen: 'Catalogs · banks tab + every screen\'s bank picker',
    schema: ListOperationsReferenceQuerySchema,
    params: { page: 1, pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' },
  },
  {
    screen: 'Catalogs · areas tab',
    schema: ListOperationsReferenceQuerySchema,
    params: { page: 1, pageSize: MAX_PAGE_SIZE, sortBy: 'name', sortDir: 'asc' },
  },
  {
    screen: 'Daily operations · branch names',
    schema: ListOperationsBankBranchesQuerySchema,
    params: { page: 1, pageSize: MAX_PAGE_SIZE },
  },
  {
    screen: 'Shipment form · cascading branch picker',
    schema: ListOperationsBankBranchesQuerySchema,
    params: { bankId: '68c0f4a2b1d3e4f5a6b7c8d9', pageSize: MAX_PAGE_SIZE, sortBy: 'name', sortDir: 'asc' },
  },
  {
    screen: 'Daily operations · currency names',
    schema: ListOperationsReferenceQuerySchema,
    params: { page: 1, pageSize: MAX_PAGE_SIZE },
  },
  {
    screen: 'Shipments list',
    schema: ListOperationsShipmentsQuerySchema,
    params: { page: 1, pageSize: 25, sortDir: 'desc' },
  },
  { screen: 'Daily operations · the board', schema: OperationsDayBoardQuerySchema, params: { date: '2026-08-18' } },
  {
    screen: 'Shipments history · the default range (this month to date)',
    schema: OperationsShipmentHistoryQuerySchema,
    params: { from: '2026-08-01', to: '2026-08-18' },
  },
  {
    screen: 'Shipments history · the deleted shipments of the same range',
    schema: OperationsDeletedShipmentsQuerySchema,
    params: { from: '2026-08-01', to: '2026-08-18' },
  },
  // Round 8: the secured screen is the day board's board over every open محصنة — no parameters.
  { screen: 'Secured screen · the board', schema: OperationsSecuredBoardQuerySchema, params: {} },
  // Round 8: the vault's receive queue is board rows — with the captain and received today, and
  // «الكل» adding the ones no captain has collected (`getVaultQueue` sends `all` only when on).
  { screen: 'Vault receive · the queue', schema: OperationsVaultQueueQuerySchema, params: {} },
  {
    screen: 'Vault receive · «الكل»',
    schema: OperationsVaultQueueQuerySchema,
    params: { all: true },
  },
  { screen: 'Vault dispatch · due list', schema: ListSecuredDueQuerySchema, params: { date: '2026-08-18' } },
  // Round 10: «صرف الخزينة» — every محصنة in the vault (no key at all), or one delivery day.
  {
    screen: 'Vault dispatch · every shipment in the vault',
    schema: OperationsSecuredDispatchBoardQuerySchema,
    params: {},
  },
  {
    screen: 'Vault dispatch · one delivery day',
    schema: OperationsSecuredDispatchBoardQuerySchema,
    params: { date: '2026-08-18' },
  },
  { screen: 'Vault inventory', schema: ListVaultInventoryQuerySchema, params: { page: 1, pageSize: 25 } },
  { screen: 'Crew board', schema: OperationsCrewBoardQuerySchema, params: { date: '2026-08-18' } },
  { screen: 'Crew board · pool', schema: OperationsCrewDirectoryQuerySchema, params: { date: '2026-08-18' } },
  { screen: 'Crew board · pool, no date', schema: OperationsCrewDirectoryQuerySchema, params: {} },
  {
    screen: 'Requirements roster',
    schema: ListOperationsCrewRequirementsQuerySchema,
    params: { page: 1, pageSize: 25, sortDir: 'desc' },
  },
  { screen: 'Crew attendance', schema: OperationsCrewAttendanceQuerySchema, params: { date: '2026-08-18' } },
  {
    screen: 'Captain report',
    schema: OperationsReportQuerySchema,
    params: { from: '2026-08-01', to: '2026-08-31' },
  },
  {
    screen: 'Bank report',
    schema: OperationsReportQuerySchema,
    params: { from: '2026-08-01', to: '2026-08-31' },
  },
  // Round 11 — «يجيب اللى اتسلم واللى متسلمش ويجيب البداية كل اول شهر»: the vault roll-up takes the
  // same period as the two reports (it refused any query before the owner's answer).
  {
    screen: 'Vault roll-up · the current month',
    schema: OperationsReportQuerySchema,
    params: { from: '2026-08-01', to: '2026-08-31' },
  },
] as const;

describe('every Operations request parses against the schema that receives it (B8)', () => {
  for (const { screen, schema, params } of REQUESTS) {
    it(`${screen}: ${buildQuery(params as QueryParams) || '(no query)'}`, () => {
      const result = schema.safeParse(asServerQuery(params as QueryParams));
      // The message names the field, so a failure reads like the 400 the browser would get.
      const why = result.success
        ? ''
        : result.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
      expect(result.success, why).toBe(true);
    });
  }
});

// Round 10 — the bodies the secured screen and the vault's screens send, against the schemas that
// receive them: the pickup ✓ and its undo carry the version the row was read at; a cancelled receipt
// its reason, trimmed, within the server's bounds (the dialog sends `reason.trim()`).
describe('the Round 10 acts’ bodies', () => {
  it('sends the pickup ✓ and its undo the row’s version, and nothing else', () => {
    expect(ConfirmSecuredPickupSchema.safeParse({ version: 4 }).success).toBe(true);
    expect(ConfirmSecuredPickupSchema.safeParse({ version: 4, by: 'operations' }).success).toBe(
      false,
    );
  });

  it('sends a cancelled receipt its reason and the row’s version', () => {
    expect(
      CancelVaultReceiptSchema.safeParse({ reason: 'أُدخلت بالخطأ', version: 5 }).success,
    ).toBe(true);
    expect(CancelVaultReceiptSchema.safeParse({ reason: '', version: 5 }).success).toBe(false);
  });

  it('never asks «صرف الخزينة» for an empty day — the key is left out instead', () => {
    // The server refuses `date=` (400): an empty day is not a day.
    expect(OperationsSecuredDispatchBoardQuerySchema.safeParse({ date: '' }).success).toBe(false);
    // So an empty value never reaches it: `buildQuery` drops it, and «every day» is no key at all.
    expect(buildQuery({ date: '' })).toBe('');
    expect(
      OperationsSecuredDispatchBoardQuerySchema.safeParse(asServerQuery({ date: '' })).success,
    ).toBe(true);
  });
});

describe('the currencies’ dragged order (Round 8)', () => {
  it('sends a body the order endpoint takes — the ids in their new order', () => {
    const ids = ['68c0f4a2b1d3e4f5a6b7c8d9', '68c0f4a2b1d3e4f5a6b7c8da'];
    expect(OrderOperationsCurrenciesSchema.safeParse({ ids }).success).toBe(true);
  });
});

describe('the ceiling that caused it (B8)', () => {
  it('rejects the page sizes the screens used to ask for', () => {
    // 200 and 500 were the literal values in DailyOperations, Catalogs, SecuredBacklog,
    // VaultReceive, SecuredDispatch and the shipment form's branch picker. Every one 400'd.
    for (const pageSize of [200, 500]) {
      const result = ListOperationsReferenceQuerySchema.safeParse(
        asServerQuery({ page: 1, pageSize }),
      );
      expect(result.success, `pageSize ${String(pageSize)} must be refused`).toBe(false);
    }
  });

  it('accepts the ceiling itself, so MAX_PAGE_SIZE is the largest legal ask', () => {
    expect(ListOperationsReferenceQuerySchema.safeParse(asServerQuery({ pageSize: MAX_PAGE_SIZE })).success).toBe(true);
    expect(ListOperationsReferenceQuerySchema.safeParse(asServerQuery({ pageSize: MAX_PAGE_SIZE + 1 })).success).toBe(false);
  });

  it('leaves no Operations screen asking for more than the ceiling', () => {
    // THE REGRESSION GUARD for root cause A. The numbers live in call sites and no type can say
    // "at most MAX_PAGE_SIZE", so the module is read as source: any numeric `pageSize:` literal
    // above the ceiling fails here, which is what six screens carried before B8.
    const offenders: string[] = [];
    for (const file of moduleSources()) {
      for (const [, size] of file.text.matchAll(/pageSize:\s*(\d+)/g)) {
        if (Number(size) > MAX_PAGE_SIZE) offenders.push(`${file.name}: pageSize ${size}`);
      }
    }
    expect(offenders, 'screens asking for more rows than the API will serve').toEqual([]);
  });

  it('routes every paginated Operations call through getPage, never get', () => {
    // THE REGRESSION GUARD for root cause B. `get<T>` returns `body.data` unwrapped, so
    // `get<Paginated<T>>` type-checks and then hands back a bare array: `.items` and `.meta` are
    // undefined, the table renders empty and the pager crashes destructuring `meta`. That is the
    // exact "/operations/vault → Cannot destructure property 'page'" failure.
    const api = moduleSources().find((f) => f.name.endsWith('operations-api.ts'));
    expect(api, 'the Operations API client').toBeDefined();
    expect(api?.text).not.toMatch(/\bget<\s*Paginated</);
    // ...and the two endpoints that had it are on getPage now.
    expect(api?.text).toContain('getPage<OperationsVaultInventoryRowDto>');
    expect(api?.text).toContain('getPage<OperationsAreaDto>');
  });
});
