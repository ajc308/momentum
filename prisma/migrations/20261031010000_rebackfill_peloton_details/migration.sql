-- Data-only: re-run the one-time Peloton class-details backfill so rows
-- synced under the old mapping get corrected source/activity and the
-- instructor-equals-title cleanup. The next sync re-fills these columns.
UPDATE "workout_sessions" SET "discipline" = NULL WHERE "pelotonWorkoutId" IS NOT NULL;
