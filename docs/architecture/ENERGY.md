# Módulo ENERGY — estado y alcance

> **⚠️ TODO DATO ELÉCTRICO DEL SISTEMA ES SIMULADO.**
> No hay analizador de red conectado. No hay Modbus. No hay medición.

## Qué existe hoy

| | Estado |
|---|---|
| Contrato `ElectricalTelemetry` (Zod) | ✅ definido |
| `SimulatedTelemetryProvider` | ✅ determinista, 6 escenarios |
| Motor de alarmas con umbrales configurables | ✅ 9 códigos |
| UI ENERGY: general, 3 fases, desequilibrio, tendencias, tabla de alarmas | ✅ |
| `ModbusTelemetryProvider` | ⛔ stub que lanza error a propósito (ADR-019) |
| Medición real | ⛔ no existe |
| Comandos sobre contactores | ⛔ fuera de alcance, y seguirá estándolo un tiempo |

## Por qué el contrato antes que el hardware

Si la forma del dato se define recién cuando llega el equipo, la UI termina
moldeada por el mapa de registros de un fabricante, y cambiar de analizador
obliga a rehacerla. Definirlo antes deja el modelo del analizador como una
decisión reversible.

Por eso todo lo de calidad de energía (`thdVoltagePercent`, `thdCurrentPercent`,
`powerFactor` por fase) es **nullable**: un analizador básico no los entrega y
uno de power quality sí. La UI muestra `n/d`, que es distinto de `0` — un cero
se lee como "medido y da cero".

## Flujo futuro

```
ANALIZADOR DE RED TRIFÁSICO
        ↓  Modbus RTU/TCP
    TRUST EDGE            ← acá vive la lectura, nunca en el navegador
        ↓  API
    TRUST CONTROL
```

## Frescura del dato (M2A.1)

La telemetría viaja en un sobre `TelemetrySample` con `measuredAt`,
`receivedAt`, `ageMs` y `quality` (LIVE / STALE / NO_DATA / COMM_ERROR). Ver
ADR-022.

Regla dura para cuando llegue Modbus: **si EDGE deja de recibir muestras, el
último valor NO se conserva aparentando estar al día.** Se muestra como "última
lectura" y el estado pasa a STALE o COMM_ERROR.

## Sobre `peakDemandKw` y `energyMonthKwh`

- `energyMonthKwh` usa el **mes calendario local real** (del día 1 a hoy en hora
  del sitio), con la cantidad de días que tenga ese mes.
- `peakDemandKw` es una **aproximación operativa**: el máximo de las muestras de
  15 minutos integradas. **No es la demanda máxima fiscal** de la
  distribuidora, que se calcula sobre ventanas definidas por el cuadro
  tarifario y es la que se factura. Sirve para operar, no para discutir una
  factura.

## Pendientes antes de conectar hardware

1. **Elegir el analizador.** Define qué campos de calidad de energía existen.
2. **Mapa de registros**: direcciones, escalas, endianness, tipo de dato.
3. **RTU sobre RS-485 o TCP**, según dónde quede el tablero.
4. **Umbrales reales.** Los de `DEMO_THRESHOLDS` son de demostración. Los
   definitivos salen del proyecto eléctrico.
5. **Datos de placa reales.** `DEMO_INSTALLATION` asume 230 V, 50 Hz, 125 A por
   fase y 75 kW contratados. Ninguno está confirmado.
6. **Histéresis y temporización** de alarmas, para no disparar por transitorios.
7. **Persistencia**, para comparar contra días anteriores. Hoy no existe.

## Lo que el módulo NO hace, y es deliberado

- No acciona contactores ni nada físico.
- No corta carga por demanda.
- No corrige factor de potencia.
- La IA no participa del lazo de seguridad (ADR-018).

Las alarmas **informan**. Cualquier actuación automática sobre una instalación
eléctrica es una decisión de ingeniería con implicancias de seguridad, y no se
implementa desde un panel web.
