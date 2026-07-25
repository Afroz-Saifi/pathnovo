import { Module } from "@nestjs/common";

import { ObservabilityModule } from "../observability/observability.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { IndexingService } from "./indexing.service.js";
import { RetrievalService } from "./retrieval.service.js";

@Module({
  imports: [ObservabilityModule],
  controllers: [ChatController],
  providers: [IndexingService, RetrievalService, ChatService],
  exports: [IndexingService],
})
export class ChatModule {}
