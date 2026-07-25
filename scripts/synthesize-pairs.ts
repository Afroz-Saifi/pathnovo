import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * Synthesize a sample revision pair from a controlled manifest and emit its
 * ground truth from the SAME manifest — so the labels are exact by construction
 * (no post-hoc labeling error). Both revisions are real, re-ingestable PDFs.
 *
 * pair-1 exercises every change type: add, remove, modify (text) and modify
 * (moved). The eval harness (later slice) scores against expected-delta.json.
 */

const PAGE = { w: 1191, h: 842 }; // A3 landscape, matching the real seed P&IDs

type Kind = "tag" | "line_spec" | "note" | "dimension";
interface Item {
  id: string;
  text: string;
  kind: Kind;
  x: number; // points, from left
  y: number; // points, from top
}

const SIZE: Record<Kind, number> = { tag: 12, line_spec: 11, note: 11, dimension: 11 };

// ── Revision A: the base drawing ──────────────────────────────────────────
const revA: Item[] = [
  { id: "t1", text: "26-KA-9023", kind: "tag", x: 120, y: 90 },
  { id: "t2", text: "26-CX-9021", kind: "tag", x: 120, y: 150 },
  { id: "t3", text: "26-PY-9087A", kind: "tag", x: 120, y: 210 },
  { id: "t4", text: "26-PV-9020", kind: "tag", x: 120, y: 270 },
  { id: "i1", text: "PIT 9016", kind: "tag", x: 120, y: 330 },
  { id: "i2", text: "TIT 9025", kind: "tag", x: 120, y: 390 },
  { id: "l1", text: '4"-PV-26-9020-FC11S-38', kind: "line_spec", x: 460, y: 90 },
  { id: "l2", text: '3/4"-DC-57-9005-FC11S-00', kind: "line_spec", x: 460, y: 150 },
  { id: "l3", text: '2"-VF-43-9008-AS20S-00', kind: "line_spec", x: 460, y: 210 },
  { id: "l4", text: '10"-VF-43-9007-AS20S-00', kind: "line_spec", x: 460, y: 270 },
  { id: "l5", text: '8"-PV-26-9007-FC11S-08', kind: "line_spec", x: 460, y: 330 },
  { id: "n1", text: "NOTE 16", kind: "note", x: 880, y: 90 },
  { id: "n2", text: "NOTE 18", kind: "note", x: 880, y: 150 },
  { id: "n3", text: "NOTE 20", kind: "note", x: 880, y: 210 },
  { id: "d1", text: '4"X8"', kind: "dimension", x: 880, y: 270 },
  { id: "d2", text: '3"X6"', kind: "dimension", x: 880, y: 330 },
];

// ── Non-text shapes (symbols/valves) to exercise the geometry diff ─────────
interface Shape {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const shapesA: Shape[] = [
  { id: "s1", x: 300, y: 560, w: 44, h: 26 },
  { id: "s2", x: 500, y: 560, w: 44, h: 26 },
  { id: "s3", x: 700, y: 560, w: 44, h: 26 },
];
function makeShapesB(a: Shape[]): Shape[] {
  const b = a
    .filter((s) => s.id !== "s2") // remove one symbol
    .map((s) => (s.id === "s1" ? { ...s, x: s.x + 160 } : s)); // move one symbol
  b.push({ id: "s4", x: 880, y: 560, w: 44, h: 26 }); // add one symbol
  return b;
}

// ── Revision B: apply controlled edits ────────────────────────────────────
function makeRevB(a: Item[]): Item[] {
  const remove = new Set(["n3", "l3"]); // remove NOTE 20 and the 2" line
  const b = a
    .filter((it) => !remove.has(it.id))
    .map((it) => {
      if (it.id === "l1") return { ...it, text: '6"-PV-26-9020-FC11S-38' }; // modify text
      if (it.id === "t2") return { ...it, x: it.x + 90 }; // move 26-CX-9021
      return { ...it };
    });
  b.push({ id: "new1", text: "26-PV-9099", kind: "tag", x: 120, y: 450 });
  b.push({ id: "new2", text: "NOTE 45", kind: "note", x: 880, y: 390 });
  return b;
}

async function drawPid(items: Item[], shapes: Shape[] = []): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE.w, PAGE.h]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const it of items) {
    const size = SIZE[it.kind];
    page.drawText(it.text, { x: it.x, y: PAGE.h - it.y - size, size, font });
  }
  for (const s of shapes) {
    page.drawRectangle({
      x: s.x,
      y: PAGE.h - s.y - s.h,
      width: s.w,
      height: s.h,
      borderColor: rgb(0, 0, 0),
      borderWidth: 2,
    });
  }
  return pdf.save();
}

