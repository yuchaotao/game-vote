-- CreateEnum
CREATE TYPE "PlaySource" AS ENUM ('STEAM', 'DISCORD', 'MANUAL');

-- CreateTable
CREATE TABLE "PlaySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "source" "PlaySource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "PlaySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaySession_userId_endedAt_idx" ON "PlaySession"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "PlaySession_gameId_startedAt_idx" ON "PlaySession"("gameId", "startedAt");

-- CreateIndex
CREATE INDEX "PlaySession_source_endedAt_idx" ON "PlaySession"("source", "endedAt");

-- AddForeignKey
ALTER TABLE "PlaySession" ADD CONSTRAINT "PlaySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaySession" ADD CONSTRAINT "PlaySession_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

