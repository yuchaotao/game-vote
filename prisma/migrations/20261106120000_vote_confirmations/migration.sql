-- CreateTable
CREATE TABLE "VoteConfirmation" (
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteConfirmation_pkey" PRIMARY KEY ("roundId","userId")
);

-- AddForeignKey
ALTER TABLE "VoteConfirmation" ADD CONSTRAINT "VoteConfirmation_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "VoteRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteConfirmation" ADD CONSTRAINT "VoteConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
