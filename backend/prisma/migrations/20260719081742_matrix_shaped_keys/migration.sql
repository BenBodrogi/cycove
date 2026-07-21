/*
  Warnings:

  - You are about to drop the column `identityKey` on the `devices` table. All the data in the column will be lost.
  - You are about to drop the column `signedPrekey` on the `devices` table. All the data in the column will be lost.
  - You are about to drop the `prekey_bundles` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `deviceKeys` to the `devices` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "prekey_bundles" DROP CONSTRAINT "prekey_bundles_deviceId_fkey";

-- AlterTable
ALTER TABLE "devices" DROP COLUMN "identityKey",
DROP COLUMN "signedPrekey",
ADD COLUMN     "deviceKeys" JSONB NOT NULL;

-- DropTable
DROP TABLE "prekey_bundles";

-- CreateTable
CREATE TABLE "one_time_keys" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "keyData" JSONB NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "one_time_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "one_time_keys_deviceId_idx" ON "one_time_keys"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_keys_deviceId_keyId_key" ON "one_time_keys"("deviceId", "keyId");

-- AddForeignKey
ALTER TABLE "one_time_keys" ADD CONSTRAINT "one_time_keys_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
