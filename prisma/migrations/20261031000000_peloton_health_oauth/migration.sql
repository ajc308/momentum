-- DropIndex
DROP INDEX "workout_sessions_tonalWorkoutId_key";

-- AlterTable
ALTER TABLE "workout_sessions" DROP COLUMN "tonalWorkoutId",
ADD COLUMN     "avgHeartRate" INTEGER,
ADD COLUMN     "calories" INTEGER,
ADD COLUMN     "classTitle" TEXT,
ADD COLUMN     "discipline" TEXT,
ADD COLUMN     "healthWorkoutId" TEXT,
ADD COLUMN     "instructor" TEXT,
ADD COLUMN     "maxHeartRate" INTEGER,
ADD COLUMN     "totalOutputKj" INTEGER;

-- AlterTable
ALTER TABLE "body_measurements" DROP COLUMN "renphoRecordId",
ALTER COLUMN "source" SET DEFAULT 'Manual';

-- DropTable
DROP TABLE "tonal_credentials";

-- DropTable
DROP TABLE "renpho_credentials";

-- DropTable
DROP TABLE "free_weight_progress";

-- CreateTable
CREATE TABLE "health_metrics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "units" TEXT,
    "qty" DOUBLE PRECISION,
    "min" DOUBLE PRECISION,
    "avg" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_codes" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_metrics_date_idx" ON "health_metrics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "health_metrics_name_date_key" ON "health_metrics"("name", "date");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_codes_codeHash_key" ON "oauth_codes"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_tokenHash_key" ON "oauth_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "oauth_tokens_clientId_idx" ON "oauth_tokens"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "workout_sessions_healthWorkoutId_key" ON "workout_sessions"("healthWorkoutId");

