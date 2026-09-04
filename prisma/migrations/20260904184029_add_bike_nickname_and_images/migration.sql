-- AlterTable
ALTER TABLE "bikes" ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "nickname" TEXT;
