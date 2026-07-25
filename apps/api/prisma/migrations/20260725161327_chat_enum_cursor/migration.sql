-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "enumOffset" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "enumType" TEXT;
