import type { CanonicalDocument } from "@pathnovo/core";

import {
  UnsupportedFormatError,
  type FormatAdapter,
  type IngestContext,
} from "./format-adapter.js";

/**
 * DWG seam — a real stub. Detection is genuine (AutoCAD files begin with an
 * "AC10xx" version tag); parsing needs ODA/LibreDWG-class tooling out of scope
 * for the window, so it raises a typed, traceable error with a conversion hint.
 * The seam is real; only the parse is stubbed.
 */
export class DwgAdapter implements FormatAdapter {
  readonly id = "dwg" as const;

  async detect(bytes: Buffer): Promise<number> {
    const magic = bytes.subarray(0, 6).toString("latin1");
    return /^AC10\d\d$/.test(magic) ? 1 : 0;
  }

  async extract(_bytes: Buffer, _ctx: IngestContext): Promise<CanonicalDocument> {
    throw new UnsupportedFormatError(
      "dwg",
      "binary CAD format; convert to DXF (ODA File Converter / LibreDWG) to ingest",
    );
  }
}
