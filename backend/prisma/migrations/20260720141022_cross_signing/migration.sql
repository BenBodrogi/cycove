-- AlterTable
ALTER TABLE "users" ADD COLUMN     "masterKey" JSONB,
ADD COLUMN     "selfSigningKey" JSONB,
ADD COLUMN     "userSigningKey" JSONB;

-- AlterTable: EncryptedBackup's primary key becomes composite [userId, dataType]
-- so a user can have more than one backup row (contacts, cross-signing, ...).
ALTER TABLE "encrypted_backups" DROP CONSTRAINT "encrypted_backups_pkey";
ALTER TABLE "encrypted_backups" ADD CONSTRAINT "encrypted_backups_pkey" PRIMARY KEY ("userId", "dataType");
