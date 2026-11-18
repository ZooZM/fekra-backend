-- AlterTable
-- insta_access_token: an Instagram Login token (encrypted), used for Instagram calls on
-- graph.instagram.com. access_token (the Page token) becomes optional for Instagram-only clients.
-- Backward compatible: the running release always writes access_token and never reads the new column.
ALTER TABLE "clients" ADD COLUMN     "insta_access_token" TEXT,
ALTER COLUMN "access_token" DROP NOT NULL;

-- Every client keeps at least one token (last line of defense behind the create schema's field error)
ALTER TABLE "clients" ADD CONSTRAINT "clients_needs_an_access_token"
  CHECK ("access_token" IS NOT NULL OR "insta_access_token" IS NOT NULL);
