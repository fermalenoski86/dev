import type { Role } from '@trust/platform-db';
import type { Principal } from './sessions';

/**
 * Autorización server-side — §22, §23, §24.
 *
 *   · `hasAnyRole`: la ruta declara qué roles la habilitan; nada de lo que mande
 *     el cliente cambia el resultado.
 *   · Scope por contrato (§24): los roles INTERNOS (OPERATOR, INTERNAL_APPROVER,
 *     ADMIN) alcanzan a todos los contratos del edificio; EXTERNAL_APPROVER
 *     solo a los contratos asociados Y habilitados (`Principal.externalContractIds`,
 *     derivado en el backend). El `contractId` del request solo se usa para
 *     preguntar, nunca para autorizar.
 */
export const INTERNAL_ROLES: readonly Role[] = ['OPERATOR', 'INTERNAL_APPROVER', 'ADMIN'];

export function hasAnyRole(p: Pick<Principal, 'roles'>, allowed: readonly Role[]): boolean {
  return allowed.some((r) => p.roles.has(r));
}

/**
 * ¿Puede el principal, con alguno de `allowed`, operar sobre `contractId`?
 * Un rol interno permitido alcanza a cualquier contrato; EXTERNAL_APPROVER
 * permitido solo a los suyos.
 */
export function canAccessContract(p: Principal, contractId: string, allowed: readonly Role[]): boolean {
  for (const r of allowed) {
    if (!p.roles.has(r)) continue;
    if (r !== 'EXTERNAL_APPROVER') return true;
    if (p.externalContractIds.includes(contractId)) return true;
  }
  return false;
}
