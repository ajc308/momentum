-- Data-only: workouts the Peloton app imported from Apple Watch
-- ("10 min 47 sec Outdoor Running", "25 min Cardio: Surfing Sports", no
-- instructor) were stored as Peloton. Relabel them Apple Watch with a clean
-- title, matching appleWatchImportTitle() in src/lib/peloton.ts, and drop
-- the auto-generated notes that just repeated the old title.
UPDATE "workout_sessions"
SET
  "source" = 'Apple Watch',
  "notes" = CASE WHEN "notes" LIKE "classTitle" || '%' THEN NULL ELSE "notes" END,
  "classTitle" = CASE
    WHEN regexp_replace(regexp_replace("classTitle", '^[0-9]+ min( [0-9]+ sec)? ', ''), '^Cardio: ', '') = 'Other' THEN 'Workout'
    ELSE regexp_replace(regexp_replace("classTitle", '^[0-9]+ min( [0-9]+ sec)? ', ''), '^Cardio: ', '')
  END
WHERE "pelotonWorkoutId" IS NOT NULL
  AND "instructor" IS NULL
  AND "deletedAt" IS NULL
  AND ("classTitle" ~ '^[0-9]+ min [0-9]+ sec ' OR "classTitle" ~ '^[0-9]+ min (Cardio: |Outdoor )');
