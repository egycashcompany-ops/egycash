// What a reference-data mutation moves in the query cache.
//
// The failure this guards is silent: after renaming a bank, the branches table still shows the old
// operational name until something else happens to refetch it. Nothing throws, nothing logs — the
// operator simply reads a stale value and believes it. So the invalidation fan-out is asserted
// directly, against a real QueryClient.
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { listKey } from '../../../shared/lib/query-keys';
import { __operationsKeys } from './operations-queries';

/** Seed one cache entry per feature so "did it become stale?" is answerable per feature. */
const seed = (qc: QueryClient): void => {
  qc.setQueryData(listKey('operations', 'banks', { page: 1 }), { items: [] });
  qc.setQueryData(listKey('operations', 'bankBranches', { page: 1 }), { items: [] });
  qc.setQueryData(listKey('operations', 'currencies', { page: 1 }), { items: [] });
};

const isStale = (qc: QueryClient, key: readonly unknown[]): boolean =>
  qc
    .getQueryCache()
    .findAll({ queryKey: key })
    .every((query) => query.state.isInvalidated);

describe('operations reference-data cache keys', () => {
  it('keeps the three features on separate subtrees', () => {
    expect(__operationsKeys.banks).toEqual(['operations', 'banks']);
    expect(__operationsKeys.branches).toEqual(['operations', 'bankBranches']);
    expect(__operationsKeys.currencies).toEqual(['operations', 'currencies']);
  });

  it('a bank change also stales the branches — branch rows show their bank name', async () => {
    const qc = new QueryClient();
    seed(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.banks });
    await qc.invalidateQueries({ queryKey: __operationsKeys.branches });

    expect(isStale(qc, __operationsKeys.banks)).toBe(true);
    expect(isStale(qc, __operationsKeys.branches)).toBe(true);
    // ...but currencies are untouched: nothing about them depends on a bank.
    expect(isStale(qc, __operationsKeys.currencies)).toBe(false);
  });

  it('a branch change does NOT stale the banks — the dependency runs one way only', async () => {
    const qc = new QueryClient();
    seed(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.branches });

    expect(isStale(qc, __operationsKeys.branches)).toBe(true);
    expect(isStale(qc, __operationsKeys.banks)).toBe(false);
    expect(isStale(qc, __operationsKeys.currencies)).toBe(false);
  });

  it('a currency change touches currencies alone', async () => {
    const qc = new QueryClient();
    seed(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.currencies });

    expect(isStale(qc, __operationsKeys.currencies)).toBe(true);
    expect(isStale(qc, __operationsKeys.banks)).toBe(false);
    expect(isStale(qc, __operationsKeys.branches)).toBe(false);
  });

  it('paginated entries of the same feature all stale together', async () => {
    const qc = new QueryClient();
    qc.setQueryData(listKey('operations', 'banks', { page: 1 }), { items: [] });
    qc.setQueryData(listKey('operations', 'banks', { page: 2 }), { items: [] });
    await qc.invalidateQueries({ queryKey: __operationsKeys.banks });

    expect(qc.getQueryCache().findAll({ queryKey: __operationsKeys.banks })).toHaveLength(2);
    expect(isStale(qc, __operationsKeys.banks)).toBe(true);
  });
});

describe('shipment write fan-out (B2)', () => {
  // The board and the shipment list are two views of the same facts. A receive toggle that stales
  // only one of them looks, to the operator, like a click that did nothing.
  const seedShipmentViews = (qc: QueryClient): void => {
    qc.setQueryData(listKey('operations', 'shipments', { page: 1 }), { items: [] });
    qc.setQueryData(listKey('operations', 'dayBoard', { date: 'today' }), { shipments: [] });
    qc.setQueryData(listKey('operations', 'dayBoard', { date: '2026-10-05' }), { shipments: [] });
    qc.setQueryData(listKey('operations', 'banks', { page: 1 }), { items: [] });
  };

  it('stales the board AND the shipment list together', async () => {
    const qc = new QueryClient();
    seedShipmentViews(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.shipments });
    await qc.invalidateQueries({ queryKey: __operationsKeys.dayBoard });

    expect(isStale(qc, __operationsKeys.shipments)).toBe(true);
    expect(isStale(qc, __operationsKeys.dayBoard)).toBe(true);
  });

  it('stales EVERY cached day, not just the one on screen', async () => {
    const qc = new QueryClient();
    seedShipmentViews(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.dayBoard });

    // Editing a shipment can move it between days, so a stale other-day board is a real bug.
    expect(qc.getQueryCache().findAll({ queryKey: __operationsKeys.dayBoard })).toHaveLength(2);
    expect(isStale(qc, __operationsKeys.dayBoard)).toBe(true);
  });

  it('leaves reference data alone — a shipment write changes no bank', async () => {
    const qc = new QueryClient();
    seedShipmentViews(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.shipments });
    await qc.invalidateQueries({ queryKey: __operationsKeys.dayBoard });

    expect(isStale(qc, __operationsKeys.banks)).toBe(false);
  });

  it('keeps the board on its own subtree, distinct from the list', () => {
    expect(__operationsKeys.dayBoard).toEqual(['operations', 'dayBoard']);
    expect(__operationsKeys.shipments).toEqual(['operations', 'shipments']);
  });
});

