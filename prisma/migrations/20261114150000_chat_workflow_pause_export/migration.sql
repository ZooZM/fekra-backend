-- CreateEnum
CREATE TYPE "CommentDecisionBasis" AS ENUM ('RULES', 'AI_MODEL', 'SAFE_FALLBACK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ChatPauseAction" AS ENUM ('PAUSED', 'RESUMED');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "chat_subscribed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "chat_workflow_endpoint" VARCHAR(100);

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "paused_at" TIMESTAMP(3),
ADD COLUMN     "paused_by_id" UUID,
ADD COLUMN     "paused_by_name" VARCHAR(255),
ADD COLUMN     "paused_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "message_replies" ADD COLUMN     "answered" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "comment_replies" ADD COLUMN     "decision_basis" "CommentDecisionBasis" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "decision_model" VARCHAR(100);

-- CreateTable
CREATE TABLE "chat_pause_events" (
    "id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "action" "ChatPauseAction" NOT NULL,
    "duration" VARCHAR(16),
    "until" TIMESTAMP(3),
    "actor_id" UUID,
    "actor_name" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_pause_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_export_records" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" VARCHAR(255) NOT NULL,
    "actor_email" VARCHAR(255) NOT NULL,
    "filters" JSONB NOT NULL,
    "row_count" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comment_export_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_pause_events_chat_id_created_at_idx" ON "chat_pause_events"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "comment_export_records_actor_id_idx" ON "comment_export_records"("actor_id");

-- CreateIndex
CREATE INDEX "comment_export_records_created_at_idx" ON "comment_export_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "clients_chat_workflow_endpoint_key" ON "clients"("chat_workflow_endpoint");

-- CreateIndex
CREATE INDEX "chats_updated_at_idx" ON "chats"("updated_at");

-- CreateIndex
CREATE INDEX "chats_paused_until_idx" ON "chats"("paused_until");

-- CreateIndex
CREATE INDEX "message_replies_created_at_idx" ON "message_replies"("created_at");

-- CreateIndex
CREATE INDEX "comment_replies_created_at_id_idx" ON "comment_replies"("created_at", "id");

-- AddForeignKey
ALTER TABLE "chat_pause_events" ADD CONSTRAINT "chat_pause_events_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A client can only be subscribed to the chat service when it has an endpoint (last line of
-- defense behind the service's field error; spec FR-045)
ALTER TABLE "clients" ADD CONSTRAINT "clients_chat_subscription_needs_endpoint"
  CHECK (NOT "chat_subscribed" OR "chat_workflow_endpoint" IS NOT NULL);
