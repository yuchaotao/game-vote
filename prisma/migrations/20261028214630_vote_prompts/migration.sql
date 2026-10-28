-- CreateEnum
CREATE TYPE "VotePromptStatus" AS ENUM ('PENDING', 'CONTINUED', 'ENDED_NEXT', 'ENDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "VotePrompt" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "players" INTEGER NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "playingSince" TIMESTAMP(3) NOT NULL,
    "status" "VotePromptStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "VotePrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VotePrompt_roundId_status_idx" ON "VotePrompt"("roundId", "status");

-- AddForeignKey
ALTER TABLE "VotePrompt" ADD CONSTRAINT "VotePrompt_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "VoteRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VotePrompt" ADD CONSTRAINT "VotePrompt_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VotePrompt" ADD CONSTRAINT "VotePrompt_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one unanswered prompt per round (two prompt checks racing).
CREATE UNIQUE INDEX "VotePrompt_one_pending_per_round" ON "VotePrompt"("roundId") WHERE "status" = 'PENDING';
