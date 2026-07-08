import type { ComponentType } from 'react';
import { IconHardHat } from '../components/icons.tsx';

// Central registry of the billable add-on modules the partner console manages.
// Everything in the UI iterates this list — the per-tenant activation dialog,
// the "Moduli" columns on both grids, the per-partner capability checkboxes —
// so nothing is hard-wired to a single module. Adding a module = one entry
// here + the matching backend flags/endpoint + a `modules.<key>.*` i18n block.
export interface ModuleDef {
  /** Stable module id. Also the i18n sub-key: `modules.<key>.name` / `.desc`. */
  key: string;
  /** Glyph shown beside the module in the activation dialog. */
  icon: ComponentType;
  /** TenantRow boolean field — is the module active on that tenant. Doubles as
   *  the create-tenant request field. */
  tenantField: string;
  /** Partner-capability field — may this partner enable the module at all. */
  capField: string;
  /** Per-tenant enable/disable endpoint (PATCH `{ enabled }`). */
  togglePath: (tenantId: string) => string;
}

export const MODULES: ModuleDef[] = [
  {
    key: 'cantieri',
    icon: IconHardHat,
    tenantField: 'cantieri_enabled',
    capField: 'may_enable_cantieri',
    togglePath: (id) => `/api/v1/partnership/tenants/${id}/cantieri`,
  },
];

/** Read a module boolean field off a tenant/partner row without threading each
 *  field name through the type system (the registry keys them by string). */
export function moduleFlag(obj: unknown, field: string): boolean {
  return Boolean((obj as Record<string, unknown> | null | undefined)?.[field]);
}
