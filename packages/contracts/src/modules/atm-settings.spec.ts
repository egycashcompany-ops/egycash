// The /atm/settings contracts, pinned. The mailbox card's save: the secret is write-only (blank
// keeps the stored one) and no refusal can quote it; the tenant id cannot reshape the token URL;
// each branch is switched on once. The branch links: the owner's October → Mohandessin, and the
// three refusals — a branch acting as itself, as two branches, or through a chain — each reported
// at the row and field the screen shows it on. The move of a linked source's data: the source in
// the path and nothing else, every collection counted once, and one shape per refusal.
//
// Every value below is synthetic.
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../platform/audit.js';
import { AtmSettingKeys } from './atm.js';
import {
  ATM_BRANCH_LINK_ISSUES,
  ATM_BRANCH_LINKS_MAX,
  ATM_BRANCH_MOVE_BLOCKERS,
  ATM_BRANCH_MOVE_COLLECTIONS,
  ATM_BRANCH_MOVE_MERGES,
  ATM_BRANCH_MOVE_RUN_STATES,
  ATM_MAILBOX_BRANCHES_MAX,
  ATM_MAIL_POLL_REASONS_MAX,
  AtmBranchLinksSettingSchema,
  AtmBranchMoveCollectionSchema,
  AtmBranchMoveParamsSchema,
  SaveAtmBranchLinksSchema,
  SaveAtmMailboxConfigSchema,
  atmBranchLinkIssues,
  atmBranchMoveTotal,
  emptyAtmBranchMoveCounts,
  emptyAtmBranchMoveMerges,
  type AtmBranchMoveBlockerDto,
} from './atm-settings.js';

const MOHANDESSIN = '6500000000000000000000ab';
const OCTOBER = '6500000000000000000000cd';
const TANTA = '6500000000000000000000ef';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const CLIENT = '00000000-0000-4000-8000-00000000000b';
const SECRET = 'synthetic-client-secret-value';

/** A full first-save body, with `overrides` applied. */
const mailbox = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  tenantId: TENANT,
  clientId: CLIENT,
  userEmail: 'atm-maintenance@example.com',
  enabled: false,
  branches: [],
  version: null,
  ...overrides,
});

const without = (key: string): Record<string, unknown> => {
  const body = mailbox();
  delete body[key];
  return body;
};

