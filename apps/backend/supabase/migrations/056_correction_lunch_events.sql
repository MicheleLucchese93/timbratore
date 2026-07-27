-- Allow lunch_start/lunch_end in correction requests.
--
-- 023_lunch_break.sql widened stamps.event_type to the two pausa pranzo events
-- but left correction_requests.claimed_event_type on the original four. The API
-- (routes/correction-requests.ts) accepts all six, so any correction request for
-- "Inizio/Fine pausa pranzo" passed zod and then died at INSERT with 23514.
-- Same list as stamps_event_type_check; keep the two in sync.

ALTER TABLE correction_requests DROP CONSTRAINT IF EXISTS correction_requests_claimed_event_type_check;
ALTER TABLE correction_requests ADD CONSTRAINT correction_requests_claimed_event_type_check
  CHECK (claimed_event_type IN ('clock_in','clock_out','break_start','break_end','lunch_start','lunch_end'));
