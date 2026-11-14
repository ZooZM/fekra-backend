-- DropIndex
DROP INDEX "clients_chat_workflow_endpoint_key";

-- CreateIndex
CREATE INDEX "clients_chat_workflow_endpoint_idx" ON "clients"("chat_workflow_endpoint");
