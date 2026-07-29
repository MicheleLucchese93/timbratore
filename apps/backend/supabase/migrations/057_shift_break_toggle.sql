-- Per-template switch for the "pausa" (coffee break) stamp events.
--
-- Some tenants only track ingresso/uscita and pausa pranzo: the "Inizio pausa"
-- button is noise there, and a worker who taps it by mistake opens a break that
-- has to be closed before the shift can end.
--
-- Default TRUE so every template that already exists keeps both pausa buttons —
-- turning the flag off is an explicit, per-orario admin choice.
--
-- Scope note: the flag lives on the template, so a user with no assigned
-- template has nothing to read and keeps the button (regression-safe default).
-- Only `break_start` is gated; `break_end` is always accepted so a break opened
-- before the flag was flipped can still be closed.

ALTER TABLE shift_templates
  ADD COLUMN IF NOT EXISTS break_enabled boolean NOT NULL DEFAULT true;
