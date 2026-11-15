-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "sender_id" VARCHAR(255) NOT NULL,
    "stage" VARCHAR(50) NOT NULL DEFAULT 'new',
    "phone" VARCHAR(30),
    "country" VARCHAR(2),
    "last_intent" VARCHAR(50),
    "summary" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_client_id_stage_updated_at_idx" ON "leads"("client_id", "stage", "updated_at");

-- CreateIndex
CREATE INDEX "leads_updated_at_idx" ON "leads"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "leads_platform_account_id_sender_id_key" ON "leads"("platform", "account_id", "sender_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
