import { Router } from 'express';
import { asyncHandler } from '../../utils/http';
import { health, ready } from './health.controller';

/** Mounted at `/health`. */
export const healthRouter = Router();
healthRouter.get('/', asyncHandler(health));

/** Mounted at `/ready`. */
export const readyRouter = Router();
readyRouter.get('/', asyncHandler(ready));