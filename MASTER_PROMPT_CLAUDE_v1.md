# TRUST PLATFORM — MASTER PROMPT v1 para Claude

## Rol
Actuá como arquitecto de software senior + desarrollador full-stack + especialista en sistemas audiovisuales para construir **TRUST PLATFORM**, la plataforma propia del proyecto **EL TRUST — Buenos Aires**.

El objetivo no es hacer una demo genérica. Estamos construyendo un sistema modular, mantenible y seguro que primero funcionará como **digital twin / previs** del edificio y luego evolucionará para operar el edificio real.

## Contexto del proyecto
EL TRUST es un edificio emblemático frente al Obelisco, Buenos Aires. Queremos integrarlo como una experiencia urbana compuesta por:

- Pantalla superior A
- Pantalla superior B
- Pantalla horizontal existente
- Iluminación arquitectónica cálida
- Iluminación dinámica RGBW
- Cúpula
- Reloj
- Escenas sincronizadas
- Takeovers de marcas
- Contenido 3D/anamórfico
- Analytics de audiencia
- Calendario de campañas
- Seguridad, logs y monitoreo

La plataforma tendrá 3 productos relacionados:

1. **TRUST PREVIS** — digital twin para previsualizar campañas y takeovers antes de publicarlos.
2. **TRUST CONTROL** — panel operativo para programar y ejecutar escenas en el edificio real.
3. **TRUST EDGE** — servicio local instalado físicamente en el edificio que ejecutará shows y hablará con hardware real.

En esta primera etapa SOLO construiremos **TRUST PREVIS MVP**. No implementar todavía control real de hardware.

## Geometría inicial conocida
Usar valores configurables, no hardcodeados dentro de componentes visuales.

Pantalla A:
- pixel pitch: P6.67
- tamaño físico: 9.60 m × 3.84 m
- resolución objetivo aproximada: 1440 × 576 px

Pantalla B:
- pixel pitch: P6.67
- tamaño físico: 9.60 m × 3.84 m
- resolución objetivo aproximada: 1440 × 576 px

Pantalla horizontal:
- dimensiones reales todavía no cerradas
- crearla como superficie configurable

Iluminación:
- aproximadamente 78 luminarias como referencia
- NO modelarlas individualmente todavía
- trabajar inicialmente con 10–12 zonas lógicas

Cámaras virtuales iniciales:
- HERO_OBELISCO
- HERO_3D
- STREET_CORRIENTES

## Principio central
El mismo **SHOW PACKAGE** deberá ser reproducible por PREVIS hoy y por CONTROL/EDGE en el futuro.

No crear lógica de show específica dentro de la UI. El comportamiento debe residir en un motor reutilizable.

## Stack propuesto
Usar:

- pnpm
- monorepo
- TypeScript estricto
- Next.js (App Router)
- React
- React Three Fiber
- Three.js
- Zustand para estado local de PREVIS
- Zod para validar contratos y show packages
- Tailwind para interfaz
- Vitest para unit tests
- Playwright para e2e más adelante
- ESLint + Prettier

No agregar backend todavía salvo que sea estrictamente necesario para el MVP.

## Estructura del repositorio
Crear una estructura preparada para crecer:

```text
trust-platform/
  apps/
    previs/
    control/          # placeholder futuro
    api/              # placeholder futuro

  packages/
    show-engine/
    trust-3d/
    timeline/
    shared-types/

  edge/
    trust-edge/       # placeholder futuro

  assets/
    models/
    textures/
    demo-content/

  docs/
    architecture/
    protocols/
    cybersecurity/
    hardware/
```

No crear complejidad vacía. Los paquetes futuros pueden tener README placeholder hasta que se implementen.

## Reglas de arquitectura

