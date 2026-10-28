-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'DISCORD_CHANNEL';

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "discordChannelId" TEXT,
ADD COLUMN     "discordChannelLabel" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Notification_groupId_createdAt_idx" ON "Notification"("groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Either one person (userId) or one group channel post (groupId).
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_one_recipient" CHECK (("userId" IS NULL) <> ("groupId" IS NULL));
