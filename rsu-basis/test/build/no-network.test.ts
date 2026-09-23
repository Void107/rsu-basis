// CI 断言 ①：构建产物中第三方网络请求数为 0。
//
// 「第三方网络请求数 = 0」的可执行定义分两层，都必须成立：
//   A. 产物不【引用】任何外部资源：没有指向 http(s):// 或协议相对 // 的
//      script/link/img/font/@import/url()，也没有外链 sourcemap。
//      → 双击打开时浏览器不会去取任何东西。
//   B. 我们自己的源码不【调用】任何网络 API（fetch/XHR/WebSocket/sendBeacon）。
//      → 加上 CSP connect-src 'none' 由浏览器强制兜底。
//
// 为什么不直接 grep 产物里的 "fetch("：pdfjs / exceljs 等第三方库内部带有走不到的
// fetch/XHR 代码路径（例如 pdfjs 取 cMapUrl）。对它们做字符串断言只会得到假警报。
// 真正的保证是 A（没有外部引用）+ B（我们不调用）+ CSP（浏览器强制）。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIST = join(ROOT, 'dist', 'index.html');

const html = (): string => {
  if (!existsSync(DIST)) {
    throw new Error('dist/index.html 不存在：请先运行 `npm run build`（CI 中 build 必须先于 test）');
  }
  return readFileSync(DIST, 'utf8');
};

/** 去掉 // 与 /* *\/ 注释，避免把注释里的字眼当成 API 调用。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

describe('CI 断言 ① 构建产物零第三方网络请求', () => {
  it('产物是单个自包含 HTML（无外链 JS/CSS 资源文件）', () => {
    const distDir = join(ROOT, 'dist');
    const files = readdirSync(distDir);
    expect(files).toEqual(['index.html']); // 只有一个文件，说明全部内联
  });

  it('A. 产物中没有任何指向外部的资源引用', () => {
    const h = html();
    const patterns: [string, RegExp][] = [
      ['script src → 外部', /<script[^>]+src\s*=\s*["'](?!data:)[^"']*["']/gi],
      ['link href → 外部', /<link[^>]+href\s*=\s*["'](?:https?:)?\/\/[^"']*["']/gi],
      ['img/src → 外部', /<img[^>]+src\s*=\s*["'](?:https?:)?\/\/[^"']*["']/gi],
      ['@import → 外部', /@import[^;]*(?:https?:)?\/\/[^;]*/gi],
      ['css url() → 外部', /url\(\s*["']?(?:https?:)?\/\/[^)]*\)/gi],
      ['外链 sourcemap', /sourceMappingURL\s*=\s*(?!data:)\S+/gi],
    ];
    const found: string[] = [];
    for (const [label, re] of patterns) {
      const m = h.match(re);
      if (m) found.push(`${label}: ${m.slice(0, 3).join(' | ')}`);
    }
    expect(found, `产物引用了外部资源:\n${found.join('\n')}`).toEqual([]);
  });

  it('CSP 存在且 connect-src 为 none（浏览器强制兜底）', () => {
    const h = html();
    // content 属性里含单引号（'none' / 'self'），因此只按双引号定界抓取
    const csp = /<meta[^>]+http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i.exec(h);
    expect(csp, '缺少 CSP meta').not.toBeNull();
    const policy = csp![1]!;
    expect(policy).toMatch(/connect-src\s+'none'/);
    expect(policy).toMatch(/object-src\s+'none'/);
    expect(policy).toMatch(/form-action\s+'none'/); // 杜绝表单外发
  });

  it('B. 我们自己的源码不调用任何网络 API', () => {
    const offenders: string[] = [];
    const banned: [string, RegExp][] = [
      ['fetch(', /\bfetch\s*\(/],
      ['XMLHttpRequest', /\bXMLHttpRequest\b/],
      ['WebSocket', /\bnew\s+WebSocket\b/],
      ['sendBeacon', /\bsendBeacon\s*\(/],
      ['EventSource', /\bnew\s+EventSource\b/],
      ['importScripts', /\bimportScripts\s*\(/],
    ];
    for (const file of walkTs(join(ROOT, 'src'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [label, re] of banned) {
        if (re.test(code)) offenders.push(`${file.replace(ROOT + '/', '')}: ${label}`);
      }
    }
    expect(offenders, `源码调用了网络 API:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('产物不含 http(s) 形式的第三方 CDN 主机名', () => {
    const h = html();
    const hosts = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'ajax.googleapis.com'];
    const hit = hosts.filter((x) => h.includes(x));
    expect(hit, `产物引用了 CDN: ${hit.join(', ')}`).toEqual([]);
  });
});
