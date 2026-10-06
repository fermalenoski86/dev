# M2C.2.1 — Executive Visual Release

**512 tests · mutation check 88/88 · E2E real 7 passed / 0 failed ·
artefactos intactos.**

Gate completo en orden. Salida en `M2C21_SALIDA.txt`, capturas y video en
`docs/screenshots/`.

---

## Lo que cambió de fondo

### 1 · Fotografías reales del edificio

Los masters salen de las fotos nocturnas provistas. `hero-corner` y las dos
vistas de fachada vienen de la toma de la ochava; `obelisco-wide`, del plano
general desde la 9 de Julio. Procesadas a 2560 px con reducción de ruido,
nitidez y exposición corregida.

**Las coordenadas están MEDIDAS sobre la foto**, con grilla, no estimadas. Los
dos segmentos de la pantalla horizontal calzan sobre la banda que ya existe.

La ubicación de las pantallas superiores sale del video de presentación
provisto: la banda que envuelve la esquina bajo la cúpula.

### 2 · Media real en las superficies

`SurfaceMediaRenderer` pinta el asset del ShowPackage, recortado por su
`uvRect`. Un `<video>` por fuente y un `<canvas>` por superficie: A y B
comparten decoder, que es lo que garantiza el frame-lock.

Con un `requestAnimationFrame` por superficie, A y B quedaban separadas por un
par de frames — el decoder es uno, pero el PINTADO también tiene que ser
simultáneo, o el contenido anamórfico se abre justo en la arista de la ochava.
Un loop compartido lo resolvió.

### 3 · Perspectiva, luz y reloj

Homografía a cuatro esquinas (ADR-031), encaje `contain` (ADR-032), segmentos
para la banda curva (ADR-033), capas de luz por zona y los cuatro estados de
reloj que el contrato soporta.

### 4 · Precarga honesta

`loaded` y `failed` separados (ADR-034). Un `onerror` ya no cuenta como
cargado, y si falta el Hero Corner no hay READY.

### 5 · DEMO CHECK y respaldo

Ocho pruebas **reales** contra los archivos locales, no contra un estado en
memoria. `PRESENTATION READY` solo si pasa todo lo requerido. El respaldo es un
MP4 local de 15 s que existe de verdad, con test que lo verifica (ADR-035).

### 6 · Copy

Se fue «la esquina más vista del país». Hay tests que impiden que vuelva
cualquier superlativo o número sin fuente.

---

## Lo que encontró el proceso

**Un mutante sobrevivió:** `canStop` mutado a `state.phase !== 'LOADING'` no lo
agarraba ningún test. Hueco real — durante la precarga `canPlay` es false y la
tentación es deshabilitar todo el transporte, pero si algo quedó sonando de una
corrida anterior, STOP es lo único que lo corta. Cubierto en los cinco estados,
con y sin cinema, y con cero assets cargados.

**Typecheck roto en los tests nuevos.** `vitest` pasaba porque esbuild borra
tipos; `pnpm verify` no. Ocho errores corregidos.

**Los clips de demo duran menos que el show.** A los 12 s las pantallas quedaban
en negro. Se cicla el clip **en el preview**, y está anotado como lo que es: si
un clip real es más corto que su momento, eso es un problema del show y lo
resuelve el Builder, no el renderer.

---

## Resultados

```
1. pnpm install --frozen-lockfile   [exit 0]
2. pnpm verify                      [exit 0]   512 passed
3. pnpm build                       [exit 0]   previs ✓ · control ✓
4. mutation-check                   88/88 · artefactos OK (md5)
5. pnpm e2e                         7 passed · 0 failed
6. pnpm verify (cierre)             [exit 0]   512 passed
```

## Entregables visuales

`hero-normal`, `hero-brand-reveal`, `hero-full-takeover`, `hero-signature`,
`corrientes`, `pellegrini`, `end-card`, más `demo-check` y `backup-player`.
Video: `recorrido-15s.mp4`.

---

## Tres decisiones que quedan del lado del negocio

1. **Fotos nocturnas de cada fachada.** Las vistas laterales siguen siendo
   recortes del plano de la esquina. Las diurnas provistas sirvieron para
   entender la geometría, pero un viraje día-noche sobre sol de mediodía se lee
   como foto de día oscurecida: las sombras están grabadas en la imagen.

2. **Proporciones de la banda superior.** En el video se ve cerca de 3,5:1; las
   medidas confirmadas en M2C.1 dan 2:1 (7,68 × 3,84 m) y 2,5:1 (9,60 × 3,84 m).
   El cliente va a leer la imagen como el tamaño real de lo que compra.

3. **El Signature en negro.** A los 12 s el show manda negro a las tres
   superficies. Es correcto según el preset, pero en pantalla se lee como «se
   apagó», no como intención.

## Fuera de alcance, sin tocar

GLB, 3D, backend, cloud, login, hardware, Modbus, DMX, Art-Net.
