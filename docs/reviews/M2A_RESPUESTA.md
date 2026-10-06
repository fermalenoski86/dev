# Milestone 2A — TRUST CONTROL — entrega

**237 tests (antes 159). `install --frozen-lockfile`, `verify` y `build` con
exit 0. Salida textual en `M2A_SALIDA.txt`.**

Cero cambios en `show-engine`, `timeline`, `trust-3d`, `shared-types` y
`apps/previs`. PREVIS V3.1 queda intacto.

---

## Resultados reales

```
pnpm install --frozen-lockfile   [exit 0]   lockfile único, 1 documento YAML
pnpm verify                      [exit 0]   237 passed · lint limpio · 7 typechecks limpios
pnpm build                       [exit 0]   previs ✓ 4/4 · control ✓ 4/4
mutation-check                   22/22 reglas críticas atrapadas
smoke test control (:3001)       GET / → 200 · "MASTER OF TRUST — Control Center"
```

## Qué se agregó

| | Qué hace |
|---|---|
| `packages/telemetry` | Contrato `ElectricalTelemetry`, simulador determinista, 6 escenarios, motor de alarmas, `TelemetryProvider` |
| `packages/control-core` | Estado de 9 subsistemas, 5 modos, event log unificado, `AiContextBuilder`, `MockAiAssistant` |
| `apps/control` | Next en :3001 — OVERVIEW / ENERGY / EVENTS / AI |

## Las cuatro decisiones que importan

### 1. La telemetría simulada es función pura del tiempo (ADR-016)

`sampleTelemetry(seed, escenario, t)` no acumula estado. Es ADR-001 aplicado a
datos eléctricos.

No es purismo. Un simulador con estado genera la serie histórica por un camino y
el valor en vivo por otro, y tarde o temprano **el gráfico de 24 h contradice al
número grande**. En un panel de operación eso no es cosmético: destruye la
confianza en todo lo demás que el panel muestra, incluido lo correcto.

Hay un test que verifica punto por punto que la serie de tendencias sea
literalmente el mismo muestreo que la lectura en vivo.

### 2. El simulador no decide alarmas (ADR-017)

`sampleTelemetry` devuelve siempre `status: 'normal'`. Evaluar es trabajo de
`evaluateAlarms(telemetría, umbrales, specs)`.

Si el simulador marcara las alarmas, testear el evaluador sería verificar que el
generador coincide consigo mismo. Separados, **es el mismo evaluador que va a
correr contra datos reales**: pasar de simulador a Modbus no toca una línea de
lógica de alarmas.

### 3. "Advisory only" se sostiene con tipos, no con un comentario (ADR-018)

`AiContext` es solo datos: sin funciones, sin handles, sin referencias a
`ShowEngine` ni al provider. Un test serializa el contexto entero y verifica que
sobreviva `JSON.parse(JSON.stringify(...))`. `AiAnswer` tiene `text`,
`usedFields`, `simulated` y `advisoryOnly: true` — no hay campo por el cual una
respuesta pueda expresar una acción, ni quien la ejecute.

Para que la IA pudiera accionar algo, alguien tendría que **agregar el tipo que
lo permita**: una decisión visible en un diff, no un accidente.

### 4. El provider Modbus falla ruidosamente (ADR-019)

`ModbusTelemetryProvider` existe como tipo pero su constructor lanza error.
Devolver ceros plausibles hasta implementarlo es la forma más rápida de que
alguien mire un panel y crea que el edificio está medido cuando no lo está. Un
dato eléctrico falso presentado como real es peor que la ausencia de dato.

La bandera `simulated` es obligatoria en el schema: no se puede omitir por
olvido, y un test lo verifica.

## Detalles de diseño que quizás no se ven

- **Una pantalla en negro por decisión del show NO es falla.** Está haciendo lo
  que se le pidió. Lo que sí es falla es un clip que no carga. Confundirlas
  llena el panel de falsos positivos y a la semana nadie los mira.
- **Pérdida de fase se reporta como `PHASE_LOSS`, nunca como subtensión
  crítica.** Confundirlas manda al operador a buscar el problema donde no está.
- **Una alarma genera un evento cuando aparece, no uno por muestra.** Sin eso el
  log sumaría 3600 entradas por hora y dejaría de servir.
- **La curva de carga tiene pico nocturno**, no diurno: un edificio DOOH no
  consume como una oficina. Testeado.
- **El desequilibrio usa la definición NEMA**, la misma que muestran los
  analizadores comerciales. Con otra fórmula, el panel no coincidiría con el
  display del equipo cuando se conecte.
- **Los campos de calidad de energía son nullable** y la UI muestra `n/d`. Un
  cero se lee como "medido y da cero".
- **El selector de escenario solo existe con `NODE_ENV !== 'production'`.** Un
  operador no tiene por qué poder cambiar lo que "mide" el sistema.

## Mutation check

Se agregaron 8 reglas nuevas al `scripts/mutation-check.py`: determinismo del
simulador, bandera `simulated`, prioridad de `PHASE_LOSS`, umbrales
configurables, serie == lectura viva, clip caído crítico, offline ≠ safe mode, y
contexto de IA sin handles.

**Encontró un hueco real:** mi test de "umbrales configurables" solo ejercitaba
la rama crítica, así que el umbral de *advertencia* podía estar hardcodeado sin
que ningún test se enterara. Agregué el caso. Resultado final: 22/22.

## Pendientes

### No entregado: screenshots

**No tengo navegador en este entorno.** No hay Chromium ni Playwright, y los
binarios no se descargan desde los registros npm a los que tengo acceso. Verifiqué
build, servidor levantado y que sirva la página y los shows, pero nadie vio la
interfaz renderizada.

Se abre con `pnpm --filter @trust/control dev` → `localhost:3001`.

### Antes de conectar el analizador

1. **Elegir el modelo.** Define qué campos de calidad de energía existen.
2. **Mapa de registros**: direcciones, escalas, endianness.
3. **Umbrales reales.** Los de `DEMO_THRESHOLDS` son de demostración.
4. **Datos de placa reales.** Hoy se asume 230 V, 50 Hz, 125 A por fase, 75 kW
   contratados. Ninguno confirmado.
5. **Histéresis y temporización**, para no disparar por transitorios de 200 ms.
6. **Persistencia.** Sin ella no hay comparativo contra ayer — el asistente lo
   dice explícitamente en vez de inventar el dato.

### Del milestone anterior, todavía abierto

- Prueba visual de PREVIS en Chrome/Edge (frame-lock A+B, deriva de media).
- Confirmación del integrador sobre si la horizontal comparte procesador con A y B.
- GLB + `TRUST_GEOMETRY_SPEC` del Digital Twin real.

## No implementado, por alcance

Modbus real, DMX, Art-Net, NovaStar, Brompton, Colorlight, control de
contactores, API de reloj, cámaras IP, analytics de audiencia, IA con capacidad
de ejecución, deployment cloud y autenticación empresarial.
