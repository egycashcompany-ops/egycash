export { authService, registerAuthEventHandlers } from './auth.service';
export {
  authenticate,
  authenticateOptional,
  authContext,
  authContextOrNull,
} from './auth.middleware';
export { registerAuthSettings } from './auth.settings';
export { buildAuthRouter } from './auth.routes';
export {
  registerExternalSurface,
  registerExternalWriteSurface,
  externalMayReach,
} from './external-surfaces';
export { registerExternalSubjectLabel } from './identity-seams';
export { userSnapshotKey } from './user-snapshot-cache';
export { ACTIVE_BRANCH_HEADER } from './active-branch';
