/**
 * PM2 process definition (AGENTS.md §4 — deploy/ecosystem.config.js).
 *
 * Runs the compiled API and the BullMQ worker from a single PM2 instance,
 * which is how a single-host deployment is expected to run:
 *
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save && pm2 startup
 *
 * Docker Compose is the primary path (AGENTS.md §2.12); this file exists for
 * bare-metal/VM deployments. Both processes read the same .env, so the refresh
 * token secret and FIELD_ENCRYPTION_KEY stay consistent across API and worker.
 */
module.exports = {
  apps: [
    {
      name: 'harvik-hr-api',
      script: 'apps/api/dist/server.js',
      cwd: __dirname + '/..',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      // Uploads live on a mounted volume and must be present before boot.
      wait_ready: false,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/api-error.log',
      out_file: 'logs/api-out.log',
      merge_logs: true,
      kill_timeout: 10000,
      max_memory_restart: '512M',
    },
    {
      name: 'harvik-hr-worker',
      script: 'apps/api/dist/worker.js',
      cwd: __dirname + '/..',
      instances: 1,
      // BullMQ must run as a single process; scaling it requires SHARDING_ENABLED.
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/worker-error.log',
      out_file: 'logs/worker-out.log',
      merge_logs: true,
      kill_timeout: 30000,
      max_memory_restart: '512M',
    },
  ],
};