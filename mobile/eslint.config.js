// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // scripts/ is Node tooling run via tsx, outside the app lint surface.
    ignores: ['dist/*', '.expo/*', 'scripts/*'],
  },
]);
