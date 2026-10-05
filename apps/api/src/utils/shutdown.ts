import { logger } from './logger';

export const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * AGENTS.md §11 — graceful shutdown. Runs `tasks` in order on SIGTERM/SIGINT
 * and force-exits if the budget is exceeded, so the container never hangs and
 * never half-finishes a teardown.
 */
export function onShutdown(
  tasks: ReadonlyArray<() => Promise<unknown>>,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
): (signal: string) => Promise<void> {
  let inProgress = false;

  return async (signal: string): Promise<void> => {
    if (inProgress) return;
    inProgress = true;

    logger.info({ signal }, 'Shutdown started');

    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, 'Shutdown timed out, forcing exit');
      process.exit(1);
    }, timeoutMs);
    timer.unref();

    try {
      for (const task of tasks) await task();
      logger.info('Shutdown complete');
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'Shutdown step failed');
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Log-and-exit handlers so a crash is visible in the container logs. */
export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    logger.error(
      { err: reason instanceof Error ? reason.message : String(reason) },
      'Unhandled promise rejection',
    );
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error.message, stack: error.stack }, 'Uncaught exception');
    process.exit(1);
  });
}