// Version groups (ADR-010): re-upload to a group = version n+1. The group also
// provides atomic version allocation under concurrent replaces.
import { Schema, model, type Types } from 'mongoose';
import { type EntityRef } from '@ecms/contracts';

export interface FileGroupDoc {
  _id: Types.ObjectId;
  entityRef: EntityRef;
  latestVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const fileGroupSchema = new Schema<FileGroupDoc>(
  {
    entityRef: {
      moduleId: { type: String, required: true },
      entityType: { type: String, required: true },
      entityId: { type: String, required: true },
    },
    latestVersion: { type: Number, required: true, default: 1 },
  },
  { strict: true, timestamps: true, versionKey: false },
);

export const FileGroupModel = model<FileGroupDoc>('FileGroup', fileGroupSchema, 'file_groups');
