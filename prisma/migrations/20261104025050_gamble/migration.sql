-- CreateEnum
CREATE TYPE "VoteGambleKind" AS ENUM ('PEEK', 'SWAP');

-- AlterEnum
ALTER TYPE "VoteEventKind" ADD VALUE 'SWAP';

-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN     "luck" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "VoteEvent" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "toGameId" TEXT;

-- CreateTable
CREATE TABLE "VoteGamble" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "VoteGambleKind" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "luckBefore" INTEGER NOT NULL,
    "seenAt" TIMESTAMP(3),
    "targetUserId" TEXT,
    "fromGameId" TEXT,
    "toGameId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteGamble_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoteGamble_roundId_userId_kind_key" ON "VoteGamble"("roundId", "userId", "kind");

-- AddForeignKey
ALTER TABLE "VoteGamble" ADD CONSTRAINT "VoteGamble_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "VoteRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteGamble" ADD CONSTRAINT "VoteGamble_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteGamble" ADD CONSTRAINT "VoteGamble_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The lucky coin is a percentage.
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_luck_percent" CHECK ("luck" BETWEEN 0 AND 100);
