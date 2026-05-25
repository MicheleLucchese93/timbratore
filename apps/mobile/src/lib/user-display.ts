interface UserNamed {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
}

export function userDisplayName(u: UserNamed): string {
  if (u.display_name?.trim()) return u.display_name.trim();
  const joined = [u.first_name, u.last_name].filter((s) => s?.trim()).join(' ').trim();
  if (joined) return joined;
  const local = u.email.split('@')[0] ?? '';
  return local;
}

export function userInitial(u: UserNamed): string {
  const name = userDisplayName(u);
  return name.charAt(0).toUpperCase() || '?';
}
