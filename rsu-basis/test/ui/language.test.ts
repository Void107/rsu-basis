// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../../src/ui/App.js';
import { copy } from '../../src/ui/i18n.js';
import { assertReportClean } from '../../src/report/selfCheckReport.js';

vi.mock('../../src/extraction/pdf/index.js', () => ({ parsePdf: vi.fn(async () => { throw new Error('fixture failure'); }) }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(App)));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent === label);
  expect(button).toBeDefined(); act(() => button!.click());
}
it('defaults to English; switches labels, document metadata and existing results without recomputing', () => {
  expect(document.documentElement.lang).toBe('en');
  expect(document.title).toBe(copy.en.title);
  click(copy.en.demo);
  const values = () => [...container.querySelectorAll('td:nth-child(2)')].map(c => c.textContent);
  const before = values(); expect(before[0]).toBe('5 / 6');
  const enReport = JSON.parse(container.querySelector('pre')!.textContent!);
  assertReportClean(enReport);
  click('中文');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(document.title).toBe(copy.zh.title);
  expect(container.textContent).toContain(copy.zh.download);
  expect(values()).toEqual(before);
  const zhReport = JSON.parse(container.querySelector('pre')!.textContent!);
  assertReportClean(zhReport);
  expect(zhReport.notice).toBe(copy.zh.reportNotice);
  expect({ ...zhReport, notice: '' }).toEqual({ ...enReport, notice: '' });
  click('English'); expect(values()).toEqual(before);
  expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toBe('English');
  act(() => root.unmount()); root = createRoot(container);
  act(() => root.render(createElement(App)));
  expect(document.documentElement.lang).toBe('en');
  expect(container.querySelector('table')).toBeNull();
});
it('translates an existing PDF failure when the language changes', async () => {
  const input = container.querySelector('input')!;
  const file = new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.textContent).toContain(copy.en.readTitle);
  click('中文'); expect(container.textContent).toContain(copy.zh.readTitle);
  expect(container.textContent).not.toContain(copy.en.readTitle);
});
it('shows a localized fallback when the clipboard is unavailable', async () => {
  click(copy.en.demo);
  await act(async () => { click(copy.en.copy); });
  expect(container.textContent).toContain(copy.en.copyFailed);
  click('中文'); expect(container.textContent).toContain(copy.zh.copyFailed);
});
