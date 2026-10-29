-- AlterTable
ALTER TABLE "VoteRound" ADD COLUMN     "anonymous" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VotePeek" (
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VotePeek_pkey" PRIMARY KEY ("roundId","userId")
);

-- CreateTable
CREATE TABLE "VoteRevealSeen" (
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteRevealSeen_pkey" PRIMARY KEY ("roundId","userId")
);

-- AddForeignKey
ALTER TABLE "VotePeek" ADD CONSTRAINT "VotePeek_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "VoteRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VotePeek" ADD CONSTRAINT "VotePeek_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRevealSeen" ADD CONSTRAINT "VoteRevealSeen_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "VoteRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRevealSeen" ADD CONSTRAINT "VoteRevealSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

