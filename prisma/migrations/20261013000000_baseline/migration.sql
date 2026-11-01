-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "miles" DOUBLE PRECISION,
    "weightLifted" DOUBLE PRECISION,
    "notes" TEXT,
    "pelotonWorkoutId" TEXT,
    "tonalWorkoutId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peloton_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "peloton_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tonal_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tonal_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renpho_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renpho_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_measurements" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "weightLbs" DOUBLE PRECISION NOT NULL,
    "bmi" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "waterPct" DOUBLE PRECISION,
    "musclePct" DOUBLE PRECISION,
    "boneMassPct" DOUBLE PRECISION,
    "bmr" DOUBLE PRECISION,
    "visceralFatLevel" DOUBLE PRECISION,
    "subcutaneousFatPct" DOUBLE PRECISION,
    "proteinPct" DOUBLE PRECISION,
    "bodyAgeYears" DOUBLE PRECISION,
    "leanBodyMassLbs" DOUBLE PRECISION,
    "fatFreeWeightLbs" DOUBLE PRECISION,
    "heartRateBpm" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'Renpho',
    "renphoRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "annualWeightTarget" DOUBLE PRECISION NOT NULL,
    "minutesPerSession" INTEGER NOT NULL,
    "weeklySessionsTarget" INTEGER NOT NULL,
    "weeklyMinutesTarget" INTEGER NOT NULL,
    "annualMinutesTarget" INTEGER NOT NULL,
    "quarterlyWeightTarget" DOUBLE PRECISION NOT NULL,
    "quarterlyMinutesTarget" INTEGER NOT NULL,
    "quarterlySessionsTarget" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_summaries" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "totalMiles" DOUBLE PRECISION NOT NULL,
    "totalSessions" INTEGER NOT NULL,
    "averageWeight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "free_weight_progress" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "weightPerDumbbell" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "free_weight_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "authMode" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "ip" TEXT,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workout_sessions_pelotonWorkoutId_key" ON "workout_sessions"("pelotonWorkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "workout_sessions_tonalWorkoutId_key" ON "workout_sessions"("tonalWorkoutId");

-- CreateIndex
CREATE INDEX "workout_sessions_date_idx" ON "workout_sessions"("date");

-- CreateIndex
CREATE INDEX "workout_sessions_source_date_idx" ON "workout_sessions"("source", "date");

-- CreateIndex
CREATE INDEX "workout_sessions_deletedAt_idx" ON "workout_sessions"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "peloton_credentials_userId_key" ON "peloton_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tonal_credentials_userId_key" ON "tonal_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "renpho_credentials_userId_key" ON "renpho_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "body_measurements_date_key" ON "body_measurements"("date");

-- CreateIndex
CREATE INDEX "body_measurements_date_idx" ON "body_measurements"("date");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_summaries_year_month_key" ON "monthly_summaries"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "free_weight_progress_exerciseId_key" ON "free_weight_progress"("exerciseId");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "audit_log_authMode_createdAt_idx" ON "audit_log"("authMode", "createdAt");

