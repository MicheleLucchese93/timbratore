// Shared leave-type presentation: labels + calendar colors. Used by the web
// and mobile calendars so a "ferie" block looks the same on every surface.

export type LeaveCalType = 'ferie' | 'permessi' | 'malattia' | 'assenza' | 'chiusura';

export const ALL_LEAVE_CAL_TYPES: readonly LeaveCalType[] = [
  'ferie',
  'permessi',
  'malattia',
  'assenza',
  'chiusura',
] as const;

export const LEAVE_TYPE_LABEL: Record<LeaveCalType, string> = {
  ferie: 'Ferie',
  permessi: 'Permesso',
  malattia: 'Malattia',
  assenza: 'Assenza',
  chiusura: 'Chiusura aziendale',
};

/** Calendar event colors. Festività uses its own green, see HOLIDAY_COLOR. */
export const LEAVE_TYPE_COLOR: Record<LeaveCalType, string> = {
  ferie: '#2563eb', // blue
  permessi: '#7c3aed', // violet
  malattia: '#dc2626', // red
  assenza: '#d97706', // amber
  chiusura: '#475569', // slate
};

export const HOLIDAY_COLOR = '#059669'; // emerald — Italian national holidays

/** Recommended assenza subtypes (mirror of backend ASSENZA_SUBTYPES). */
export const ASSENZA_SUBTYPE_LABEL: Record<string, string> = {
  lutto: 'Lutto',
  donazione_sangue: 'Donazione sangue',
  permesso_studio: 'Permesso studio',
  permesso_elettorale: 'Permesso elettorale',
  matrimonio: 'Matrimonio',
  allattamento: 'Allattamento',
  congedo_parentale: 'Congedo parentale',
  legge_104: 'Legge 104',
  assemblea_sindacale: 'Assemblea sindacale',
  visita_medica: 'Visita medica',
  motivi_personali: 'Motivi personali',
};

export function leaveTypeLabel(type: string): string {
  return (LEAVE_TYPE_LABEL as Record<string, string>)[type] ?? type;
}

export function leaveTypeColor(type: string): string {
  return (LEAVE_TYPE_COLOR as Record<string, string>)[type] ?? '#64748b';
}

export function assenzaSubtypeLabel(subtype: string | null | undefined): string {
  if (!subtype) return 'Assenza';
  return ASSENZA_SUBTYPE_LABEL[subtype] ?? subtype;
}
