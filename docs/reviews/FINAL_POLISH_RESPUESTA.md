# Final Executive Polish — entrega

**524 tests · mutation check 94/94 · E2E 11/11 · verify limpio · ejemplos intactos.**

- Creatividad de campaña en Client Mode, sin tocar ShowPackage (ADR-036).
- Client Mode / Operator Mode (ADR-037).
- Copy: «3 superficies digitales · un momento sincronizado»; WHY = LOCATION / IMPACT / PLATFORM; nada vende iluminación ni reloj como instalados.
- Hero 16:9 sin tocar la geometría aprobada (ADR-038).
- Respaldo y recorrido de 15 s renderizados (ADR-039).
- Capturas 1920×1080: client-home, hero-before, hero-brand-reveal, hero-full-takeover, hero-signature, end-card, how-it-works, demo-check, más hero-16x9-takeover y hero-16x9-signature.

Hallazgos del proceso: dos reglas de mutación apuntaban a coordenadas viejas de
las pantallas y no protegían nada (corregidas); el preset ya mantenía las
pantallas en Signature, el negro anterior era el bug de dibujo.

Pendiente fuera de este pedido: HOW IT WORKS todavía muestra iluminación y
reloj como subsistemas simulados; el brief anterior pedía presentarlos como
«NEXT PHASE / READY FOR INTEGRATION».
