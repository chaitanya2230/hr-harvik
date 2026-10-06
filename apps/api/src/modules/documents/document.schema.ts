import { Schema, type Document as MongooseDocument, type Model, type Types } from 'mongoose';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_SOURCES,
  type DocumentCategory,
  type DocumentSource,
} from '../../config/constants';

export interface FileMetadata {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
}

export interface DocumentDoc extends MongooseDocument {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  category: DocumentCategory;
  title: string;
  file: FileMetadata;
  version: number;
  previousVersionId: Types.ObjectId | null;
  source: DocumentSource;
  templateId: Types.ObjectId | null;
  expiryDate: string | null;
  confidential: boolean;
  uploadedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const fileMetadataSchema = new Schema<FileMetadata>(
  {
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    path: { type: String, required: true },
  },
  { _id: false },
);

export const documentSchema = new Schema<DocumentDoc, Model<DocumentDoc>>(
  {
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: DOCUMENT_CATEGORIES,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    file: {
      type: fileMetadataSchema,
      required: true,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    previousVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'Document',
      default: null,
    },
    source: {
      type: String,
      enum: DOCUMENT_SOURCES,
      required: true,
      default: 'Uploaded',
    },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'DocumentTemplate',
      default: null,
    },
    expiryDate: {
      type: String,
      default: null,
      index: true,
    },
    confidential: {
      type: Boolean,
      default: false,
      index: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

documentSchema.index({ employeeId: 1, category: 1, isDeleted: 1 });
documentSchema.index({ employeeId: 1, previousVersionId: 1 });
