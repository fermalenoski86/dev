# F3(a) UI — brief: autorrevisión

**Rama:** `fase/f3a-ui-brief` desde `main@8fae6fe`. Solo documentación: no hay código, migraciones ni cambios de API.

## A. Contra el encargo del auditor (#56)

| Pedido | Dónde |
|---|---|
| Mostrar versión vigente, pedido/vencimiento e historial | §2 |
| Pedir/confirmar/cancelar según roles y cuatro ojos | §3 (con test del doble rol) |
| Tratar los conflictos | §4 (un 409 → mensaje + releer estado) |
| "Vigente administrativa" separada de despliegue físico | §0: texto siempre visible y mutación que lo esconde |
| Dependencia con #43 explícita, sin darla por resuelta | §1: página propia que no carga assets; funciona con las dos opciones de #43 |
| Sin Deploy/EDGE ni partes congeladas | §0 |

## B. Revisión adversaria

- **Confusión entre vigente y última aprobada:** se muestran por separado y con nombre (§2.1).
- **Un pedido viejo enviado desde una página vieja:** `expectedActiveVersionId` sale de lo que la página muestra, y el servidor responde 409 si cambió (§3, mutación).
- **Respuesta perdida o incierta:** la intención conserva key y payload exacto mientras el resultado sea incierto: red, cuerpo ilegible aunque el status sea 200, y 5xx (incluidos 502/504 de un intermediario). El reintento convierte un éxito perdido en un replay. Hay bloqueo de doble envío en vuelo y descarte solo ante un resultado definitivo o por decisión explícita del usuario (§5, ❓2).
- **Reloj del navegador:** solo se usa para el "vence en ~X" aproximado; nunca decide (§2.2).
- **Quien pidió con los dos roles:** no ve "Confirmar" (§3) y el servidor lo frena igual.
- **Lo que el repo no decide:** ❓1–❓4 (§7). Ninguna cambia producto; si ❓3 terminara pidiendo una ruta de usuarios, va como propuesta aparte.

## C. CI

Se cita en el PR el link de la corrida y el SHA exacto. No se pide auditoría sin los 7 jobs en verde.

## Ronda 1 — `AUDIT: CAMBIOS` sobre `e44b917`

1. **[P2] Descartar la key ante cualquier respuesta rompía el replay cuando el
   resultado era incierto.** Corregido en §5:
   - la intención guarda key y payload exacto;
   - se conserva ante red, cuerpo ilegible (`UNEXPECTED_RESPONSE`, aunque el
     status sea 200) y 5xx;
   - solo se descarta con un resultado definitivo (2xx o 4xx con cuerpo
     válido) o por decisión explícita del usuario;
   - hay bloqueo de doble envío;
   - el ciclo vale igual para pedir, confirmar y cancelar.

   Pruebas nuevas en §6.2 y §6.3 (con la API real, respuesta perdida y
   502/504 interpuesto, para las tres operaciones) y tres mutaciones nuevas en
   §6.5.
2. **§7:** ❓1, ❓3 y ❓4 quedan aceptadas tal como las cerró el auditor; ❓2,
   con el ajuste. Agregada la precisión sobre la reconstrucción de los pedidos
   por ids y paginación.
