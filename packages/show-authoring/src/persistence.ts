import { safeParseTakeoverDraft, type TakeoverDraft } from './draft-schema';

/**
 * PERSISTENCIA DEL DRAFT — M2C.1.1 / punto 3.
 *
 * ── La política, explícita ────────────────────────────────────────
 *
 * `loadPreset()` e `importDraft()` marcan el draft como **dirty**, y el
 * autosave lo persiste. Opción A del pedido.
 *
 * Por qué no guardar inmediatamente (opción B): guardar al instante pisaría el
 * draft anterior en el mismo acto de "ver cómo es este preset". El operador
 * todavía no decidió nada. Marcarlo sucio y dejar que el autosave actúe da el
 * mismo resultado —no se pierde trabajo— pero conserva el orden correcto:
 * primero se confirma que se descarta lo anterior, después se escribe.
 *
 * Antes, ambos dejaban `dirty: false`: el editor **parecía guardado sin
 * estarlo**, así que una recarga volvía al draft viejo sin ningún aviso.
 */

export const DRAFT_STORAGE_KEY = 'trust.builder.draft.v1';

/** Mínimo de localStorage. Permite testear sin navegador. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Storage en memoria, para tests y para cuando el navegador lo bloquea. */
export class MemoryDraftStorage implements DraftStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export function saveDraft(storage: DraftStorage, draft: TakeoverDraft): boolean {
  try {
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    // Sin storage el editor sigue andando; solo no persiste.
    return false;
  }
}

/**
 * Lee el último draft. Pasa por Zod SIEMPRE, incluso lo escrito por uno mismo:
 * el localStorage de ayer puede tener el formato de ayer.
 */
export function loadDraft(storage: DraftStorage): TakeoverDraft | null {
  try {
    const raw = storage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = safeParseTakeoverDraft(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type AdoptSource = 'preset' | 'import' | 'storage';

export interface AdoptResult {
  draft: TakeoverDraft;
  dirty: boolean;
  /** true si el autosave debería escribir ya. */
  autosave: boolean;
}

/**
 * Adopta un draft nuevo y devuelve el estado de persistencia que corresponde.
 *
 * - `preset` e `import`: sucio, y el autosave lo escribe. Reemplazan el trabajo
 *   anterior, así que el editor no puede decir que está guardado.
 * - `storage`: limpio. Es exactamente lo que hay en disco.
 */
export function adoptDraft(draft: TakeoverDraft, source: AdoptSource): AdoptResult {
  const desdeDisco = source === 'storage';
  return { draft, dirty: !desdeDisco, autosave: !desdeDisco };
}

/**
 * Si hay trabajo sin guardar, reemplazarlo pide confirmación — tanto al
 * importar como al elegir un preset.
 *
 * El selector de presets es un `<select>`: cambiarlo sin querer es trivial, y
 * antes se llevaba puesta la campaña sin preguntar nada.
 */
export function requiresDiscardConfirmation(current: { dirty: boolean }): boolean {
  return current.dirty;
}
