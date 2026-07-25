import { Controller, Get } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; db: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "up" };
    } catch {
      return { status: "degraded", db: "down" };
    }
  }
}
