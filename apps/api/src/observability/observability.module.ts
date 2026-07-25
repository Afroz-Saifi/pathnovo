import { Module } from "@nestjs/common";

import { MetricsService } from "./metrics.service.js";
import { ObservabilityController } from "./observability.controller.js";
import { RunService } from "./run.service.js";

@Module({
  controllers: [ObservabilityController],
  providers: [RunService, MetricsService],
  exports: [RunService],
})
export class ObservabilityModule {}
