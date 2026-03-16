-- AlterTable
ALTER TABLE "User"
ADD COLUMN "googleId" TEXT,
ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "twoFactorSecret" TEXT,
ADD COLUMN "twoFactorTempSecret" TEXT,
ADD COLUMN "twoFactorBackupCodes" JSONB;

-- AlterTable
ALTER TABLE "RefreshToken"
ADD COLUMN "createdByIp" TEXT,
ADD COLUMN "createdByUserAgent" TEXT,
ADD COLUMN "lastUsedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
