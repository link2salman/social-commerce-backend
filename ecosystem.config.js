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
    {
      // Media worker: drains the media_jobs queue (clip transcodes). A separate
      // process because ffmpeg pins a core and Node is single-threaded — sharing
      // the API's process would stall every request for the length of a clip.
      // See src/worker.ts.
      name: 'social-commerce-media-worker',
      script: 'dist/worker.js',
      node_args: '-r module-alias/register',
      // Never more than one: `requeueOrphaned` reclaims any 'running' job at
      // startup with no age threshold, so a second instance booting would yank a
      // live job out from under the first. The queue itself is safe for N workers
      // (FOR UPDATE SKIP LOCKED); scaling up means fixing that reclaim first.
      instances: 1,
      exec_mode: 'fork',
      // Higher than the API's: a decode holds whole frames in memory, and the
      // clip's bytes are buffered in-process on the way in and out.
      max_memory_restart: '1G',
      // Long enough for an in-flight transcode to finish on SIGTERM rather than
      // being killed and retried (TRANSCODE_TIMEOUT_MS is the real ceiling).
      kill_timeout: 60000,
      env_file: '.env.production',
    },
  ],
};
