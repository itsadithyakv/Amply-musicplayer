import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', '*.config.*'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name=/^__AMP_/]",
          message: 'Use runtimeFlags instead of window.__AMP_* globals.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Use storageService preferences instead of raw localStorage.' },
      ],
    },
  },
  {
    files: ['src/services/storageService.ts', 'src/services/preferences.ts', 'src/services/perfDiagnostics.ts', 'src/hooks/useThemeSync.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-syntax': 'off' },
  },
);
