// P4 单文件自包含 HTML 打包。
//
// 目标：双击一个 .html 就能跑，断网可用，构建产物中【第三方网络请求数 = 0】。
// 因此：
//   - vite-plugin-singlefile 把 JS/CSS 全部内联进 HTML，不产生任何外部资源引用
//   - assetsInlineLimit 拉到极大 + cssCodeSplit=false，杜绝拆出独立资源文件
//   - 不使用任何 CDN、Google Fonts、外部 sourcemap
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  define: {
    // 版本号编译期注入，避免运行时读取任何外部信息
    __APP_VERSION__: JSON.stringify('0.4.0'),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    // 单文件：不拆 chunk、不外链 css、资源全内联
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
