-- CreateEnum
CREATE TYPE "GameSource" AS ENUM ('STEAM', 'IGDB', 'MANUAL');

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "source" "GameSource" NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "coverUrl" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "genres" TEXT[],
    "features" TEXT[],
    "platforms" TEXT[],
    "developers" TEXT[],
    "releaseDate" TEXT,
    "screenshots" TEXT[],
    "storeUrl" TEXT,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "priceFinal" INTEGER,
    "priceInitial" INTEGER,
    "priceCurrency" TEXT,
    "discountPercent" INTEGER,
    "reviewPercent" INTEGER,
    "reviewCount" INTEGER,
    "reviewLabel" TEXT,
    "metacritic" INTEGER,
    "metadataUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupGame" (
    "groupId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupGame_pkey" PRIMARY KEY ("groupId","gameId")
);

-- CreateIndex
CREATE INDEX "Game_source_metadataUpdatedAt_idx" ON "Game"("source", "metadataUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Game_source_externalId_key" ON "Game"("source", "externalId");

-- CreateIndex
CREATE INDEX "GroupGame_gameId_idx" ON "GroupGame"("gameId");

-- AddForeignKey
ALTER TABLE "GroupGame" ADD CONSTRAINT "GroupGame_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupGame" ADD CONSTRAINT "GroupGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupGame" ADD CONSTRAINT "GroupGame_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

