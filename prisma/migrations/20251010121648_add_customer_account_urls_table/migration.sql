-- CreateTable
CREATE TABLE "CustomerAccountUrls" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "mcpApiUrl" TEXT,
    "authorizationUrl" TEXT,
    "tokenUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerAccountUrls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccountUrls_conversationId_key" ON "CustomerAccountUrls"("conversationId");
