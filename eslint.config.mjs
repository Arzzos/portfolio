import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', '.astro/', 'node_modules/'] },
  ...tseslint.configs.recommended,
  {
    files: ['worker.js', 'astro.config.mjs', 'eslint.config.mjs'],
    languageOptions: { sourceType: 'module' },
  },
);
