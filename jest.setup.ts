// Per-test-file lifecycle (jest `setupFilesAfterEnv`).
//
// Jest gives every test file a fresh module registry, so each file builds its
// own Sequelize instance (and pool) when it first imports @config/db. Truncate
// on the way in so a file always starts from an empty schema regardless of what
// ran before it, and close the pool on the way out so Jest exits without
// "open handle" warnings.
import { sequelize } from '@config/db';
import { truncateAll } from './tests/helpers/db';

beforeAll(async () => {
  await truncateAll();
});

afterAll(async () => {
  await sequelize.close();
});
