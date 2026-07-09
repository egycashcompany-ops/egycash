// Standard metadata every collection carries (Database Design §1.1).
import { Schema, type Types } from 'mongoose';

export interface BaseDocFields {
  _id: Types.ObjectId;
  schemaVersion: number;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
}

export const baseFields = {
  schemaVersion: { type: Number, required: true, default: 1 },
  isDeleted: { type: Boolean, required: true, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Schema.Types.ObjectId, default: null },
  createdBy: { type: Schema.Types.ObjectId, default: null },
  updatedBy: { type: Schema.Types.ObjectId, default: null },
} as const;

export const baseSchemaOptions = {
  timestamps: true,
  strict: true as const,
};

/** Standard record-assignment sub-document (Review R17) for assignable entities. */
export const assigneeFields = {
  userId: { type: Schema.Types.ObjectId, required: true },
  role: { type: String, enum: ['owner', 'assignee', 'watcher'], required: true },
  at: { type: Date, required: true },
} as const;
