-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "CommentClassification" AS ENUM ('ENGAGEMENT', 'INQUIRY', 'UNSURE', 'COMPLAINT', 'SPAM', 'INSULT');

-- CreateTable
CREATE TABLE "chats" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "sender_id" VARCHAR(255) NOT NULL,
    "receiver_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_replies" (
    "id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_replies" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "comment_id" VARCHAR(255) NOT NULL,
    "comment" TEXT NOT NULL,
    "classification" "CommentClassification" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chats_client_id_idx" ON "chats"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "chats_platform_receiver_id_sender_id_key" ON "chats"("platform", "receiver_id", "sender_id");

-- CreateIndex
CREATE INDEX "message_replies_chat_id_created_at_idx" ON "message_replies"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "comment_replies_client_id_created_at_idx" ON "comment_replies"("client_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "comment_replies_platform_comment_id_key" ON "comment_replies"("platform", "comment_id");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_replies" ADD CONSTRAINT "message_replies_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_replies" ADD CONSTRAINT "comment_replies_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
