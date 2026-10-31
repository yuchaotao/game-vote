-- AlterTable
ALTER TABLE "VoteBallot" ADD COLUMN     "count" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "VoteRound" ADD COLUMN     "repeatVotes" BOOLEAN NOT NULL DEFAULT false;


-- A ballot always holds at least one vote (no zero-count rows).
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_count_positive" CHECK ("count" >= 1);
