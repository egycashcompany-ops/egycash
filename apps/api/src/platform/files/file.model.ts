// File metadata (ADR-010): binary data NEVER enters MongoDB. One document per
// content version; versions share a group; exactly one version isLatest.
import { Schema, model, type Types } from 'mongoose';
import {
  FILE_STATUSES,
  FILE_VISIBILITIES,
  SCAN_STATUSES,
  type EntityRef,
  type FileStatus,
  type FileVisibility,
  type ScanStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface FileDoc extends BaseDocFields {
  groupId: Types.ObjectId;
  /** Content version within the group (1-based). `__v` remains the metadata version. */
  fileVersion: number;
  isLatest: boolean;
  originalName: string;
  storedName: string;
  displayName: string;
  description: string | null;
  mime: string;
  extension: string;
  size: number;
  /** `sha256:<hex>` — dedup + integrity (chain-of-custody grade, ADR-010). */
  checksum: string;
  categoryId: Types.ObjectId;
  tags: string[];
  visibility: FileVisibility;
  status: FileStatus;
  scanStatus: ScanStatus;
  entityRef: EntityRef;
  storage: { driver: string; key: string };
  uploadedBy: Types.ObjectId | null;
  uploadedAt: Date;
  archivedAt: Date | null;
}

const fileSchema = new Schema<FileDoc>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    fileVersion: { type: Number, required: true, min: 1 },
    isLatest: { type: Boolean, required: true, default: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    displayName: { type: String, required: true },
    description: { type: String, default: null },
    mime: { type: String, required: true },
    extension: { type: String, required: true, default: '' },
    size: { type: Number, required: true, min: 0 },
    checksum: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    tags: { type: [String], default: [] },
    visibility: { type: String, enum: FILE_VISIBILITIES, default: 'private' },
    status: { type: String, enum: FILE_STATUSES, default: 'active' },
    scanStatus: { type: String, enum: SCAN_STATUSES, default: 'unscanned' },
    entityRef: {
      moduleId: { type: String, required: true },
      entityType: { type: String, required: true },
      entityId: { type: String, required: true },
    },
    storage: {
      driver: { type: String, required: true },
      key: { type: String, required: true },
    },
    uploadedBy: { type: Schema.Types.ObjectId, default: null },
    uploadedAt: { type: Date, required: true },
    archivedAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

fileSchema.index(
  { 'entityRef.moduleId': 1, 'entityRef.entityType': 1, 'entityRef.entityId': 1, isLatest: 1 },
  { name: 'ix_entityRef' },
);
fileSchema.index({ groupId: 1, fileVersion: 1 }, { unique: true, name: 'ux_groupId_version' });
fileSchema.index({ checksum: 1 }, { name: 'ix_checksum' });
fileSchema.index({ categoryId: 1 }, { name: 'ix_categoryId' });
fileSchema.index({ tags: 1 }, { name: 'ix_tags' });

export const FileModel = model<FileDoc>('File', fileSchema, 'files');
