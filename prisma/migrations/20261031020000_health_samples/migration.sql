-- CreateTable
CREATE TABLE "health_samples" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "qty" DOUBLE PRECISION,
    "min" DOUBLE PRECISION,
    "avg" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,

    CONSTRAINT "health_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_samples_name_day_idx" ON "health_samples"("name", "day");

-- CreateIndex
CREATE UNIQUE INDEX "health_samples_name_at_key" ON "health_samples"("name", "at");

