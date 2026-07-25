import { randomUUID } from "node:crypto";

import { BadRequestException, Body, Controller, Param, Post, Req } from "@nestjs/common";

import { ChatService } from "./chat.service.js";

interface AskBody {
  question?: string;
  sessionId?: string;
}

@Controller("comparisons/:id/chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  async ask(@Param("id") id: string, @Body() body: AskBody, @Req() req: { id?: string }) {
    const question = body.question?.trim();
    if (!question) throw new BadRequestException("question is required");
    return this.chat.ask(id, question, req.id ?? randomUUID(), body.sessionId);
  }
}
