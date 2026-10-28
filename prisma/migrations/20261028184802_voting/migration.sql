-- CreateEnum
CREATE TYPE "VoteRoundStatus" AS ENUM ('OPEN', 'ENDED');

-- CreateEnum
CREATE TYPE "VoteEndReason" AS ENUM ('MANUAL', 'NEXT_ROUND', 'DEADLINE', 'PROMPT');

-- CreateEnum
CREATE TYPE "VoteEventKind" AS ENUM ('CANDIDATE', 'CAST', 'RETRACT', 'REMOVED');

-- CreateTable
CREATE TABLE "VoteRound" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "maxVotes" INTEGER NOT NULL DEFAULT 3,
    "status" "VoteRoundStatus" NOT NULL DEFAULT 'OPEN',
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "endReason" "VoteEndReason",
    "winnerGameId" TEXT,
    "previousId" TEXT,

    CONSTRAINT "VoteRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteCandidate" (
    "roundId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteCandidate_pkey" PRIMARY KEY ("roundId","gameId")
);

-- CreateTable
CREATE TABLE "VoteBallot" (
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteBallot_pkey" PRIMARY KEY ("roundId","userId","gameId")
);

-- CreateTable
CREATE TABLE "VoteEvent" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT,
    "gameId" TEXT NOT NULL,
    "kind" "VoteEventKind" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoteRound_groupId_status_idx" ON "VoteRound"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VoteRound_groupId_number_key" ON "VoteRound"("groupId", "number");

-- CreateIndex
CREATE INDEX "VoteBallot_roundId_gameId_idx" ON "VoteBallot"("roundId", "gameId");

-- CreateIndex
CREATE INDEX "VoteEvent_roundId_at_idx" ON "VoteEvent"("roundId", "at");

-- AddForeignKey
ALTER TABLE "VoteRound" ADD CONSTRAINT "VoteRound_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRound" ADD CONSTRAINT "VoteRound_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRound" ADD CONSTRAINT "VoteRound_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRound" ADD CONSTRAINT "VoteRound_winnerGameId_fkey" FOREIGN KEY ("winnerGameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRound" ADD CONSTRAINT "VoteRound_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "VoteRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteCandidate" ADD CONSTRAINT "VoteCandidate_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "VoteRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteCandidate" ADD CONSTRAINT "VoteCandidate_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteCandidate" ADD CONSTRAINT "VoteCandidate_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "VoteRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteEvent" ADD CONSTRAINT "VoteEvent_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "VoteRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteEvent" ADD CONSTRAINT "VoteEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteEvent" ADD CONSTRAINT "VoteEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one open round per group (not expressible in the Prisma schema).
CREATE UNIQUE INDEX "VoteRound_one_open_per_group" ON "VoteRound"("groupId") WHERE "status" = 'OPEN';
