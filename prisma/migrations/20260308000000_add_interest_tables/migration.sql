-- CreateTable
CREATE TABLE "InterestTag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterestTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerInterest" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "strength" TEXT,
    "score" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterestTag_slug_key" ON "InterestTag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInterest_playerId_tagId_source_key" ON "PlayerInterest"("playerId", "tagId", "source");

-- CreateIndex
CREATE INDEX "PlayerInterest_playerId_idx" ON "PlayerInterest"("playerId");

-- CreateIndex
CREATE INDEX "PlayerInterest_tagId_idx" ON "PlayerInterest"("tagId");

-- AddForeignKey
ALTER TABLE "PlayerInterest" ADD CONSTRAINT "PlayerInterest_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInterest" ADD CONSTRAINT "PlayerInterest_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "InterestTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
