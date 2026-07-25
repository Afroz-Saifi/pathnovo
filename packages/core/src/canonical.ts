import { z } from "zod";

/**
 * The canonical representation — the format-agnostic intermediate model every
 * ingestion adapter normalizes into. The delta engine, report, chat, and eval
 * read ONLY this model, so a new source format is one new adapter and nothing
 * downstream changes.
 *
 * Coordinate convention: all bounding boxes are NORMALIZED to 0..1 with the
 * origin at the top-left of the sheet. A 300-DPI scan and an 842-pt vector
 * sheet therefore land in the same coordinate space, which is what makes a
 * native revision comparable to a scanned one.
 */

export const SOURCE_FORMATS = ["pdf-native", "pdf-scanned", "dwg"] as const;
export const SourceFormatSchema = z.enum(SOURCE_FORMATS);
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

/**
 * Item kinds. Classified deterministically by the adapters (regex/heuristics
 * tuned on the seed P&IDs). Typed kinds give the delta engine stable anchors
 * and give chat domain vocabulary.
 */
export const ITEM_KINDS = [
  "text",
  "tag",
  "line_spec",
  "note",
  "dimension",
  "table_cell",
  "symbol",
] as const;
export const ItemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = (typeof ITEM_KINDS)[number];

export const EXTRACTORS = ["pdfjs", "tesseract", "vision-assist", "dxf"] as const;
export const ExtractorSchema = z.enum(EXTRACTORS);
export type Extractor = (typeof EXTRACTORS)[number];

/** Normalized bounding box (0..1, origin top-left). */
export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type BBox = z.infer<typeof BBoxSchema>;

export const ContentItemSchema = z.object({
  /** Stable within a document: sha1(sheet, kind, text, quantized bbox). */
  id: z.string(),
  kind: ItemKindSchema,
  /** Normalized text (whitespace + case rules applied per kind). */
  text: z.string(),
  bbox: BBoxSchema,
  rotation: z.number().optional(),
  /** 1.0 for born-digital text; OCR word confidence for scans. Carried, never invented. */
  confidence: z.number().min(0).max(1),
  source: z.object({
    extractor: ExtractorSchema,
    raw: z.unknown().optional(),
  }),
  /** Parsed structure, e.g. a tag split into { area, type, num }. */
  attrs: z.record(z.union([z.string(), z.number()])).optional(),
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

export const SheetSchema = z.object({
  /** 0-based. */
  index: z.number().int().nonnegative(),
  title: z.string().optional(),
  size: z.object({
    w: z.number().positive(),
    h: z.number().positive(),
    units: z.enum(["pt", "px"]),
  }),
  items: z.array(ContentItemSchema),
});
export type Sheet = z.infer<typeof SheetSchema>;

export const ExtractionWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  sheet: z.number().int().nonnegative().optional(),
});
export type ExtractionWarning = z.infer<typeof ExtractionWarningSchema>;

export const CanonicalDocumentSchema = z.object({
  /** The identifier we resolved to bytes + metadata. */
  pid: z.string(),
  sourceFormat: SourceFormatSchema,
  revisionLabel: z.string().optional(),
  sheets: z.array(SheetSchema),
  extraction: z.object({
    adapter: z.string(),
    version: z.string(),
    warnings: z.array(ExtractionWarningSchema),
  }),
});
export type CanonicalDocument = z.infer<typeof CanonicalDocumentSchema>;

/** Center point of a bbox, in normalized coords. */
export function bboxCenter(b: BBox): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
