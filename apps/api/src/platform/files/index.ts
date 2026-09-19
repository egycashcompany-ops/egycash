// Public surface of the files feature — nothing else is importable.
export { fileService, type UploadedBinary } from './file.service';
export { fileCategoryService } from './file-category.service';
export {
  registerFileProcessor,
  registerFileJobHandlers,
  clearFileProcessors,
  hasFileProcessor,
  rescanPendingFiles,
  RESCAN_AFTER_MINUTES,
  type FileProcessor,
  type FileProcessorResult,
} from './file.processors';
export { registerVirusScanner } from './virus-scan.processor';
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
