/**
 * Low-level native-PDF text extraction via pdfjs-dist. Returns positioned text
 * runs per page in TOP-LEFT point coordinates (origin top-left), which the
 * adapter then normalizes to 0..1. This is the only place we touch pdfjs.
 */

import { createCanvas } from "@napi-rs/canvas";
// The legacy build is the Node-friendly entry (no browser worker needed).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface RawTextRun {
  str: string;
  /** Top-left point coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RawPage {
  width: number;
  height: number;
  runs: RawTextRun[];
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export async function loadPdfPages(bytes: Buffer): Promise<RawPage[]> {
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    // Keep pdfjs quiet and worker-free in Node.
    useSystemFonts: true,
  }).promise;

  const pages: RawPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    const content = await page.getTextContent();

    const runs: RawTextRun[] = [];
    for (const raw of content.items as PdfTextItem[]) {
      if (!("str" in raw) || raw.str.trim() === "") continue;
      const t = raw.transform;
      const x = t[4] ?? 0;
      const baselineY = t[5] ?? 0;
      const h = raw.height || Math.hypot(t[2] ?? 0, t[3] ?? 0) || 1;
      const w = raw.width || raw.str.length * h * 0.5;
      // PDF origin is bottom-left; convert the text top to a top-left origin.
      const yTop = pageHeight - (baselineY + h);
      runs.push({ str: raw.str, x, y: yTop, w, h });
    }
    pages.push({ width: viewport.width, height: viewport.height, runs });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

export interface RenderedPage {
  png: Buffer;
  width: number;
  height: number;
}

/** Rasterize every page to a PNG at the given DPI (input to OCR). */
export async function renderPdfToImages(bytes: Buffer, dpi: number): Promise<RenderedPage[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const out: RenderedPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx as never, viewport }).promise;
    out.push({ png: canvas.toBuffer("image/png"), width: canvas.width, height: canvas.height });
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

export interface RenderedPixels {
  /** Per-pixel darkness 0..1 (1 = full ink), row-major, width*height. */
  darkness: Float32Array;
  width: number;
  height: number;
}

/** Rasterize pages to a per-pixel darkness map (for geometry diffing). */
export async function renderPdfToPixels(bytes: Buffer, dpi: number): Promise<RenderedPixels[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const out: RenderedPixels[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx as never, viewport }).promise;
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const darkness = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = rgba[i * 4]!;
      const g = rgba[i * 4 + 1]!;
      const b = rgba[i * 4 + 2]!;
      // Perceived luminance → darkness.
      darkness[i] = 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    out.push({ darkness, width: w, height: h });
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

/** Cheap text-layer probe: mean extractable chars per page. Low ⇒ scanned. */
export async function meanCharsPerPage(bytes: Buffer): Promise<number> {
  const pages = await loadPdfPages(bytes);
  if (pages.length === 0) return 0;
  const total = pages.reduce((sum, pg) => sum + pg.runs.reduce((s, r) => s + r.str.length, 0), 0);
  return total / pages.length;
}
