import { model, models, type Model } from 'mongoose';
import { employeeSchema, type EmployeeDoc } from './employee.schema';

export const Employee: Model<EmployeeDoc> =
  (models.Employee as Model<EmployeeDoc> | undefined) ??
  model<EmployeeDoc>('Employee', employeeSchema);