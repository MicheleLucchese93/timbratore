import { z } from 'zod';

// Password complexity — the single server-side source of truth, enforced on
// every endpoint that SETS a new password. Mirrors the rules surfaced live in
// the web/partner "change password" forms and the static set-password page
// (apps/backend/public/reset-password.html). Keep all of them in sync.
export const PASSWORD_MIN = 8;

export function passwordComplexityIssues(p: string): string[] {
  const issues: string[] = [];
  if (p.length < PASSWORD_MIN) issues.push('length');
  if (!/[a-z]/.test(p)) issues.push('lower');
  if (!/[A-Z]/.test(p)) issues.push('upper');
  if (!/[0-9]/.test(p)) issues.push('digit');
  if (!/[^a-zA-Z0-9]/.test(p)) issues.push('symbol');
  return issues;
}

// Reusable zod schema for a NEW password: min length + lower/upper/digit/symbol.
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN)
  .refine((p) => passwordComplexityIssues(p).length === 0, {
    message: 'Password does not meet complexity requirements',
  });
