// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest
// under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so the module
// never imports infrastructure directly (Module Structure §1).
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  addEmployeeFileNote,
  createEmployeeFile,
  getEmployeeFile,
  listEmployeeFiles,
} from './employee-file.controller';
import {
  AddEmployeeFileNoteSchema,
  CreateEmployeeFileSchema,
  EmployeeFileIdParamSchema,
  ListEmployeeFilesQuerySchema,
} from './employee-file.validation';

export const buildEmployeeFilesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('employeeFile.view'),
    validate({ query: ListEmployeeFilesQuerySchema }),
    asyncHandler(listEmployeeFiles),
  );
  router.post(
    '/',
    authenticate,
    authorize('employeeFile.create'),
    validate({ body: CreateEmployeeFileSchema }),
    asyncHandler(createEmployeeFile),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('employeeFile.view'),
    validate({ params: EmployeeFileIdParamSchema }),
    asyncHandler(getEmployeeFile),
  );
  router.post(
    '/:id/notes',
    authenticate,
    authorize('employeeFile.edit'),
    validate({ body: AddEmployeeFileNoteSchema, params: EmployeeFileIdParamSchema }),
    asyncHandler(addEmployeeFileNote),
  );

  return router;
};
