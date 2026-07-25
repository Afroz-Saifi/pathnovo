import { Global, Module } from "@nestjs/common";

import { ConfigController } from "./config.controller.js";
import { ConfigService } from "./config.service.js";

@Global()
@Module({
  controllers: [ConfigController],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