1. **Separar modelo, motor y UI.**
2. Ningún componente React debe contener lógica crítica de timeline.
3. Las superficies del edificio deben tener IDs estables.
4. Las zonas de iluminación deben ser entidades reutilizables.
5. El timeline debe ser determinista.
6. El tiempo debe expresarse internamente en milisegundos.
7. El motor debe poder reproducir, pausar, seekear y resetear.
8. PREVIS no debe depender de ningún controlador LED real.
9. El sistema debe funcionar completamente offline en esta etapa.
10. Nada de credenciales, endpoints o secretos hardcodeados.

## Modelo conceptual mínimo

### ScreenSurface
Debe incluir:
- id
- name
- physicalWidthM
- physicalHeightM
- pixelWidth
- pixelHeight
- mediaSource opcional
- enabled

IDs iniciales:
- screen_a
- screen_b
- horizontal

### LightingZone
Debe incluir:
- id
- name
- intensity: 0..1
- color RGBW
- enabled
- meshIds o targetIds

Zonas iniciales sugeridas:
- dome
- clock
- tower_upper
- tower_mid
- corrientes_left
- corrientes_right
- chamfer
- pellegrini_left
- pellegrini_right
- arches_upper
- arches_lower
- base

### CameraPreset
- id
- name
- position
- target
- fov

IDs:
- hero_obelisco
- hero_3d
- street_corrientes

## SHOW PACKAGE v1
Definir el contrato con Zod y TypeScript.

Ejemplo conceptual:

```yaml
id: mcdonalds_takeover_001
name: McDonald's Takeover Demo
version: 1
durationMs: 30000

media:
  screen_a: /demo/mcd_a.mp4
  screen_b: /demo/mcd_b.mp4
  horizontal: /demo/mcd_horizontal.mp4

initialState:
  lightingScene: trust_normal
  clockState: normal

timeline:
  - atMs: 3000
    type: media.play
    target: horizontal

  - atMs: 5000
    type: media.play
    target: screen_a

  - atMs: 5000
    type: media.play
    target: screen_b

  - atMs: 7000
    type: lighting.scene
    value: mcd_red_gold

  - atMs: 25000
    type: lighting.scene
    value: trust_normal
```

## Tipos de evento iniciales
Implementar solamente:

- media.play
- media.pause
- media.seek
- media.stop
- lighting.scene
- lighting.zone.set
- clock.state
- camera.switch

Diseñarlos para que luego puedan agregarse:
- external.trigger
- artnet.scene
- led.processor.command
- analytics.marker

pero NO implementarlos aún.

## Escenas de iluminación demo
Crear:

### trust_normal
- cálida
- elegante
- baja saturación
- cúpula y reloj destacados

### mcd_red_gold
- rojo y dorado controlado
- no convertir el edificio en una discoteca
- iluminación acompañante, nunca compitiendo con las pantallas

### safe_mode
- pantallas lógicamente detenidas o en estado neutro
- iluminación cálida segura
- reloj normal

## TRUST PREVIS MVP — objetivos funcionales

La primera versión debe permitir:

1. Abrir una escena 3D del edificio simplificado.
2. Visualizar 3 superficies de pantalla.
3. Asignar video o imagen demo a cada pantalla.
4. Reproducir las 3 superficies sincronizadas.
5. Ver iluminación por zonas.
6. Cambiar entre las 3 cámaras predefinidas.
7. Cargar un SHOW PACKAGE JSON local.
8. Reproducir el timeline.
9. Play / Pause / Stop / Seek.
10. Mostrar el tiempo actual del show.
11. Cambiar manualmente una LightingZone.
12. Ejecutar escenas trust_normal / mcd_red_gold / safe_mode.
13. Mostrar en UI el estado de cada pantalla y zona.

## Primera interfaz
Layout desktop first.

- Panel central grande: viewport 3D
- Panel derecho: propiedades / pantallas / luces
- Barra inferior: timeline
- Barra superior: show actual + Play/Pause/Stop + cámara activa

No dedicar tiempo todavía a diseño visual premium. Primero funcionalidad limpia.