describe('crew board write fan-out (B3)', () => {
  // Two dependencies run in one direction each, and both are easy to get wrong:
  //   · planning changes who is TAKEN → the pool must restale, or a card stays draggable after
  //     being assigned;
  //   · editing the roster changes who is OFFERED → the pool must restale, or a new member never
  //     appears until a reload.
  const seedCrew = (qc: QueryClient): void => {
    qc.setQueryData(listKey('operations', 'crewBoard', { date: 'tomorrow' }), { rows: [] });
    qc.setQueryData(listKey('operations', 'crewDirectory', { date: 'tomorrow' }), { members: [] });
    qc.setQueryData(listKey('operations', 'crewRequirements', { page: 1 }), { items: [] });
    qc.setQueryData(listKey('operations', 'dayBoard', { date: 'today' }), { shipments: [] });
  };

  it('planning stales the board AND the pool', async () => {
    const qc = new QueryClient();
    seedCrew(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.crewBoard });
    await qc.invalidateQueries({ queryKey: __operationsKeys.crewDirectory });

    expect(isStale(qc, __operationsKeys.crewBoard)).toBe(true);
    expect(isStale(qc, __operationsKeys.crewDirectory)).toBe(true);
  });

  it('a roster edit stales the pool as well as the roster list', async () => {
    const qc = new QueryClient();
    seedCrew(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.crewRequirements });
    await qc.invalidateQueries({ queryKey: __operationsKeys.crewDirectory });

    expect(isStale(qc, __operationsKeys.crewRequirements)).toBe(true);
    expect(isStale(qc, __operationsKeys.crewDirectory)).toBe(true);
  });

  it('crew work leaves the shipment board alone — they are different facts', async () => {
    const qc = new QueryClient();
    seedCrew(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.crewBoard });
    await qc.invalidateQueries({ queryKey: __operationsKeys.crewDirectory });

    expect(isStale(qc, __operationsKeys.dayBoard)).toBe(false);
  });

  it('keeps board, pool and roster on separate subtrees', () => {
    expect(__operationsKeys.crewBoard).toEqual(['operations', 'crewBoard']);
    expect(__operationsKeys.crewDirectory).toEqual(['operations', 'crewDirectory']);
    expect(__operationsKeys.crewRequirements).toEqual(['operations', 'crewRequirements']);
  });
});