/** Render the manifest onto a raster image (a synthetic "scan"). */
function drawScanPng(items: Item[]): Buffer {
  const scale = 2;
  const canvas = createCanvas(PAGE.w * scale, PAGE.h * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  for (const it of items) {
    const size = SIZE[it.kind] * scale;
    ctx.font = `${size}px Helvetica`;
    ctx.fillText(it.text, it.x * scale, (it.y + SIZE[it.kind]) * scale);
  }
  return canvas.toBuffer("image/png");
}

/** Wrap a raster page in an image-only PDF (no text layer) — detected as scanned. */
async function makeScannedPdf(items: Item[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE.w, PAGE.h]);
  const img = await pdf.embedPng(drawScanPng(items));
  page.drawImage(img, { x: 0, y: 0, width: PAGE.w, height: PAGE.h });
  return pdf.save();
}

const MOVE_EPS = 0.008 * PAGE.w;

/** Ground truth from the manifest diff — exact by construction. */
function groundTruth(a: Item[], b: Item[]) {
  const aById = new Map(a.map((i) => [i.id, i]));
  const bById = new Map(b.map((i) => [i.id, i]));
  const entries: Array<Record<string, string>> = [];
  for (const it of a) {
    if (!bById.has(it.id)) entries.push({ changeType: "removed", itemKind: it.kind, textA: it.text });
  }
  for (const it of b) {
    const prev = aById.get(it.id);
    if (!prev) {
      entries.push({ changeType: "added", itemKind: it.kind, textB: it.text });
    } else if (prev.text !== it.text) {
      entries.push({ changeType: "modified", modifyKind: "text", itemKind: it.kind, textA: prev.text, textB: it.text });
    } else if (Math.abs(prev.x - it.x) > MOVE_EPS || Math.abs(prev.y - it.y) > MOVE_EPS) {
      entries.push({ changeType: "modified", modifyKind: "moved", itemKind: it.kind, textA: prev.text });
    }
  }
  return entries;
}

async function main() {
  const revB = makeRevB(revA);
  const shapesB = makeShapesB(shapesA);
  const dir = resolve("data/samples/pair-1");
  mkdirSync(dir, { recursive: true });

  writeFileSync(resolve(dir, "revA.pdf"), await drawPid(revA, shapesA));
  writeFileSync(resolve(dir, "revB.pdf"), await drawPid(revB, shapesB));

  const expected = groundTruth(revA, revB);
  writeFileSync(resolve(dir, "expected-delta.json"), JSON.stringify(expected, null, 2));

  const provenance = `# pair-1 — synthetic controlled pair

Both PDFs are generated by \`scripts/synthesize-pairs.ts\` from a labeled manifest.
A3 landscape, native text layer. Ground truth (\`expected-delta.json\`) is emitted
from the same manifest diff, so labels are exact by construction.

Injected changes (rev A → rev B):
- added:    26-PV-9099 (tag), NOTE 45 (note)
- removed:  NOTE 20 (note), 2"-VF-43-9008-AS20S-00 (line)
- modified: 4"-PV-26-9020-FC11S-38 → 6"-... (text); 26-CX-9021 (moved)

Regenerate: \`pnpm tsx scripts/synthesize-pairs.ts\`
`;
  writeFileSync(resolve(dir, "README.md"), provenance);
  console.log(`wrote ${dir}/revA.pdf, revB.pdf, expected-delta.json (${expected.length} entries)`);

  // pair-2 — native rev A vs a rasterized (scanned) rev B, exercising OCR.
  const dir2 = resolve("data/samples/pair-2");
  mkdirSync(dir2, { recursive: true });
  writeFileSync(resolve(dir2, "revA.pdf"), await drawPid(revA));
  writeFileSync(resolve(dir2, "revB-scanned.pdf"), await makeScannedPdf(revB));
  writeFileSync(resolve(dir2, "expected-delta.json"), JSON.stringify(expected, null, 2));
  writeFileSync(
    resolve(dir2, "README.md"),
    `# pair-2 — native ↔ scanned

Same manifest and injected changes as pair-1, but rev B is rasterized to an
image-only PDF (no text layer), so ingesting it exercises the OCR adapter
(tesseract.js). Ground truth is identical to pair-1; the scanned path shows
how OCR noise affects delta metrics vs the native/native case.

Regenerate: \`pnpm tsx scripts/synthesize-pairs.ts\`
`,
  );
  console.log(`wrote ${dir2}/revA.pdf, revB-scanned.pdf, expected-delta.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
