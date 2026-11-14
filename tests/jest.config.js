/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.(e2e-spec|chaos-spec|spec)\\.ts$',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@repo/dtos$': '<rootDir>/../packages/dtos/dist/index.js',
    '^@repo/common$': '<rootDir>/../packages/common/dist/index.js',
  },
  verbose: true,
  testTimeout: 30000,
};
