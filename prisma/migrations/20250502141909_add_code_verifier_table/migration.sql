-- CreateTable
CREATE TABLE "CodeVerifier" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CodeVerifier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CodeVerifier_state_key" ON "CodeVerifier"("state");

-- CreateIndex
CREATE INDEX "CodeVerifier_state_idx" ON "CodeVerifier"("state");
