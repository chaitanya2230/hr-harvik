import { model, models, type Model } from 'mongoose';
import { departmentSchema, type DepartmentDoc } from './department.schema';

export const Department: Model<DepartmentDoc> =
  (models.Department as Model<DepartmentDoc> | undefined) ??
  model<DepartmentDoc>('Department', departmentSchema);