// A payslip is read on a screen and printed by the browser. Nothing else (PY-12).
//
// THE DECISIONS, frozen in docs/12-planning/payroll-payslip-export.md:
//   1. no PDF at this time;
//   2. the payslip screen plus browser print are sufficient for this stage;
//   3. add NOTHING on speculation — no endpoint, no permission, no storage, no Chromium;
//   4. PDF is documented as a future capability, a phase of its own;
//   5. when it is eventually built it must render from the payslip SNAPSHOT, never from the
//      employee's current data.
//
// Decision 3 is what this file guards, and speculative infrastructure is unusually easy to add
// "while we are here": a permission that costs nothing to declare, an import that costs nothing to
// write, a file column that costs nothing to leave null. Each one is a claim that a decision was
// taken which was not.
//
// Decision 5 is guarded here too, from the other end — the stored payslip must stay complete
// enough to render from, which is a property of what PY-7 writes, not of a renderer that does not
// exist yet.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');
const HR_MODULE = resolve(HERE, '../../hr.module.ts');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — this file's own prose must not satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const payrollFiles = sources(PAYROLL);
const rel = (file: string): string => file.slice(PAYROLL.length + 1);

describe('nothing was built for a PDF that was not asked for', () => {
  it('payroll imports no PDF renderer and no browser', () => {
    for (const file of payrollFiles) {
      const source = code(file);
      expect(source, rel(file)).not.toContain('platform/pdf');
      expect(source, rel(file)).not.toContain('puppeteer');
      expect(source, rel(file)).not.toContain('renderPdfFromHtml');
      expect(source, rel(file)).not.toContain('CHROMIUM_PATH');
    }
  });

  /**
   * Decision 3 — no storage FOR PAYSLIP OUTPUT. A payslip is computed and stored as a document
   * (PY-7); it produces no file, so nothing on the pricing-and-issuing path uploads one.
   *
   * Narrowed when P-HR-04 arrived, not weakened. An adjustment's supporting document — the memo
   * behind a bonus, the letter behind a penalty — is an INPUT a human attaches to a decision, and
   * it is the opposite of what this guard exists to stop: a rendered artefact of the payslip
   * quietly acquiring a storage lifecycle. So the assertion now names the path it protects.
   */
  it('nothing on the payslip pricing-and-issuing path writes a file', () => {
    const pipeline = payrollFiles.filter((file) =>
      ['payslips/', 'runs/', 'compensation/', 'pay-items/', 'employee-pay-items/'].some((dir) =>
        rel(file).startsWith(dir),
      ),
    );
    expect(pipeline.length).toBeGreaterThan(10);
    for (const file of pipeline) {
      expect(code(file), rel(file)).not.toContain('fileService.upload');
    }
  });

  // …and the one upload payroll does have is exactly the adjustment attachment, nowhere else.
  it('the only file payroll uploads is an adjustment’s supporting document', () => {
    const uploaders = payrollFiles.filter((file) => code(file).includes('fileService.upload'));
    expect(uploaders.map(rel)).toEqual(['adjustments/payroll-adjustment.service.ts']);
  });

  /**
   * Decision 3 — no permission on speculation.
   *
   * Read from the HR manifest, which is where `declarePermissions` actually mints HR keys. (The
   * generated permission matrix covers only the contract-declared platform catalog, so asserting
   * against it here would have proved nothing about payroll.)
   */
  it('the HR manifest declares no payslip resource, and no print or export on payroll', () => {
    const manifest = code(HR_MODULE);
    const declarations = [
      ...manifest.matchAll(/declarePermissions\(\s*'hr',\s*'([a-zA-Z]+)',[\s\S]*?\[([^\]]*)\]/g),
    ].map((m) => ({ resource: m[1] as string, actions: m[2] as string }));
    expect(declarations.length).toBeGreaterThan(0);

    // No resource is a payslip: a payslip is read under `employee.viewCompensation`, which is the
    // key that already governs seeing somebody's pay.
    expect(declarations.filter((d) => d.resource.toLowerCase().includes('payslip'))).toEqual([]);

    for (const declaration of declarations.filter((d) => d.resource.startsWith('pay'))) {
      expect(declaration.actions, declaration.resource).not.toContain("'print'");
      expect(declaration.actions, declaration.resource).not.toContain("'export'");
    }
  });
});

/**
 * Decision 5, guarded from the writing end.
 *
 * The requirement is that a future renderer reads the SNAPSHOT and nothing live. That is only
 * possible while the snapshot is complete, so what has to hold today is that PY-7 keeps storing
 * the identity and the figures rather than ids to look up later.
 */
describe('the snapshot stays renderable on its own', () => {
  const model = code(resolve(HERE, 'payslip.model.ts'));
  const contract = code(resolve(HERE, '../../../../../../../packages/contracts/src/modules/hr-payroll.ts'));

  it('stores the identity as it stood at issue, not a reference to resolve later', () => {
    // Stored as one embedded document rather than flat columns — so the assertion is that the
    // column exists here and that the shape it holds carries the readable identity.
    expect(model).toContain('employee: { type: Schema.Types.Mixed, required: true }');
    const dto = contract.slice(
      contract.indexOf('export interface PayslipEmployeeDto'),
      contract.indexOf('export interface PayslipDto'),
    );
    expect(dto.length).toBeGreaterThan(0);
    for (const field of ['code', 'fullNameAr', 'jobTitle']) {
      expect(dto, field).toContain(field);
    }
  });

  it('and stores the money, in minor units', () => {
    for (const field of ['totalEarningsMinor', 'totalDeductionsMinor', 'netMinor', 'currency']) {
      expect(model, field).toContain(field);
    }
  });
});
