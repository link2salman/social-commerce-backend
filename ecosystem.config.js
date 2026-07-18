// PM2 process config for production (optional). Run:
//   npm run build && pm2 start ecosystem.config.js
// PM2 loads .env.production and runs the compiled server with module-alias so
// the @-path aliases resolve at runtime.
module.exports = {
  apps: [
    {
      name: 'social-commerce-api',
      script: 'dist/server.js',
      node_args: '-r module-alias/register',
      instances: 1, // raise once REDIS_URL is set (socket adapter federates rooms)
      exec_mode: 'fork',
      max_memory_restart: '512M',
      // Must exceed SHUTDOWN_BACKSTOP_MS in server.ts (20s) so graceful shutdown
      // completes before PM2 sends SIGKILL.
      kill_timeout: 25000,
      env_file: '.env.production',
    },
  ],
};
