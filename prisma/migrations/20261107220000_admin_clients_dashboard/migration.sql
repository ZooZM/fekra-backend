-- CreateEnum
CREATE TYPE "ClientActivityAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'ACCESS_TOKEN_REPLACED');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "revoked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "client_activities" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "client_name" VARCHAR(255) NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" VARCHAR(255) NOT NULL,
    "actor_email" VARCHAR(255) NOT NULL,
    "action" "ClientActivityAction" NOT NULL,
    "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_activities_client_id_created_at_idx" ON "client_activities"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "client_activities_actor_id_idx" ON "client_activities"("actor_id");

-- CreateIndex
CREATE INDEX "client_activities_created_at_idx" ON "client_activities"("created_at");

