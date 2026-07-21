import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '.claude/**',
      'tools/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue']
      }
    }
  },
  {
    // Domain-module dependency rules (Requirements section 32.1). A module may not
    // reach into another module's internals; it goes through that module's index.
    files: ['apps/api/src/modules/*/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/**'],
              message:
                'Cross-module imports must use the other module public index (src/modules/<name>/index.ts). Never read another module collections directly.'
            }
          ]
        }
      ]
    }
  },
  {
    // The shared kernel is depended on by modules and must not depend on them.
    files: ['apps/api/src/shared/**', 'apps/api/src/http/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/**'],
              message: 'The shared kernel must not depend on a domain module.'
            }
          ]
        }
      ]
    }
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      // Allow `const { drop, ...keep } = x` to omit a field, and `_`-prefixed throwaways.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always']
    }
  },
  {
    // Node-only tooling: build scripts, config files, and the persistence check.
    files: ['scripts/**/*.mjs', '**/*.config.{ts,mjs}', 'apps/api/src/migrate.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' }
    },
    rules: { 'no-console': 'off' }
  }
);
