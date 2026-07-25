import { Module } from "@nestjs/common";

import { IndexingService } from "./indexing.service.js";

@Module({
  providers: [IndexingService],
  exports: [IndexingService],
})
export class ChatModule {}
