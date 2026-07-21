/*
  Warnings:

  - You are about to drop the `message_queue` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "message_queue" DROP CONSTRAINT "message_queue_recipientDeviceId_fkey";

-- DropForeignKey
ALTER TABLE "message_queue" DROP CONSTRAINT "message_queue_senderDeviceId_fkey";

-- DropTable
DROP TABLE "message_queue";

-- CreateTable
CREATE TABLE "to_device_queue" (
    "id" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "to_device_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "to_device_queue_recipientDeviceId_idx" ON "to_device_queue"("recipientDeviceId");

-- AddForeignKey
ALTER TABLE "to_device_queue" ADD CONSTRAINT "to_device_queue_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "to_device_queue" ADD CONSTRAINT "to_device_queue_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