/** Distinct synthetic ids, `n` of them. */
const ids = (n: number, prefix = '7'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i.toString(16).padStart(23, '0')}`);

describe('SaveAtmMailboxConfigSchema', () => {
  it('takes the first save (version null) and a later one (the document’s version)', () => {
    expect(SaveAtmMailboxConfigSchema.parse(mailbox())).toEqual(mailbox());
    expect(SaveAtmMailboxConfigSchema.parse(mailbox({ version: 3 })).version).toBe(3);
    expect(SaveAtmMailboxConfigSchema.safeParse(mailbox({ version: -1 })).success).toBe(false);
  });

  it('needs every field but the secret', () => {
    for (const key of ['tenantId', 'clientId', 'userEmail', 'enabled', 'branches', 'version']) {
      expect(SaveAtmMailboxConfigSchema.safeParse(without(key)).success, key).toBe(false);
    }
    expect(SaveAtmMailboxConfigSchema.safeParse(without('clientSecret')).success).toBe(true);
  });

  it('keeps the stored secret when the box is left empty, replaces it when one is typed', () => {
    expect(SaveAtmMailboxConfigSchema.parse(mailbox())).not.toHaveProperty('clientSecret');
    for (const blank of ['', '   ', '\n']) {
      expect(SaveAtmMailboxConfigSchema.parse(mailbox({ clientSecret: blank })).clientSecret).toBe(
        undefined,
      );
    }
    expect(
      SaveAtmMailboxConfigSchema.parse(mailbox({ clientSecret: ` ${SECRET}\n` })).clientSecret,
    ).toBe(SECRET);
  });

  it('never quotes the secret in a refusal', () => {
    const tooLong = SaveAtmMailboxConfigSchema.safeParse(
      mailbox({ clientSecret: `${SECRET}${'x'.repeat(600)}` }),
    );
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues.map((issue) => issue.path)).toEqual([['clientSecret']]);
      expect(JSON.stringify(tooLong.error.issues)).not.toContain(SECRET);
    }
    const notText = SaveAtmMailboxConfigSchema.safeParse(mailbox({ clientSecret: { SECRET } }));
    expect(notText.success).toBe(false);
    if (!notText.success) expect(JSON.stringify(notText.error.issues)).not.toContain(SECRET);
  });

  it('takes a tenant as a GUID or a verified domain, nothing that could reshape the URL', () => {
    expect(
      SaveAtmMailboxConfigSchema.parse(mailbox({ tenantId: ' egycash.onmicrosoft.com ' })).tenantId,
    ).toBe('egycash.onmicrosoft.com');
    for (const tenantId of ['', ' ', 'a/b', '..', 'x?y', 'x#y', 'x%2Fy', 'two words', '-x']) {
      expect(SaveAtmMailboxConfigSchema.safeParse(mailbox({ tenantId })).success, tenantId).toBe(
        false,
      );
    }
  });

  it('takes the application id as a GUID, nothing else', () => {
    expect(
      SaveAtmMailboxConfigSchema.parse(mailbox({ clientId: ` ${CLIENT.toUpperCase()} ` })).clientId,
    ).toBe(CLIENT.toUpperCase());
    for (const clientId of ['', 'atm-reader', `${CLIENT}0`, CLIENT.replace(/-/g, '')]) {
      expect(SaveAtmMailboxConfigSchema.safeParse(mailbox({ clientId })).success, clientId).toBe(
        false,
      );
    }
  });

  it('reads one mailbox address', () => {
    expect(
      SaveAtmMailboxConfigSchema.parse(mailbox({ userEmail: ' atm@example.com ' })).userEmail,
    ).toBe('atm@example.com');
    for (const userEmail of ['', 'atm', 'atm@example', 'two words@example.com']) {
      expect(SaveAtmMailboxConfigSchema.safeParse(mailbox({ userEmail })).success, userEmail).toBe(
        false,
      );
    }
  });

  it('switches each branch on with its category trimmed, a blank one left to the fallback', () => {
    const parsed = SaveAtmMailboxConfigSchema.parse(
      mailbox({
        enabled: true,
        branches: [
          { branchId: MOHANDESSIN.toUpperCase(), category: ' Green Category ' },
          { branchId: TANTA, category: '  ' },
          { branchId: OCTOBER, category: null },
        ],
      }),
    );
    expect(parsed.branches).toEqual([
      { branchId: MOHANDESSIN, category: 'Green Category' },
      { branchId: TANTA, category: null },
      { branchId: OCTOBER, category: null },
    ]);
  });

  it('switches a branch on once — whatever the case of its id', () => {
    const parsed = SaveAtmMailboxConfigSchema.safeParse(
      mailbox({
        branches: [
          { branchId: MOHANDESSIN, category: null },
          { branchId: MOHANDESSIN.toUpperCase(), category: 'Blue Category' },
        ],
      }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toMatchObject([
        { path: ['branches', 1, 'branchId'], message: 'duplicateBranch' },
      ]);
    }
  });

  it('refuses a bad branch row, and more branches than the ceiling', () => {
    for (const row of [
      { branchId: 'nope', category: null },
      { branchId: MOHANDESSIN, category: 'x'.repeat(65) },
      { branchId: MOHANDESSIN },
      { branchId: MOHANDESSIN, category: null, branchName: null },
    ]) {
      expect(
        SaveAtmMailboxConfigSchema.safeParse(mailbox({ branches: [row] })).success,
        JSON.stringify(row),
      ).toBe(false);
    }
    const rows = ids(ATM_MAILBOX_BRANCHES_MAX + 1).map((branchId) => ({
      branchId,
      category: null,
    }));
    expect(SaveAtmMailboxConfigSchema.safeParse(mailbox({ branches: rows })).success).toBe(false);
    expect(SaveAtmMailboxConfigSchema.safeParse(mailbox({ branches: rows.slice(1) })).success).toBe(
      true,
    );
  });

  it('is strict: what the server keeps is not input', () => {
    for (const extra of [{ clientSecretRef: {} }, { hasSecret: true }, { lastPoll: null }]) {
      expect(
        SaveAtmMailboxConfigSchema.safeParse(mailbox(extra)).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe('AtmBranchLinksSettingSchema (atm.branchLinks)', () => {
  it('is declared under its own key', () => {
    expect(AtmSettingKeys.BranchLinks).toBe('atm.branchLinks');
  });

  it('defaults to nothing linked, and takes October → Mohandessin', () => {
    expect(AtmBranchLinksSettingSchema.parse([])).toEqual([]);
    expect(
      AtmBranchLinksSettingSchema.parse([{ branchId: OCTOBER, actsAsBranchId: MOHANDESSIN }]),
    ).toEqual([{ branchId: OCTOBER, actsAsBranchId: MOHANDESSIN }]);
  });

  it('lets two branches act as the same one', () => {
    const links = [
      { branchId: OCTOBER, actsAsBranchId: MOHANDESSIN },
      { branchId: TANTA, actsAsBranchId: MOHANDESSIN },
    ];
    expect(AtmBranchLinksSettingSchema.parse(links)).toEqual(links);
  });

  it('lower-cases the ids, so a capitalised one still matches the server’s', () => {
    expect(
      AtmBranchLinksSettingSchema.parse([
        { branchId: OCTOBER.toUpperCase(), actsAsBranchId: MOHANDESSIN.toUpperCase() },
      ]),
    ).toEqual([{ branchId: OCTOBER, actsAsBranchId: MOHANDESSIN }]);
  });

  const refusal = (links: unknown[]) => {
    const parsed = AtmBranchLinksSettingSchema.safeParse(links);
    expect(parsed.success).toBe(false);
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
  };

  it('refuses a branch acting as itself', () => {
    expect(refusal([{ branchId: OCTOBER, actsAsBranchId: OCTOBER.toUpperCase() }])).toEqual([
      { path: [0, 'actsAsBranchId'], message: 'sameBranch' },
    ]);
  });

  it('refuses a branch acting as two branches', () => {
    expect(
      refusal([
        { branchId: OCTOBER, actsAsBranchId: MOHANDESSIN },
        { branchId: OCTOBER.toUpperCase(), actsAsBranchId: TANTA },
      ]),
    ).toEqual([{ path: [1, 'branchId'], message: 'duplicateSource' }]);
  });

  it('refuses a chain and a cycle — a target is never itself a source', () => {
    expect(
      refusal([
        { branchId: OCTOBER, actsAsBranchId: MOHANDESSIN },
        { branchId: MOHANDESSIN, actsAsBranchId: TANTA },
      ]),
    ).toEqual([{ path: [0, 'actsAsBranchId'], message: 'chain' }]);
    expect(
      refusal([
        { branchId: OCTOBER, actsAsBranchId: MOHANDESSIN },
        { branchId: MOHANDESSIN, actsAsBranchId: OCTOBER },
      ]),
    ).toEqual([
      { path: [0, 'actsAsBranchId'], message: 'chain' },
      { path: [1, 'actsAsBranchId'], message: 'chain' },
    ]);
  });

  it('is strict per row, and capped', () => {
    for (const row of [
      { branchId: OCTOBER },
      { branchId: OCTOBER, actsAsBranchId: 'nope' },
      { branchId: OCTOBER, actsAsBranchId: MOHANDESSIN, branchName: null },
    ]) {
      expect(AtmBranchLinksSettingSchema.safeParse([row]).success, JSON.stringify(row)).toBe(false);
    }
    const links = ids(ATM_BRANCH_LINKS_MAX + 1).map((branchId) => ({
      branchId,
      actsAsBranchId: MOHANDESSIN,
    }));
    expect(AtmBranchLinksSettingSchema.safeParse(links).success).toBe(false);
    expect(AtmBranchLinksSettingSchema.safeParse(links.slice(1)).success).toBe(true);
  });
});

describe('SaveAtmBranchLinksSchema', () => {
  it('takes the whole list under `links`, each refusal at its row', () => {
    expect(SaveAtmBranchLinksSchema.parse({ links: [] })).toEqual({ links: [] });
    expect(SaveAtmBranchLinksSchema.safeParse([]).success).toBe(false);
    expect(SaveAtmBranchLinksSchema.safeParse({ links: [], version: 1 }).success).toBe(false);
    const parsed = SaveAtmBranchLinksSchema.safeParse({
      links: [
        { branchId: OCTOBER, actsAsBranchId: MOHANDESSIN },
        { branchId: MOHANDESSIN, actsAsBranchId: TANTA },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toMatchObject([
        { path: ['links', 0, 'actsAsBranchId'], message: 'chain' },
      ]);
    }
  });
});

describe('atmBranchLinkIssues — what the add row checks before it sends', () => {
  const linked = [{ branchId: OCTOBER, actsAsBranchId: MOHANDESSIN }];

  it('finds nothing wrong with a valid list', () => {
    expect(atmBranchLinkIssues([])).toEqual([]);
    expect(
      atmBranchLinkIssues([...linked, { branchId: TANTA, actsAsBranchId: MOHANDESSIN }]),
    ).toEqual([]);
  });

  it('names the candidate’s problem at its row and field', () => {
    expect(atmBranchLinkIssues([...linked, { branchId: TANTA, actsAsBranchId: TANTA }])).toEqual([
      { index: 1, field: 'actsAsBranchId', issue: 'sameBranch' },
    ]);
    expect(atmBranchLinkIssues([...linked, { branchId: OCTOBER, actsAsBranchId: TANTA }])).toEqual([
      { index: 1, field: 'branchId', issue: 'duplicateSource' },
    ]);
    expect(
      atmBranchLinkIssues([...linked, { branchId: TANTA, actsAsBranchId: OCTOBER.toUpperCase() }]),
    ).toEqual([{ index: 1, field: 'actsAsBranchId', issue: 'chain' }]);
    // A candidate whose SOURCE is an existing target makes the existing row the chain.
    expect(
      atmBranchLinkIssues([...linked, { branchId: MOHANDESSIN, actsAsBranchId: TANTA }]),
    ).toEqual([{ index: 0, field: 'actsAsBranchId', issue: 'chain' }]);
  });
});

describe('the vocabularies the next layers switch on', () => {
  it('names the link refusals and the poll record’s reasons ceiling', () => {
    expect(ATM_BRANCH_LINK_ISSUES).toEqual(['sameBranch', 'duplicateSource', 'chain']);
    expect(ATM_MAIL_POLL_REASONS_MAX).toBe(5);
  });
});

describe('the move of a linked source’s data — «نقل البيانات»', () => {
  it('takes the source from the path, lower-cased as a stored link is, and nothing else', () => {
    expect(AtmBranchMoveParamsSchema.parse({ sourceBranchId: OCTOBER.toUpperCase() })).toEqual({
      sourceBranchId: OCTOBER,
    });
    expect(AtmBranchMoveParamsSchema.safeParse({ sourceBranchId: 'october' }).success).toBe(false);
    expect(AtmBranchMoveParamsSchema.safeParse({}).success).toBe(false);
    // The target is the STORED link's: a request that names one is refused, not obeyed.
    expect(
      AtmBranchMoveParamsSchema.safeParse({ sourceBranchId: OCTOBER, actsAsBranchId: TANTA })
        .success,
    ).toBe(false);
  });

  it('counts every collection it re-files, once each, and none it leaves behind', () => {
    expect(ATM_BRANCH_MOVE_COLLECTIONS).toHaveLength(17);
    expect(new Set(ATM_BRANCH_MOVE_COLLECTIONS).size).toBe(17);
    for (const key of ATM_BRANCH_MOVE_COLLECTIONS) {
      expect(AtmBranchMoveCollectionSchema.parse(key)).toBe(key);
    }
    // The source's zone set stays (the target's revision moves on); the note counters stay too.
    for (const key of ['mapZoneSets', 'noteCounters', 'banks', 'registerImportRuns']) {
      expect(AtmBranchMoveCollectionSchema.safeParse(key).success, key).toBe(false);
    }
  });

  it('starts every count and every merge at zero, with every key present', () => {
    const counts = emptyAtmBranchMoveCounts();
    expect(Object.keys(counts)).toEqual([...ATM_BRANCH_MOVE_COLLECTIONS]);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    const merges = emptyAtmBranchMoveMerges();
    expect(Object.keys(merges)).toEqual([...ATM_BRANCH_MOVE_MERGES]);
    expect(Object.values(merges).every((n) => n === 0)).toBe(true);
    // A fresh object each call: one run's tally never leaks into the next one's.
    counts.machines = 3;
    expect(emptyAtmBranchMoveCounts().machines).toBe(0);
  });

  it('totals the rows over every collection', () => {
    expect(atmBranchMoveTotal(emptyAtmBranchMoveCounts())).toBe(0);
    expect(
      atmBranchMoveTotal({
        ...emptyAtmBranchMoveCounts(),
        machines: 475,
        registerEntries: 1061,
        mailTickets: 12,
        layoutImportRuns: 1,
      }),
    ).toBe(1549);
  });

  it('gives every refusal one shape — the vocabulary and the union name the same kinds', () => {
    const examples: Record<AtmBranchMoveBlockerDto['kind'], AtmBranchMoveBlockerDto> = {
      machineActiveInBoth: { kind: 'machineActiveInBoth', codes: ['99990001'] },
      machineTwinOpen: { kind: 'machineTwinOpen', codes: ['99990002'] },
      planSerialCollision: { kind: 'planSerialCollision', bankCodes: ['BRK'] },
      planSameDay: {
        kind: 'planSameDay',
        items: [{ bankCode: 'BRK', replenishDate: '2026-10-28' }],
      },
      zoneCaps: { kind: 'zoneCaps', zones: 201, points: 18_000 },
      layoutImportRunning: { kind: 'layoutImportRunning', bankCodes: ['BRK'] },
      registerImportRunning: { kind: 'registerImportRunning' },
      moveRunning: { kind: 'moveRunning' },
    };
    expect(Object.keys(examples).sort()).toEqual([...ATM_BRANCH_MOVE_BLOCKERS].sort());
    for (const [kind, blocker] of Object.entries(examples)) expect(blocker.kind).toBe(kind);
  });

  it('names its run states, and is audited under an action of its own', () => {
    expect(ATM_BRANCH_MOVE_RUN_STATES).toEqual(['running', 'done', 'failed']);
    expect(AUDIT_ACTIONS).toContain('atmBranchMove');
  });
});
