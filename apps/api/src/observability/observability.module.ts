import { Module } from "@nestjs/common";

import { EvalRunsController } from "./eval-runs.controller.js";
import { MetricsService } from "./metrics.service.js";
import { ObservabilityController } from "./observability.controller.js";
import { RunService } from "./run.service.js";

@Module({
  controllers: [ObservabilityController, EvalRunsController],
  providers: [RunService, MetricsService],
  exports: [RunService],
})
export class ObservabilityModule {}
