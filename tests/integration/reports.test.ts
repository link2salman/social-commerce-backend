import { randomUUID } from 'crypto';
import { api, path } from '../helpers/app';
import { bearer, registerUser, registerUsers, type TestUser } from '../helpers/factories';
import Report from '../../src/models/moderation/Report';
import { MAX_REPORTS_PER_WINDOW } from '../../src/services/reportService';

// The user-facing POST /reports. The admin side (queue + resolution) is covered
// in moderation.test.ts; here the load-bearing behaviour is the anti-spam guard:
// de-dupe of a repeat report, and the rolling-window rate limit.

const report = (
  reporter: TestUser,
  targetType: string,
  targetId: string,
  reason = 'Spam or scam'
) =>
  api()
    .post(path('/reports'))
    .set('Authorization', bearer(reporter))
    .send({ targetType, targetId, reason });

describe('reports (POST /reports)', () => {
  it('accepts a valid report (201)', async () => {
    const [reporter, target] = await registerUsers(2);
    const res = await report(reporter, 'user', target.id);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects an unauthenticated request (401)', async () => {
    const target = await registerUser();
    const res = await api()
      .post(path('/reports'))
      .send({ targetType: 'user', targetId: target.id, reason: 'Spam or scam' });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed body (400)', async () => {
    const reporter = await registerUser();
    // Bad target type.
    expect((await report(reporter, 'planet', randomUUID())).status).toBe(400);
    // Non-uuid target id.
    expect((await report(reporter, 'user', 'not-a-uuid')).status).toBe(400);
    // Empty reason.
    expect((await report(reporter, 'user', randomUUID(), '')).status).toBe(400);
  });

  it('de-dupes a repeat report against the same pending target (no second row)', async () => {
    const [reporter, target] = await registerUsers(2);
    expect((await report(reporter, 'user', target.id)).status).toBe(201);
    // Same reporter, same target again — still a clean 201, but no new row.
    expect((await report(reporter, 'user', target.id, 'False information')).status).toBe(201);

    const count = await Report.count({
      where: { reporter_id: reporter.id, target_type: 'user', target_id: target.id },
    });
    expect(count).toBe(1);
  });

  it('rate-limits a user past the window budget (429)', async () => {
    const reporter = await registerUser();
    // Distinct targets so the de-dupe guard never fires — each is a fresh report.
    for (let i = 0; i < MAX_REPORTS_PER_WINDOW; i += 1) {
      const res = await report(reporter, 'user', randomUUID());
      expect(res.status).toBe(201);
    }
    // One past the budget → 429.
    const over = await report(reporter, 'user', randomUUID());
    expect(over.status).toBe(429);
  });
});
