import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls: false } }), vueJsx()],
  test: { include: ['src/**/*.test.{ts,tsx}', 'scripts/*.perf.test.tsx'], exclude: ['tmp/**'] },
});
