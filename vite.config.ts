import { defineConfig } from 'vite';

// 산출물은 scripts/inline-build.mjs가 index.html 하나로 합친다(file:// 실행, 해시 CSP).
export default defineConfig({
  base: './',
  publicDir: false,
  server: { host: '127.0.0.1' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
  },
});
