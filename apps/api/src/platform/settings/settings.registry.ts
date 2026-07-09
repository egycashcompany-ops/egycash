// Settings are DECLARED IN CODE (key, Zod type, default, allowed scopes) by platform
// services and modules; values live in DB; unknown keys are rejected (Platform Core §5).
// Feature flags (Review R27) auto-declare as `flag.<key>` boolean settings.
import { type ZodType } from 'zod';
import { featureFlags, type SettingScope } from '@ecms/contracts';

export interface SettingDeclaration<T = unknown> {
  key: string;
  description: string;
  schema: ZodType<T>;
  defaultValue: T;
  /** Which hierarchy levels may override (ADR-015: organization → branch → user). */
  allowedScopes: SettingScope[];
}

const registry = new Map<string, SettingDeclaration>();

export const declareSetting = <T>(declaration: SettingDeclaration<T>): void => {
  if (registry.has(declaration.key)) {
    throw new Error(`duplicate setting declaration: ${declaration.key}`);
  }
  registry.set(declaration.key, declaration as SettingDeclaration);
};

export const getSettingDeclaration = (key: string): SettingDeclaration | undefined =>
  registry.get(key);

export const listSettingDeclarations = (): SettingDeclaration[] => [...registry.values()];

export const flagSettingKey = (flagKey: string): string => `flag.${flagKey}`;

/** Called once at boot after all services declared their settings. */
export const declareFeatureFlagSettings = (booleanSchema: ZodType<boolean>): void => {
  for (const flag of featureFlags) {
    declareSetting({
      key: flagSettingKey(flag.key),
      description: `[feature flag] ${flag.description} (owner: ${flag.owner}, expires: ${flag.expiresAt})`,
      schema: booleanSchema,
      defaultValue: flag.defaultValue,
      allowedScopes: ['organization', 'branch', 'user'],
    });
  }
};

/** Test-only. */
export const clearSettingRegistry = (): void => {
  registry.clear();
};
