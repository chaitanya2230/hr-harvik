import { Schema, type Document as MongooseDocument, type Model, type Types } from 'mongoose';
import {
  DOCUMENT_CATEGORIES,
  EMPLOYMENT_TYPES,
  type DocumentCategory,
  type EmploymentType,
} from '../../config/constants';

export interface DocumentTemplateDoc extends MongooseDocument {
  _id: Types.ObjectId;
  name: string;
  category: DocumentCategory;
  applicableEmploymentTypes: EmploymentType[];
  bodyHtml: string;
  isActive: boolean;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const documentTemplateSchema = new Schema<
  DocumentTemplateDoc,
  Model<DocumentTemplateDoc>
>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    category: {
      type: String,
      enum: DOCUMENT_CATEGORIES,
      required: true,
      index: true,
    },
    applicableEmploymentTypes: {
      type: [String],
      enum: EMPLOYMENT_TYPES,
      required: true,
      default: [],
    },
    bodyHtml: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
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
