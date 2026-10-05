import type { Role } from '../config/constants';

/** Identity attached to `req.user` after a verified access token. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: Role;
  employeeId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      /** Populated by `requireAuth`. */
      user?: AuthenticatedUser;
      /** AGENTS.md §11 — every request carries a correlation id. */
      requestId?: string;
    }
  }
}

export {};