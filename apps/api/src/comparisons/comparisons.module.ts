import { Module } from "@nestjs/common";

import { ChatModule } from "../chat/chat.module.js";
import { ObservabilityModule } from "../observability/observability.module.js";
import { ComparisonsController } from "./comparisons.controller.js";
import { ComparisonsService } from "./comparisons.service.js";

@Module({
  imports: [ObservabilityModule, ChatModule],
  controllers: [ComparisonsController],
  providers: [ComparisonsService],
})
export class ComparisonsModule {}