## Digital Twin
Para el MVP NO intentar una réplica hiperrealista.

Construir:
- masa arquitectónica simplificada
- esquina/ochava
- torre/cúpula simplificada
- dos pantallas superiores correctamente diferenciadas
- pantalla horizontal
- zonas de iluminación visibles
- un Obelisco simplificado como referencia espacial

Toda la geometría debe ser reemplazable más adelante por GLB/GLTF real.

## 3D anamórfico
No implementar corrección anamórfica completa todavía.

Pero:
- preparar `hero_3d` como cámara fija
- permitir que screen_a y screen_b reproduzcan videos distintos perfectamente sincronizados
- documentar que en una fase posterior agregaremos pipeline de contenido anamórfico generado para esa cámara

## Calidad y pruebas
Necesito:

- TypeScript strict
- evitar `any`
- Zod en entradas de archivos JSON
- tests para show-engine
- tests para timeline reducer/engine
- tests de seek determinista
- tests de eventos simultáneos
- documentación corta de cada módulo

## Seguridad desde el diseño
Aunque PREVIS no controle hardware todavía:

- ninguna API de hardware en frontend
- separar conceptualmente control cloud de TRUST EDGE
- documentar que hardware real será accesible únicamente desde red local del edificio
- futuro acceso remoto vía VPN/ZTNA + MFA
- TRUST EDGE deberá soportar operación offline
- SAFE MODE será una primitive del sistema

Crear `docs/cybersecurity/PRINCIPLES.md` con estos principios.

## Lo que NO debes hacer todavía

- No Art-Net real
- No DMX real
- No API NovaStar/Brompton/Colorlight
- No control de relés
- No cámaras IP reales
- No analytics reales
- No autenticación empresarial
- No cloud deployment
- No sistema de pagos
- No programmatic DOOH
- No app móvil

Primero queremos probar el concepto completo de PREVIS.

## Milestone 1
El resultado que quiero al finalizar este milestone es:

1. Ejecutar `pnpm install`.
2. Ejecutar `pnpm dev`.
3. Abrir TRUST PREVIS en navegador.
4. Ver una maqueta simplificada de EL TRUST.
5. Ver las 3 pantallas.
6. Seleccionar un demo show.
7. Presionar PLAY.
8. Ver las pantallas y luces cambiar según el timeline.
9. Hacer seek hacia adelante y atrás de forma correcta.
10. Cambiar entre HERO_OBELISCO, HERO_3D y STREET_CORRIENTES.

## Forma de trabajo
No generes todo el proyecto de una sola vez sin explicar decisiones.

Primero:
1. inspeccioná el repo actual;
2. proponé plan de implementación de Milestone 1;
3. indicá supuestos;
4. luego empezá a crear/modificar archivos;
5. corré tests y build;
6. corregí errores;
7. al terminar, resumí exactamente qué quedó funcionando y qué queda pendiente.

Si una decisión no está definida, priorizá:
- modularidad
- simplicidad
- estándares abiertos
- futura operación offline
- futura integración segura con hardware

No cambies la arquitectura tecnológica sin justificarlo explícitamente.

## Criterio visual de EL TRUST
La tecnología debe habilitar una estética sofisticada.

Evitar como filosofía de producto:
- flashing constante
- arcoíris permanente
- efectos tipo discoteca
- movimientos agresivos sin propósito

Priorizar:
- fades
- respiraciones lentas
- barridos arquitectónicos
- sincronía con contenido
- iluminación cálida como estado base
- RGBW como acento y takeover

## Primera tarea AHORA
Implementá **Milestone 1**.

Empezá respondiendo solamente con:

1. arquitectura que vas a crear;
2. archivos/carpetas principales;
3. dependencias necesarias;
4. plan de trabajo en pasos;
5. riesgos técnicos que ves.

Después de ese resumen, empezá la implementación sin esperar otra confirmación, salvo que el entorno esté roto o falte una dependencia esencial imposible de resolver localmente.
