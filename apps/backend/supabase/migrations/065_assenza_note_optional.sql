-- Let an assenza be filed without a motivazione.
--
-- Migration 028 made user_note part of leave_requests_assenza_fields, as the
-- mandatory justification an HR audit reads back. One day later, commit 2625605
-- (2026-05-29, "Assenza leave type no longer requires a motivation") reversed
-- that product decision: it dropped the matching guard from
-- apps/backend/src/routes/leaves.ts, relabelled the mobile field "Motivazione
-- (facoltativa)" and documented the field as optional in the manual — but the
-- CHECK was never relaxed to match.
--
-- So since 2026-05-29 the clients have invited a blank motivazione and the
-- database has refused it. There is no 400 for this: the constraint fires
-- underneath the handler and POST /api/v1/leaves answers 500. It surfaced in
-- production on 2026-08-26 08:51:35, on the first assenza anyone had ever
-- filed — the employee retried eight seconds later with a reason typed in and
-- got a 201, which is the only assenza row in the database.
--
-- This completes the 2625605 decision on the layer it missed. subtype and
-- is_paid stay mandatory: they are structured fields the payroll export reads
-- (Centro Paghe maps a giustificativo code per subtype), whereas the note is
-- free text nothing computes on.
--
-- Reversibility: re-adding the user_note clause is a plain ALTER as long as no
-- blank-note row exists yet. Once employees start filing without a reason, a
-- revert has to decide what to do with those rows first.

ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_assenza_fields;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_assenza_fields CHECK (
    type <> 'assenza' OR (
      assenza_subtype IS NOT NULL
      AND length(assenza_subtype) > 0
      AND is_paid IS NOT NULL
    )
  );
