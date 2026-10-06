import { Schema, type Document as MongooseDocument, type Model, type Types } from 'mongoose';

export interface HolidayDoc extends MongooseDocument {
  _id: Types.ObjectId;
  date: string;
  name: string;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const holidaySchema = new Schema<HolidayDoc, Model<HolidayDoc>>(
  {
    date: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
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
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);
