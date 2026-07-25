import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";

import { ComparisonsService, type UploadedDoc } from "./comparisons.service.js";

interface UploadFields {
  a?: UploadedDoc[];
  b?: UploadedDoc[];
}

@Controller("comparisons")
export class ComparisonsController {
  constructor(private readonly comparisons: ComparisonsService) {}

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: "a", maxCount: 1 },
      { name: "b", maxCount: 1 },
    ]),
  )
  async create(@UploadedFiles() files: UploadFields, @Req() req: { id?: string }) {
    const a = files.a?.[0];
    const b = files.b?.[0];
    if (!a || !b) throw new BadRequestException("upload two files as fields 'a' and 'b'");
    return this.comparisons.createFromFiles(a, b, req.id ?? randomUUID());
  }

  @Get()
  async list() {
    return this.comparisons.listComparisons();
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const c = await this.comparisons.getComparison(id);
    if (!c) throw new NotFoundException(`comparison ${id} not found`);
    return c;
  }

  @Get(":id/sheet/:side/:index")
  async sheet(
    @Param("id") id: string,
    @Param("side") side: string,
    @Param("index") index: string,
    @Res() res: Response,
  ): Promise<void> {
    const s = side === "a" || side === "b" ? side : null;
    if (!s) throw new BadRequestException("side must be 'a' or 'b'");
    const png = await this.comparisons.renderSheet(id, s, Number(index) || 0);
    if (!png) throw new NotFoundException("sheet not found");
    res.set("content-type", "image/png").set("cache-control", "public, max-age=86400").send(png);
  }

  @Get(":id/report.md")
  @Header("content-type", "text/markdown; charset=utf-8")
  async report(@Param("id") id: string): Promise<string> {
    const md = await this.comparisons.getReportMarkdown(id);
    if (md === null) throw new NotFoundException(`comparison ${id} not found`);
    return md;
  }
}
