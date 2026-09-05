// The go-live tools must not send anything, and the thing that would send is the BOOT.
//
// `bootPlatform` runs `hr.seed`, which runs the D2 login backfill: a login for every employed
// employee that lacks one, and a WhatsApp message and email to each of them. Both CLIs boot before
// they read anything, so "dry run" is only true if the guard has already run — and a guard placed
// after the boot, or behind `--write`, is checked after the messages are gone.
//
// This pins both halves: what the guard does, and — reading the CLI SOURCE — that each one calls
// it before it boots and before it even looks at `--write`. The ordering is the whole property,
// and ordering is exactly what a behavioural test of either CLI would not catch.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provisioning = { enabled: true };

vi.mock('./infrastructure/config/env', () => ({
  env: {
    get HR_PROVISION_MISSING_LOGINS(): boolean {
      return provisioning.enabled;
    },
  },
}));

const { assertLoginProvisioningDisabled } = await import('./workforce-boot-guard');

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');

beforeEach(() => {
  provisioning.enabled = true;
});

describe('the guard itself', () => {
  it('refuses while the backfill is armed, naming the command and the variable', () => {
    expect(() => assertLoginProvisioningDisabled('reset:workforce')).toThrow(
      /HR_PROVISION_MISSING_LOGINS=true/u,
    );
    expect(() => assertLoginProvisioningDisabled('reset:workforce')).toThrow(/reset:workforce/u);
  });

  /** The operator has to be told what to change; an error that only says "no" costs a support round. */
  it('says what to set, and that a dry run is not exempt', () => {
    expect(() => assertLoginProvisioningDisabled('import:workforce')).toThrow(
      /HR_PROVISION_MISSING_LOGINS=false/u,
    );
    expect(() => assertLoginProvisioningDisabled('import:workforce')).toThrow(/dry run/u);
  });

  it('passes silently once the backfill is disabled', () => {
    provisioning.enabled = false;
    expect(() => assertLoginProvisioningDisabled('reset:workforce')).not.toThrow();
  });
});

describe.each([
  ['reset-workforce.cli.ts'],
  ['import-workforce.cli.ts'],
])('%s calls the guard before it can send anything', (file) => {
  const text = source(`./${file}`);
  const guardAt = text.indexOf('assertLoginProvisioningDisabled(');
  const bootAt = text.indexOf('await bootPlatform(');
  const writeAt = text.indexOf("includes('--write')");

  it('calls the guard at all', () => {
    expect(guardAt, 'guard call not found').toBeGreaterThan(-1);
    expect(bootAt, 'bootPlatform call not found').toBeGreaterThan(-1);
  });

  /** After the boot the messages have already been delivered, and refusing achieves nothing. */
  it('calls it BEFORE bootPlatform', () => {
    expect(guardAt).toBeLessThan(bootAt);
  });

  /**
   * The guard must not be reachable only on a write. A dry run boots the same platform and sends
   * the same messages, so the check has to happen before the command even knows which it is.
   */
  it('calls it before it looks at --write', () => {
    expect(writeAt, '--write parsing not found').toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(writeAt);
  });
});
