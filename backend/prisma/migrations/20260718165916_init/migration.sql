-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveryKeyHash" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityKey" BYTEA NOT NULL,
    "signedPrekey" BYTEA NOT NULL,
    "pushToken" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prekey_bundles" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "oneTimePrekey" BYTEA NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "prekey_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_queue" (
    "id" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE INDEX "prekey_bundles_deviceId_idx" ON "prekey_bundles"("deviceId");

-- CreateIndex
CREATE INDEX "message_queue_recipientDeviceId_idx" ON "message_queue"("recipientDeviceId");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prekey_bundles" ADD CONSTRAINT "prekey_bundles_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_queue" ADD CONSTRAINT "message_queue_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_queue" ADD CONSTRAINT "message_queue_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
