import { Module } from "@nestjs/common";

import { ObservabilityModule } from "../observability/observability.module.js";
import { ComparisonsController } from "./comparisons.controller.js";
import { ComparisonsService } from "./comparisons.service.js";

@Module({
  imports: [ObservabilityModule],
  controllers: [ComparisonsController],
  providers: [ComparisonsService],
})
export class ComparisonsModule {}
