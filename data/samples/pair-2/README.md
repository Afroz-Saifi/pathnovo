# pair-2 — native ↔ scanned

Same manifest and injected changes as pair-1, but rev B is rasterized to an
image-only PDF (no text layer), so ingesting it exercises the OCR adapter
(tesseract.js). Ground truth is identical to pair-1; the scanned path shows
how OCR noise affects delta metrics vs the native/native case.

Regenerate: `pnpm tsx scripts/synthesize-pairs.ts`
