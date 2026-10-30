-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN     "cachedTokens" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "outdoor" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "cachedInputPricePerMTok" DOUBLE PRECISION NOT NULL DEFAULT 0.025,
ADD COLUMN     "weatherLabel" TEXT,
ADD COLUMN     "weatherLat" DOUBLE PRECISION,
ADD COLUMN     "weatherLon" DOUBLE PRECISION,
ADD COLUMN     "weatherUnit" TEXT NOT NULL DEFAULT 'celsius',
ALTER COLUMN "aiProvider" SET DEFAULT '',
ALTER COLUMN "aiModel" SET DEFAULT '';

-- CreateTable
CREATE TABLE "AiCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherCache" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AiCache_expiresAt_idx" ON "AiCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiCache_userId_key_key" ON "AiCache"("userId", "key");

-- AddForeignKey
ALTER TABLE "AiCache" ADD CONSTRAINT "AiCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rows created with the old hard-coded defaults now follow the server configuration.
UPDATE "UserSettings" SET "aiModel" = '' WHERE "aiModel" = 'gpt-5-mini';
UPDATE "UserSettings" SET "aiProvider" = '' WHERE "aiProvider" = 'openai';
