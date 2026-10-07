import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { getReport, exportReport, getExportJob } from './report.controller';

export const reportRouter = Router();

reportRouter.use(requireAuth);

reportRouter.get('/exports/:jobId', getExportJob);
reportRouter.get('/:type/export', exportReport);
reportRouter.get('/:type', getReport);
