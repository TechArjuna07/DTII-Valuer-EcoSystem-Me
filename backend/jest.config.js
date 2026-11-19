/**
 * Unit tests run without external services. Integration tests use the *_test PostgreSQL database
 * (migrated in globalSetup) and a separate Redis DB index (REDIS_TEST_DB).
 */
export default {
  testEnvironment: 'node',
  transform: {},
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform: {},
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
      setupFiles: ['<rootDir>/tests/setup-env.js'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      transform: {},
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      setupFiles: ['<rootDir>/tests/setup-env.js'],
      globalSetup: '<rootDir>/tests/global-setup.js',
    },
  ],
};
