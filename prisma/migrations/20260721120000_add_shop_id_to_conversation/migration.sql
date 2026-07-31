-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "shopId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_shopId_idx" ON "Conversation"("shopId");
