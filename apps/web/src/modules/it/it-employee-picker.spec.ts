// Who the IT employee box finds — «لما يعمل بحث او يضيف حاجه او اى حاجه يختار اسم الموظف يظهرله
// اسم الموظف من الاتش ار كل المواظفين سواء اللى مشى او اللى موجود لكن فى حاله الاضافه اللى موجود
// بس».
//
// «... ونفس الموضوع فى الفلاتر فى كل الشاشات لكن فى حاله اضافه اى حاجه لازم يكون المواظفيين يكونوا
// موجودين. الفنى يكون من مموظفيين الit بس».
//
// Two populations, two boxes (people and technicians):
//   • a SEARCH — every filter that picks a person, on every IT screen — finds everyone HR has,
//     leavers included;
//   • a HAND-OVER — assign, transfer, a ticket's technician — finds the people who work here
//     today, and nobody else.
//
// The first half is proven against the request that actually leaves the browser. The second half
// is source-level, because that is the shape of the rule: a hand-over box that quietly starts
// offering leavers renders perfectly well, and nothing but the owner noticing would catch it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ItApiModule from './api/it-api';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped: a rule about the code must not be satisfied — or broken — by prose. */
const code = (rel: string): string =>
  readFileSync(join(HERE, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

describe('the employee search — IT’s own endpoint, never HR’s', () => {
  let api: typeof ItApiModule;
  const asked: URL[] = [];

  beforeEach(async () => {
    asked.length = 0;
    vi.resetModules();
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      asked.push(new URL(String(input)));
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    api = await import('./api/it-api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the employed only by default — a hand-over never offers a leaver', async () => {
    await api.searchPeople('مصطفى');

    expect(asked).toHaveLength(1);
    // IT's endpoint under IT's grant: HR's `/hr/employees` would demand `employee.view`, the whole
    // HR file, of a technician who only needs a name.
    expect(asked[0]?.pathname).toMatch(/\/it\/people$/u);
    expect(asked[0]?.searchParams.get('search')).toBe('مصطفى');
    expect(asked[0]?.searchParams.get('status')).toBe('employed');
  });

  it('asks for everybody for a search, leavers included', async () => {
    await api.searchPeople('مصطفى', { includeExited: true });

    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('search')).toBe('مصطفى');
    expect(asked[0]?.searchParams.get('status')).toBe('all');
  });

  // 2026-11-18 — «أسمح إنه يعرف يسلم لحد فى فرع تاني»: a hand-over's box asks its own route, in every
  // branch. The server forces the employed, so the box sends no status at all — only what is typed
  // and the box's few rows.
  it('asks the recipients route for a hand-over — what was typed and a page of eight', async () => {
    await api.searchRecipients('وليد');

    expect(asked).toHaveLength(1);
    expect(asked[0]?.pathname).toMatch(/\/it\/people\/recipients$/u);
    expect(asked[0]?.searchParams.get('search')).toBe('وليد');
    expect(asked[0]?.searchParams.get('pageSize')).toBe('8');
    expect([...(asked[0]?.searchParams.keys() ?? [])].sort()).toEqual(['pageSize', 'search']);
  });

  it('asks the technicians list for who works here today, unless a filter asks for everyone', async () => {
    await api.searchTechnicians('أحمد');
    await api.searchTechnicians('أحمد', { includeExited: true });

    expect(asked.map((url) => url.pathname.endsWith('/it/technicians'))).toEqual([true, true]);
    expect(asked.map((url) => url.searchParams.get('status'))).toEqual(['employed', 'all']);
  });
});

/** Every `<EmployeePicker …/>` and `<TechnicianPicker …/>` element in a file, props included. */
const pickers = (source: string): string[] =>
  [...source.matchAll(/<(?:EmployeePicker|TechnicianPicker)\b[\s\S]*?\/>/gu)].map((m) => m[0]);

/** Every IT source file, relative to the module. */
const sources = (dir = HERE): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/u.test(entry.name) && !entry.name.includes('.spec.')
      ? [relative(HERE, full)]
      : [];
  });

/**
 * The only places a person is HANDED something: custody hand-overs, a mobile line's hand-over
 * (FR-19), a ticket's technician, and the consumables' issue (FR-20). The consumables' return
 * names who brought an item back in the same file: recording it is ADDING a record — «لكن فى
 * حاله الاضافه اللى موجود بس» — so it asks for the same population. A department's custody
 * (2026-11-19) is signed by its responsible person, chosen in the department's fields the asset
 * hand-over, the transfer and the consumables' issue share — a hand-over's box too.
 */
const HAND_OVERS = [
  'components/ConsumableDialogs.tsx',
  'components/CustodyDialogs.tsx',
  'components/DepartmentCustodianFields.tsx',
  'components/MobileLineDialogs.tsx',
  'components/TicketDialogs.tsx',
];

describe('which box asks for which population', () => {
  const using = sources().filter((rel) => pickers(code(rel)).length > 0);

  it('a person box lives on a screen (a filter) or in a hand-over dialog — nowhere else', () => {
    // A third kind of place would be a decision nobody has made yet about who it should find.
    expect(using.filter((rel) => !rel.startsWith('pages/') && !HAND_OVERS.includes(rel))).toEqual(
      [],
    );
  });

  it('every filter, on every screen, finds leavers too', () => {
    const filters = using.filter((rel) => rel.startsWith('pages/'));
    // The custody register, the asset register, the mobile lines, the consumables' ledger and the
    // help desk — the screens that narrow a list by a person.
    expect(filters.sort()).toEqual(
      [
        'pages/AssetsListPage.tsx',
        'pages/ConsumableMovementsPage.tsx',
        'pages/CustodyPage.tsx',
        'pages/MobileLinesPage.tsx',
        'pages/TicketsListPage.tsx',
      ].sort(),
    );
    for (const rel of filters) {
      for (const element of pickers(code(rel))) {
        expect(element, rel).toMatch(/\bincludeExited\b/u);
        // A filter narrows a register the reader's scope already bounds: it keeps `/it/people`,
        // never the hand-over's every-branch search.
        expect(element, rel).not.toMatch(/\bhandOver\b/u);
      }
    }
  });

  it('every hand-over finds who works here today, and nobody else', () => {
    for (const rel of HAND_OVERS) {
      const elements = pickers(code(rel));
      expect(elements.length, rel).toBeGreaterThan(0);
      for (const element of elements) expect(element, rel).not.toMatch(/\bincludeExited\b/u);
    }
    // Assign and transfer choose a holder; the ticket dialog chooses a TECHNICIAN — IT's people.
    expect(pickers(code('components/CustodyDialogs.tsx'))).toHaveLength(2);
    // The consumables' issue chooses who receives; their return, who brought an item back.
    expect(pickers(code('components/ConsumableDialogs.tsx'))).toHaveLength(2);
    expect(pickers(code('components/TicketDialogs.tsx')).join('')).toContain('<TechnicianPicker');
  });

  // 2026-11-18 — «لما حد فى فرع بيسلم جهاز لحد فى فرع تاني مش بيعرف يشوف اسمه سواء فى الأصول أو
  // المستهلكات .. أسمح إنه يعرف يسلم لحد فى فرع تاني»: every box a person is HANDED something in
  // searches every branch — the asset's hand-over and transfer, the line's hand-over, the
  // consumables' issue and return — and no other box does.
  it('every hand-over’s person box searches every branch — the six of them, by name', () => {
    const employeeBoxes = (rel: string): string[] =>
      pickers(code(rel)).filter((element) => element.startsWith('<EmployeePicker'));
    const handOvers = HAND_OVERS.flatMap((rel) =>
      employeeBoxes(rel).map((element) => [rel, element] as const),
    );
    for (const [rel, element] of handOvers) expect(element, rel).toMatch(/\bhandOver\b/u);
    // Named by the field each one fills, so a box added or lost is a decision, not a drift.
    const fields = handOvers.map(([rel, element]) => [
      rel,
      /ariaLabel=\{t\('([^']+)'\)\}/u.exec(element)?.[1],
    ]);
    expect(fields).toEqual([
      ['components/ConsumableDialogs.tsx', 'it.consumables.returnFrom'],
      ['components/ConsumableDialogs.tsx', 'it.consumables.issue.employee'],
      ['components/CustodyDialogs.tsx', 'it.custody.holder'],
      ['components/CustodyDialogs.tsx', 'it.custody.newHolder'],
      ['components/DepartmentCustodianFields.tsx', 'it.custody.department.responsibleReceiver'],
      ['components/MobileLineDialogs.tsx', 'it.custody.holder'],
    ]);
    // Nowhere else: the employees register, a person's page and every filter keep `/it/people`.
    const elsewhere = sources()
      .filter((rel) => !HAND_OVERS.includes(rel))
      .flatMap((rel) => pickers(code(rel)).map((element) => [rel, element] as const));
    expect(elsewhere.length).toBeGreaterThanOrEqual(5);
    for (const [rel, element] of elsewhere) expect(element, rel).not.toMatch(/\bhandOver\b/u);
  });

  it('a box that does not choose gets the hand-over population', () => {
    for (const rel of ['components/EmployeePicker.tsx', 'components/TechnicianPicker.tsx']) {
      expect(code(rel), rel).toContain('includeExited = false');
    }
    // …and, unless it says it IS a hand-over, the reader's own scope: the every-branch search is
    // opted into, never fallen into.
    expect(code('components/EmployeePicker.tsx')).toContain('handOver = false');
  });

  it('keeps the answers apart in the cache', () => {
    // Typed with the same letters, the boxes must not share one cached answer — or a hand-over
    // box would be served the search's leavers for the next thirty seconds, or a filter the
    // hand-over's every-branch rows.
    const picker = code('components/EmployeePicker.tsx');
    expect(picker).toContain("listKey('it', 'employeeSearch', { search, includeExited })");
    expect(picker).toContain('api.searchPeople(search, { includeExited })');
    expect(picker).toContain("listKey('it', 'recipientSearch', { search })");
    expect(picker).toContain('api.searchRecipients(search)');
  });

  it('marks a leaver in the results, so a search tells them apart', () => {
    const picker = code('components/EmployeePicker.tsx');
    expect(picker).toContain("employee.status === 'exited'");
    expect(picker).toContain("t('it.custody.pickerExited')");
  });

  // Any of the three registers that hand things to people opens the box — the assets, the lines and
  // the consumables, each on its own read grant since 2026-11-17 — as `/it/people` itself answers.
  it('needs IT’s grant — any register’s that hands things to people — not HR’s', () => {
    const picker = code('components/EmployeePicker.tsx');
    expect(picker).toContain(
      "IT_PEOPLE_GRANTS = ['itAsset.view', 'itMobileLine.view', 'itConsumable.view']",
    );
    // A hand-over's box opens on the ACT's grant instead — any register's «تسليم» (the owner's
    // «صاحب صلاحية التسليم»), as `/it/people/recipients` answers.
    expect(picker.replace(/\s+/gu, ' ')).toContain(
      "IT_RECIPIENT_GRANTS = [ 'itAsset.assign', 'itMobileLine.assign', 'itConsumable.assign', ]",
    );
    expect(picker).toContain('handOver ? IT_RECIPIENT_GRANTS : IT_PEOPLE_GRANTS');
    expect(picker).toContain(
      'const allowed = employeePickerGrants(handOver).some((grant) => can(grant));',
    );
    expect(picker).not.toContain('employee.view');
    const client = code('api/it-api.ts');
    expect(client).not.toContain('/hr/employees');
  });
});
