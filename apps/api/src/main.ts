import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableCors({ origin: true });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  app.get(Logger).log(`API listening on http://localhost:${port}`);
}

void bootstrap();
