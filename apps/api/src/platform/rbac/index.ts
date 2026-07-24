export { rbacService, type EffectivePermissions } from './rbac.service';
export { authorize, authorizeAny } from './rbac.middleware';
export {
  buildPermissionsRouter,
  buildRolesRouter,
  buildRoleAssignmentsRouter,
} from './rbac.routes';
