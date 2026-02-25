-- CreateTable
CREATE TABLE "PlayerPartnership" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "dates" TEXT NOT NULL,
    "activationType" TEXT NOT NULL,
    "distribution" TEXT,
    "additionalNotes" TEXT,
    "playerFee" TEXT,
    "caliber" TEXT,
    "igFollowersAtTime" INTEGER,
    "twitterFollowersAtTime" INTEGER,
    "reachAtTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerPartnership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerPartnership_playerId_idx" ON "PlayerPartnership"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerPartnership_playerId_brand_dates_activationType_key" ON "PlayerPartnership"("playerId", "brand", "dates", "activationType");

-- AddForeignKey
ALTER TABLE "PlayerPartnership" ADD CONSTRAINT "PlayerPartnership_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
