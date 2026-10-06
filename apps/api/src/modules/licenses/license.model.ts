import { model, models, type Model } from 'mongoose';
import {
  licenseSchema,
  licenseAssignmentSchema,
  type LicenseAssignmentDoc,
  type LicenseDoc,
} from './license.schema';

export const License: Model<LicenseDoc> =
  (models.License as Model<LicenseDoc> | undefined) ??
  model<LicenseDoc>('License', licenseSchema);

export const LicenseAssignment: Model<LicenseAssignmentDoc> =
  (models.LicenseAssignment as Model<LicenseAssignmentDoc> | undefined) ??
  model<LicenseAssignmentDoc>('LicenseAssignment', licenseAssignmentSchema);
