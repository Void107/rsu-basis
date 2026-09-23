// 最小类型声明：pdfjs-dist 的 legacy 子路径不带完整 .d.ts，这里只声明本层用到的表面。
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export interface PdfTextItem {
    str: string;
    transform: number[];
    width: number;
    height: number;
  }
  export interface PdfPage {
    getViewport(opts: { scale: number }): { width: number; height: number };
    getTextContent(): Promise<{ items: unknown[] }>;
    cleanup(): void;
  }
  export interface PdfDocument {
    numPages: number;
    getPage(n: number): Promise<PdfPage>;
    destroy(): Promise<void>;
  }
  export function getDocument(opts: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
  }): { promise: Promise<PdfDocument> };
  export const version: string;
}
