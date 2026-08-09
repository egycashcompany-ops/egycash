// Public surface of the files feature — nothing else is importable.
export { fileService, type UploadedBinary } from './file.service';
export { fileCategoryService } from './file-category.service';
export {
  registerFileProcessor,
  registerFileJobHandlers,
  clearFileProcessors,
  hasFileProcessor,
  type FileProcessor,
  type FileProcessorResult,
} from './file.processors';
export { buildFilesRouter, buildFileCategoriesRouter } from './file.routes';
export { type FileDoc } from './file.model';
export {
  registerFileEntityAuthorizer,
  registerFileEntityAuthorizers,
  hasFileEntityAuthorizer,
  clearFileEntityAuthorizers,
  authorizeFileEntity,
  AUTHORIZER_TIMEOUT_MS,
  type FileEntityAuthorizer,
  type FileAccessIntent,
} from './file-authorizers';
