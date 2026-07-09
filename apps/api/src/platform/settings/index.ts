export { settingsService, type SettingSubject } from './settings.service';
export {
  declareSetting,
  declareFeatureFlagSettings,
  clearSettingRegistry,
  flagSettingKey,
  type SettingDeclaration,
} from './settings.registry';
export { buildSettingsRouter, buildFeatureFlagsRouter } from './settings.routes';