// ── Reports + attendance (B5) ───────────────────────────────────────────────────────────────────
//
// The guard here is the OPPOSITE of the one above: these three must NOT be dragged into any
// Operations write's fan-out. A month's report is a roll-up of shipments that are already
// complete, and attendance is HR's record — a shipment saved today changes neither, and staling
// them on every write would refetch a month's aggregation for nothing.
describe('report and attendance caches (B5)', () => {
  const seedB5 = (qc: QueryClient): void => {
    qc.setQueryData(listKey('operations', 'reportCaptains', { from: '2026-08-01', to: '2026-08-31' }), {
      rows: [],
    });
    qc.setQueryData(listKey('operations', 'reportBanks', { from: '2026-08-01', to: '2026-08-31' }), {
      rows: [],
    });
    qc.setQueryData(listKey('operations', 'crewAttendance', { date: '2026-08-18' }), { members: [] });
  };

  it('keeps the two reports and attendance on their own subtrees', () => {
    expect(__operationsKeys.reportCaptains).toEqual(['operations', 'reportCaptains']);
    expect(__operationsKeys.reportBanks).toEqual(['operations', 'reportBanks']);
    expect(__operationsKeys.crewAttendance).toEqual(['operations', 'crewAttendance']);
  });

  it('a secured act stales the four secured screens and leaves the reports alone', async () => {
    const qc = new QueryClient();
    seed(qc);
    seedB5(qc);
    qc.setQueryData(listKey('operations', 'vault', { page: 1 }), { items: [] });

    // Exactly what `useSecuredInvalidation` does.
    for (const key of [
      __operationsKeys.securedBacklog,
      __operationsKeys.securedDue,
      __operationsKeys.vault,
      __operationsKeys.shipments,
      __operationsKeys.dayBoard,
    ]) {
      await qc.invalidateQueries({ queryKey: key });
    }

    expect(isStale(qc, __operationsKeys.vault)).toBe(true);
    expect(isStale(qc, __operationsKeys.reportCaptains)).toBe(false);
    expect(isStale(qc, __operationsKeys.reportBanks)).toBe(false);
    expect(isStale(qc, __operationsKeys.crewAttendance)).toBe(false);
  });

  it('planning the crew does not stale attendance — Operations does not write HR records', async () => {
    const qc = new QueryClient();
    seedB5(qc);
    qc.setQueryData(listKey('operations', 'crewBoard', { date: '2026-08-18' }), { vehicles: [] });

    await qc.invalidateQueries({ queryKey: __operationsKeys.crewBoard });
    await qc.invalidateQueries({ queryKey: __operationsKeys.crewDirectory });

    expect(isStale(qc, __operationsKeys.crewBoard)).toBe(true);
    expect(isStale(qc, __operationsKeys.crewAttendance)).toBe(false);
  });

  it('the two reports are independent — a captain range does not stale the bank one', async () => {
    const qc = new QueryClient();
    seedB5(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.reportCaptains });

    expect(isStale(qc, __operationsKeys.reportCaptains)).toBe(true);
    expect(isStale(qc, __operationsKeys.reportBanks)).toBe(false);
  });

  it('caches each range separately, so switching months back is a hit not a refetch', () => {
    const august = listKey('operations', 'reportCaptains', { from: '2026-08-01', to: '2026-08-31' });
    const july = listKey('operations', 'reportCaptains', { from: '2026-07-01', to: '2026-07-31' });
    expect(august).not.toEqual(july);

    const qc = new QueryClient();
    qc.setQueryData(august, { rows: ['august'] });
    qc.setQueryData(july, { rows: ['july'] });
    expect(qc.getQueryData(august)).toEqual({ rows: ['august'] });
    expect(qc.getQueryData(july)).toEqual({ rows: ['july'] });
  });
});

// ── Vault roll-up + areas (B6) ──────────────────────────────────────────────────────────────────
//
// The roll-up is the OPPOSITE case from the reports: it IS part of the secured fan-out. It answers
// "what is in the vault now", so receiving or dispatching changes it — and if it did not stale
// alongside the inventory, the two vault screens would show different holdings side by side.
describe('vault roll-up and area caches (B6)', () => {
  it('stales with the vault inventory on a secured act — they are one question', async () => {
    const qc = new QueryClient();
    qc.setQueryData(listKey('operations', 'vault', { page: 1 }), { items: [] });
    qc.setQueryData(listKey('operations', 'vaultReport', {}), { rows: [] });
    qc.setQueryData(listKey('operations', 'reportBanks', { from: 'x', to: 'y' }), { rows: [] });

    for (const key of [
      __operationsKeys.securedBacklog,
      __operationsKeys.securedDue,
      __operationsKeys.vault,
      __operationsKeys.vaultReport,
      __operationsKeys.shipments,
      __operationsKeys.dayBoard,
    ]) {
      await qc.invalidateQueries({ queryKey: key });
    }

    expect(isStale(qc, __operationsKeys.vault)).toBe(true);
    expect(isStale(qc, __operationsKeys.vaultReport)).toBe(true);
    // ...while the completed-shipment report is still untouched: dispatching does not complete.
    expect(isStale(qc, __operationsKeys.reportBanks)).toBe(false);
  });

  it('stales the branches when an area changes — the branch form suggests from that list', async () => {
    const qc = new QueryClient();
    seed(qc);
    qc.setQueryData(listKey('operations', 'areas', { page: 1 }), { items: [] });

    await qc.invalidateQueries({ queryKey: __operationsKeys.areas });
    await qc.invalidateQueries({ queryKey: __operationsKeys.branches });

    expect(isStale(qc, __operationsKeys.areas)).toBe(true);
    expect(isStale(qc, __operationsKeys.branches)).toBe(true);
    // Banks and currencies have nothing to do with an area.
    expect(isStale(qc, __operationsKeys.banks)).toBe(false);
    expect(isStale(qc, __operationsKeys.currencies)).toBe(false);
  });

  it('keeps areas on their own subtree', () => {
    expect(__operationsKeys.areas).toEqual(['operations', 'areas']);
    expect(__operationsKeys.vaultReport).toEqual(['operations', 'vaultReport']);
  });
});
