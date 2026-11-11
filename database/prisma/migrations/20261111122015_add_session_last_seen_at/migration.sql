BEGIN;

ALTER TABLE "Session"
ADD COLUMN "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Prior sessions have no activity history; do not grant them a fresh idle window.
UPDATE "Session" SET "lastSeenAt" = "createdAt";

COMMIT;
