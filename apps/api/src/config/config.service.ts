import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { type Config, loadConfig } from "@pathnovo/config";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";

/** Env vars that must not be edited at runtime (secret / boot-time). */
const NON_EDITABLE = new Set(["OPENAI_API_KEY", "DATABASE_URL"]);

/**
 * Effective configuration = process.env with DB-stored overrides merged on top,
 * re-parsed through loadConfig (so validation + coercion are reused). Services
 * read this live via `get()`, so an update takes effect on the next operation.
 */
@Injectable()
export class ConfigService implements OnModuleInit {
  private readonly logger = new Logger(ConfigService.name);
  private overrides: Record<string, string> = {};
  private effective: Config = loadConfig();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  get(): Config {
    return this.effective;
  }

  overriddenEnvKeys(): string[] {
    return Object.keys(this.overrides);
  }

  isEditable(env: string): boolean {
    return !NON_EDITABLE.has(env);
  }

  /** Apply env-var-keyed overrides; ignores non-editable/empty keys. Validates. */
  async update(env: Record<string, unknown>): Promise<void> {
    const clean: Record<string, string> = { ...this.overrides };
    for (const [k, v] of Object.entries(env)) {
      if (!this.isEditable(k) || v === undefined || v === null || v === "") continue;
      clean[k] = String(v);
    }
    // Validate the merged env parses before persisting.
    loadConfig({ ...process.env, ...clean } as NodeJS.ProcessEnv);
    await this.prisma.appConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", overrides: clean as unknown as Prisma.InputJsonValue },
      update: { overrides: clean as unknown as Prisma.InputJsonValue },
    });
    await this.reload();
  }

  /** Clear all overrides, reverting to the env defaults. */
  async reset(): Promise<void> {
    await this.prisma.appConfig.deleteMany({});
    await this.reload();
  }

  private async reload(): Promise<void> {
    const row = await this.prisma.appConfig.findUnique({ where: { id: "singleton" } });
    this.overrides = (row?.overrides as Record<string, string>) ?? {};
    this.effective = loadConfig({ ...process.env, ...this.overrides } as NodeJS.ProcessEnv);
  }
}
