-- Email verification is now part of sign-up. Accounts created before it existed were never asked to
-- verify; mark them verified once so nobody who already uses SyncSprint is locked out.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false;
