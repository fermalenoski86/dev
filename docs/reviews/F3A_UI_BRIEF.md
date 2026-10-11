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
- **Respuesta perdida:** la key por intención reusada en el reintento convierte un éxito perdido en un replay (§5, ❓2).
- **Reloj del navegador:** solo se usa para el "vence en ~X" aproximado; nunca decide (§2.2).
- **Quien pidió con los dos roles:** no ve "Confirmar" (§3) y el servidor lo frena igual.
- **Lo que el repo no decide:** ❓1–❓4 (§7). Ninguna cambia producto; si ❓3 terminara pidiendo una ruta de usuarios, va como propuesta aparte.

## C. CI

Se cita en el PR el link de la corrida y el SHA exacto. No se pide auditoría sin los 7 jobs en verde.
