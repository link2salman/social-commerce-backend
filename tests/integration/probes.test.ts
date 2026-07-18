import { api, path } from '../helpers/app';

// The two probes plus the catch-all. They are the cheapest possible proof that
// the app factory mounts, the DB is reachable, and unknown routes fall through
// to the error middleware rather than Express's HTML 404 page.
describe('probes and routing', () => {
  it('GET /live reports liveness without touching a dependency', async () => {
    const res = await api().get('/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('GET /health reports readiness with the database check passing', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toBe('ok');
    // Redis is optional; unset REDIS_URL must read as skipped, not as an error.
    expect(res.body.checks.redis).toBe('skipped');
  });

  it('an unknown route returns a JSON 404 from the error middleware', async () => {
    const res = await api().get(path('/definitely-not-a-route'));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: expect.stringContaining('not found') });
  });
});
