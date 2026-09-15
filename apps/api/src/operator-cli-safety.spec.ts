// The preconditions every platform-booting CLI shares.
//
// These are source-level on purpose. The thing being guarded against is not a wrong value coming
// back from a function — it is a LINE THAT IS NOT THERE, in a file nobody runs except on go-live
// day, against the company's real database. There is no test that can call `main()` and observe
// that ~1,670 WhatsApp messages were not sent.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(HERE, name), 'utf8');

/** Every CLI in this directory that boots the platform. */
const BOOTING_CLIS = [
  'import-workforce.cli.ts',
  'reset-workforce.cli.ts',
  'fleet-vocabulary.cli.ts',
  'fleet-vehicles-import.cli.ts',
];

describe('a CLI that boots the platform cannot message the whole company by accident', () => {
  it.each(BOOTING_CLIS)('%s guards login provisioning BEFORE it boots', (name) => {
    const source = read(name);
    // `bootPlatform` runs HR's login backfill: a login for every employed employee that has none,
    // and a WhatsApp message and an email to each with a setup link. `HR_PROVISION_MISSING_LOGINS`
    // DEFAULTS TO TRUE, so the unlucky path is the default one, and a dry run sends them too.
    const guard = source.indexOf('assertLoginProvisioningDisabled(');
    const boot = source.indexOf('bootPlatform(');
    expect(guard, `${name} calls the guard`).toBeGreaterThan(-1);
    expect(boot, `${name} boots`).toBeGreaterThan(-1);
    // ORDER IS THE WHOLE POINT. After the boot the messages are already delivered, and refusing
    // then achieves nothing at all.
    expect(guard, `${name} guards before it boots`).toBeLessThan(boot);
  });

  it('every CLI that boots is on that list — a new one cannot quietly skip it', () => {
    // The list above is only as good as its completeness, so it is checked against the directory
    // rather than trusted. A new `*.cli.ts` that boots the platform fails here until it is added,
    // and adding it is what makes the guard assertion above apply to it.
    const names = readFileSync(join(HERE, '../package.json'), 'utf8');
    for (const cli of BOOTING_CLIS) {
      expect(names, `${cli} is wired to an npm script`).toContain(cli);
    }
  });
});

describe('the vehicle import refuses rather than half-finishes', () => {
  const CLI = read('fleet-vehicles-import.cli.ts');
  const LIB = read('modules/fleet/go-live/vehicles-import.ts');

  it('checks ALL FOUR unique identifiers before writing, not just the code', () => {
    // FR-1 gives code, plate, chassis and motor a partial unique index each. Checking only `code`
    // means the other three are discovered as a mid-loop database rejection — after real cars have
    // been written — and the operator sees an unreadable "Duplicate" with no field named.
    expect(LIB).toContain('identifierClashes');
    for (const field of ['plateNumber', 'chassisNumber', 'motorNumber']) {
      expect(LIB, `${field} is pre-checked`).toContain(`['${field}', car.${field}]`);
    }
    // A row that is the car's OWN is an update, not a clash.
    expect(LIB).toContain('holder.code !== car.code');
    // The BLOCKING expression specifically, not merely a mention: the report prints the same
    // phrase, so a looser assertion passes while the run happily writes anyway.
    const at = CLI.indexOf('const blocked =');
    expect(at, 'the refusal is computed').toBeGreaterThan(-1);
    const decision = CLI.slice(at, CLI.indexOf(';', at));
    expect(decision, 'a clash blocks the run').toContain('plan.identifierClashes.length > 0');
    expect(decision, 'so does a missing branch').toContain('plan.missingBranches.length > 0');
    expect(decision, 'so does an unreadable row').toContain('parsed.rejected.length > 0');
  });

  it('will not create a near-duplicate name on a write unless told to', () => {
    // Catalogs have no delete route, so «نقل اموال» beside «نقل أموال» is permanent from the
    // moment it is written, and splits every filter that reads either.
    expect(CLI).toContain('--allow-near-duplicates');
    expect(CLI).toContain('nearBlocks');
    // The DRY RUN still shows them — this refuses to decide, it does not hide.
    expect(CLI).toContain('write && plan.nearMatches.length > 0');
  });

  it('exits non-zero when cars were lost, and does not call it complete', () => {
    // The one outcome where the tool tells the operator the opposite of what happened: every car
    // failing, the last line reading "vehicle import complete", and the shell seeing success.
    expect(CLI).toContain('blocked || failed > 0 ? 1 : 0');
    expect(CLI).toContain('vehicle import finished WITH FAILURES');
  });
});

describe('rows these scripts create carry an author', () => {
  it('passes the operator through to the catalog rows, beside the vehicles they belong to', () => {
    // A catalog entry written with `by: null` next to a fully-audited vehicle, in the same run, by
    // the same person, is a gap in exactly the trail an import most needs.
    expect(read('modules/fleet/go-live/vocabulary.ts')).toMatch(/ensure\([\s\S]{0,200}\bby,/);
    expect(read('modules/fleet/go-live/vehicles-import.ts')).toMatch(/ensure\([\s\S]{0,160}\bby,/);
    // The BOOT seed still has no author, and `null` stays the honest record of that.
    const service = readFileSync(
      join(HERE, 'modules/fleet/catalogs/catalog-item.service.ts'),
      'utf8',
    );
    expect(service).toContain('by: string | null = null');
  });
});
