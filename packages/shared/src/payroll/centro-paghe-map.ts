// Centro Paghe giustificativo mapping: sonoQui internal leave kinds → Centro
// Paghe giustificativo codes (see centro-paghe-codes.ts for the dictionary).
//
// The map is stored per tenant on tenants.cp_giustificativo_map (jsonb). At
// read time it is merged over CENTRO_PAGHE_DEFAULT_MAP so a tenant that never
// touched a row still gets a sensible default. The stored/default value is the
// 2-char INP code; the export writer resolves it to the 2- or 4-char form per
// tenants.cp_code_len.

import { CENTRO_PAGHE_BY_INP, type CentroPagheCode } from './centro-paghe-codes.js';

/** Worked ordinary hours: the ORE LAVORATE field (record 1) + the OL total
 *  (record 2). Not part of the editable map — it is structural. */
export const CENTRO_PAGHE_WORKED_INP = 'OL';
/** Theoretical hours total (record 2, special code OT — not in the dictionary). */
export const CENTRO_PAGHE_THEORETICAL_CODE = 'OT';

/** Editable mapping rows shown in Impostazioni, in display order. `i18nKey`
 *  resolves to settings:centroPaghe.mapKey.<i18nKey>. */
export const CENTRO_PAGHE_MAP_KEYS: ReadonlyArray<{ key: string; i18nKey: string }> = [
  { key: 'ferie', i18nKey: 'ferie' },
  { key: 'permessi', i18nKey: 'permessi' },
  { key: 'malattia', i18nKey: 'malattia' },
  { key: 'straordinario', i18nKey: 'straordinario' },
  { key: 'chiusura', i18nKey: 'chiusura' },
  { key: 'assenza:donazione_sangue', i18nKey: 'donazione_sangue' },
  { key: 'assenza:legge_104', i18nKey: 'legge_104' },
  { key: 'assenza:lutto', i18nKey: 'lutto' },
  { key: 'assenza:permesso_studio', i18nKey: 'permesso_studio' },
  { key: 'assenza:permesso_elettorale', i18nKey: 'permesso_elettorale' },
  { key: 'assenza:matrimonio', i18nKey: 'matrimonio' },
  { key: 'assenza:allattamento', i18nKey: 'allattamento' },
  { key: 'assenza:congedo_parentale', i18nKey: 'congedo_parentale' },
  { key: 'assenza:assemblea_sindacale', i18nKey: 'assemblea_sindacale' },
  { key: 'assenza:visita_medica', i18nKey: 'visita_medica' },
  { key: 'assenza:motivi_personali', i18nKey: 'motivi_personali' },
] as const;

/** Seed defaults (2-char INP codes). Confirmed against the CP dictionary; the
 *  admin can override any row in Impostazioni. `chiusura` is intentionally
 *  empty — it is CCNL-dependent, so the admin must pick one (an empty mapping
 *  drops the giustificativo rather than guessing). */
export const CENTRO_PAGHE_DEFAULT_MAP: Readonly<Record<string, string>> = {
  ferie: 'FE', // FERI — Ferie
  permessi: 'RZ', // PAR — Permessi annui retribuiti
  malattia: 'MA', // MAL — Malattia
  straordinario: 'SD', // SD — Straordinario diurno
  chiusura: '', // admin must choose (CCNL-dependent)
  'assenza:donazione_sangue': 'DS', // DON — Donazione sangue
  'assenza:legge_104': 'M7', // MA7 — L.104 art.33 c.3
  'assenza:lutto': 'LP', // PMLU — Permesso per lutto
  'assenza:permesso_studio': 'PS', // PMST — Permesso di studio
  'assenza:permesso_elettorale': 'PZ', // PMEL — Permesso elezioni
  'assenza:matrimonio': 'CD', // CMT1 — Congedo matrimoniale
  'assenza:allattamento': 'AM', // ALLM — Ore allattamento
  'assenza:congedo_parentale': 'M0', // MA0 — Congedo parentale art.32
  'assenza:assemblea_sindacale': 'AS', // ASSE — Assemblea
  'assenza:visita_medica': 'VM', // PMCM — Permesso cure mediche
  'assenza:motivi_personali': 'PN', // PMNR — Permesso non retribuito
};

/** The map key for a leave row. `assenza` rows key on their subtype. */
export function centroPagheKeyForLeave(
  type: string,
  subtype?: string | null
): string {
  if (type === 'assenza' && subtype) return `assenza:${subtype}`;
  return type;
}

/** Merge a stored (partial) map over the defaults. */
export function effectiveCentroPagheMap(
  stored: Record<string, string> | null | undefined
): Record<string, string> {
  return { ...CENTRO_PAGHE_DEFAULT_MAP, ...(stored ?? {}) };
}

export interface ResolvedCode {
  /** Export form (2- or 4-char) for the giustificativo CODE field. */
  code: string;
  /** Description for record-2 DESCR (max 30 bytes). */
  descr: string;
}

/** Resolve an INP code to its export form for the given code length. Returns
 *  null for an empty/unknown code (caller should skip the giustificativo). */
export function resolveInpCode(inp: string, codeLen: 2 | 4): ResolvedCode | null {
  if (!inp) return null;
  const entry: CentroPagheCode | undefined = CENTRO_PAGHE_BY_INP[inp];
  if (!entry) return null;
  return { code: codeLen === 4 ? entry.out : entry.inp, descr: entry.descr };
}
