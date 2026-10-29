-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "refId" TEXT;

-- AlterTable
ALTER TABLE "VotePrompt" ADD COLUMN     "discordChannelId" TEXT,
ADD COLUMN     "discordClosedAt" TIMESTAMP(3),
ADD COLUMN     "discordMessageId" TEXT;

-- AlterTable
ALTER TABLE "VoteRound" ADD COLUMN     "discordChannelId" TEXT,
ADD COLUMN     "discordMessageId" TEXT;

