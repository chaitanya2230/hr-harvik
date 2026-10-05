import { Schema } from 'mongoose';

/**
 * AGENTS.md §7 — "Human-readable IDs must be generated atomically through a
 * counters collection". One document per entity kind, incremented with $inc.
 */
export interface CounterDoc {
  _id: string;
  seq: number;
  createdAt: Date;
  updatedAt: Date;
}

export const counterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0, min: 0 },
  },
  {
    timestamps: true,
    collection: 'counters',
    versionKey: false,
  },
);