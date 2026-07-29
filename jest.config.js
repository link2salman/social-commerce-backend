// Integration-test runner config.
//
// These are NOT unit tests: every test mounts the real Express app
// (`createApp({ disableRateLimit: true })`, see src/app.ts) with supertest and
// talks to a REAL PostgreSQL database. This project is Sequelize/Postgres
// specific — partial unique indexes, `gen_random_uuid()`, TRUNCATE ... CASCADE,
// `SELECT ... FOR UPDATE` in the refresh-rotation transaction — so an in-memory
// sqlite stand-in would test a different system. `tests/globalSetup.ts` creates
// and migrates the test database before the suite runs.
//
// `moduleNameMapper` MIRRORS tsconfig.json `compilerOptions.paths`; keep the two
// in lockstep or an alias resolves in `tsc` but not at runtime.

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/tests'],
  testMatch: ['<rootDir>/tests/**/*.test.ts'],

  globalSetup: '<rootDir>/tests/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/globalTeardown.ts',
  setupFiles: ['<rootDir>/tests/loadEnv.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },

  moduleNameMapper: {
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@constants/(.*)$': '<rootDir>/src/constants/$1',
    '^@controllers/(.*)$': '<rootDir>/src/controllers/$1',
    '^@routes/(.*)$': '<rootDir>/src/routes/$1',
    '^@models/(.*)$': '<rootDir>/src/models/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@middlewares/(.*)$': '<rootDir>/src/middlewares/$1',
    '^@validators/(.*)$': '<rootDir>/src/validators/$1',
    '^@serializers/(.*)$': '<rootDir>/src/serializers/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@seeders/(.*)$': '<rootDir>/src/seeders/$1',
    '^socket$': '<rootDir>/src/socket/index',
    '^socket/(.*)$': '<rootDir>/src/socket/$1',
  },

  // One worker: every test file shares the single Postgres test database and
  // truncates it in `beforeAll` (jest.setup.ts). Parallel workers would truncate
  // each other's fixtures mid-run.
  maxWorkers: 1,

  // The refresh-rotation test deliberately serializes a `FOR UPDATE` transaction,
  // and bcrypt (even at BCRYPT_ROUNDS=4) is not free — 30s beats a flaky 5s.
  testTimeout: 30000,

  // Exit once the run finishes instead of waiting on the event loop to drain.
  // Every test file closes its own Sequelize pool (jest.setup.ts), but supertest
  // binds an ephemeral HTTP server per request and intermittently leaves one
  // listening — the process then sits in kevent forever with all 288 tests
  // already green. Without this, `npm test` looks like a hang (and would burn a
  // CI job's whole timeout) purely as an exit artifact.
  //
  // Caveat: this also masks any future handle leak. If you're chasing one, run
  // `npx jest --runInBand --detectOpenHandles` (which overrides this) to see it.
  forceExit: true,

  clearMocks: true,
  restoreMocks: true,
  verbose: true,

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/seeders/**',
    '!src/types/**',
  ],
};
