// Runs ONCE after the whole suite. Each test file closes its own Sequelize pool
// in `afterAll` (jest.setup.ts); the test database itself is deliberately LEFT
// IN PLACE so a failing run can be inspected, and so the next run skips the
// create+migrate cost. `beforeAll` truncates, so stale rows never leak forward.
export default async function globalTeardown(): Promise<void> {
  // Nothing to release here today. Kept as an explicit hook so the lifecycle is
  // visible next to globalSetup rather than implied by its absence.
}
