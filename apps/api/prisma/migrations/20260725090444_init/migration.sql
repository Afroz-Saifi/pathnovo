-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "pid" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "revisionLabel" TEXT,
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "canonical" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparisons" (
    "id" TEXT NOT NULL,
    "pidA" TEXT NOT NULL,
    "pidB" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'complete',
    "registration" JSONB NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delta_entries" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "modifyKind" TEXT,
    "itemKind" TEXT NOT NULL,
    "sheet" INTEGER NOT NULL,
    "bboxA" JSONB,
    "bboxB" JSONB,
    "textA" TEXT,
    "textB" TEXT,
    "description" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "delta_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "requestId" TEXT NOT NULL,
    "pidA" TEXT,
    "pidB" TEXT,
    "comparisonId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_events" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "parentEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "tsStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,

    CONSTRAINT "trace_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "traceEventId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_pid_idx" ON "documents"("pid");

-- CreateIndex
CREATE INDEX "delta_entries_comparisonId_idx" ON "delta_entries"("comparisonId");

-- CreateIndex
CREATE INDEX "runs_kind_startedAt_idx" ON "runs"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "trace_events_runId_sequence_idx" ON "trace_events"("runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "trace_events_runId_sequence_key" ON "trace_events"("runId", "sequence");

-- CreateIndex
CREATE INDEX "usage_events_runId_idx" ON "usage_events"("runId");

-- AddForeignKey
ALTER TABLE "delta_entries" ADD CONSTRAINT "delta_entries_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
