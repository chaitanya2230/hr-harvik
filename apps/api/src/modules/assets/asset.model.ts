import { model, models, type Model } from 'mongoose';
import {
  assetSchema,
  assetAssignmentSchema,
  type AssetAssignmentDoc,
  type AssetDoc,
} from './asset.schema';

export const Asset: Model<AssetDoc> =
  (models.Asset as Model<AssetDoc> | undefined) ?? model<AssetDoc>('Asset', assetSchema);

export const AssetAssignment: Model<AssetAssignmentDoc> =
  (models.AssetAssignment as Model<AssetAssignmentDoc> | undefined) ??
  model<AssetAssignmentDoc>('AssetAssignment', assetAssignmentSchema);
