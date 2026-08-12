// The wall between Payroll and the leave ledger (PY-6).
//
// The same shape as the attendance wall, for a sharper reason: the ledger has NO freeze of its
// own. A request completes, is cancelled or returns early after a period has been priced, and a
// `consume` entry is appended when it does — so reading the ledger at pricing time would give the
// same month two different answers on two different days.
//
// Hence the rule: leave is read ONCE, at freeze time, through the port, and everything downstream
// reads the snapshot instead. Nothing but the port may name the ledger at all.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');
const PORT = 'runs/leave-facts.port.ts';

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

const payrollFiles = sources(PAYROLL);

/** Code only — these files explain the seam, so their prose names what the assertions forbid. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

describe('Payroll reaches the leave ledger through exactly one door', () => {
  it('imports leave-management from the port file and nowhere else', () => {
    const importers = payrollFiles.filter((file) =>
      /from '[^']*\/leave-management(\/[^']*)?'/.test(code(file)),
    );
    expect(importers.map((f) => f.slice(PAYROLL.length + 1))).toEqual([PORT]);
  });

  it('never names the ledger, the balance cache or a leave collection outside the port', () => {
    for (const file of payrollFiles) {
      if (file.endsWith(PORT)) continue;
      const source = code(file);
      for (const forbidden of [
        'LeaveLedgerModel',
        'LeaveBalanceModel',
        'LeaveRequestModel',
        'hr_leave_ledger',
        'leaveBalanceService',
      ]) {
        expect(source, `${file.slice(PAYROLL.length + 1)} names ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  // The rule the snapshot exists to enforce: the ledger is a freeze-time read, never a pricing one.
  it('reads the ledger only from the run service, which is the freeze path', () => {
    const callers = payrollFiles.filter((file) => code(file).includes('leaveFactsPort'));
    expect(callers.map((f) => f.slice(PAYROLL.length + 1)).sort()).toEqual(
      [PORT, 'runs/payroll-run.service.ts'].sort(),
    );
  });

  it('never writes to leave — the ledger is append-only and belongs to Leave', () => {
    const port = code(resolve(PAYROLL, PORT));
    for (const write of ['.create(', '.updateOne(', '.deleteOne(', '.insertMany(', '.save(']) {
      expect(port, write).not.toContain(write);
    }
  });

  it('keeps the door small enough to review in one sitting', () => {
    expect(readFileSync(resolve(PAYROLL, PORT), 'utf8').split('\n').length).toBeLessThan(90);
  });
});
