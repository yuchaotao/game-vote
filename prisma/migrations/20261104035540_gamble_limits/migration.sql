-- DropIndex
DROP INDEX "VoteGamble_roundId_userId_kind_key";

-- AlterTable
ALTER TABLE "VoteRound" ADD COLUMN     "gambleLimit" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE INDEX "VoteGamble_roundId_userId_kind_idx" ON "VoteGamble"("roundId", "userId", "kind");

