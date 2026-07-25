/**
 * Low-level native-PDF text extraction via pdfjs-dist. Returns positioned text
 * runs per page in TOP-LEFT point coordinates (origin top-left), which the
 * adapter then normalizes to 0..1. This is the only place we touch pdfjs.
 */

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

/** Cheap text-layer probe: mean extractable chars per page. Low ⇒ scanned. */
export async function meanCharsPerPage(bytes: Buffer): Promise<number> {
  const pages = await loadPdfPages(bytes);
  if (pages.length === 0) return 0;
  const total = pages.reduce((sum, pg) => sum + pg.runs.reduce((s, r) => s + r.str.length, 0), 0);
  return total / pages.length;
}
