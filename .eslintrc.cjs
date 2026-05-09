module.exports = {
  root: true,
  env: {
    node: true,
    es2024: true,
  },
  extends: ['airbnb-base'],
  parserOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
  },
  rules: {
    'import/extensions': ['error', 'ignorePackages'],
    'import/prefer-default-export': 'off',
    'no-console': 'off',
    'no-restricted-syntax': 'off',
    'no-await-in-loop': 'off',
  },
};
