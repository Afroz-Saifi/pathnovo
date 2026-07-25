import { randomUUID } from "node:crypto";

import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { HealthController } from "./health/health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // Structured JSON logs with a request correlation id on every line.
        genReqId: (req) => (req.headers["x-request-id"] as string) ?? randomUUID(),
        customProps: (req) => ({ requestId: (req as { id?: string }).id }),
        transport:
          process.env.NODE_ENV === "production"
            ? undefined
            : { target: "pino-pretty", options: { singleLine: true } },
      },
    }),
    PrismaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
