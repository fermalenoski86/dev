# Protocolo de trabajo: Claude + ChatGPT

Dos modelos escribiendo sobre los mismos archivos no es colaboración, es un
conflicto de merge con pasos extra. Dos modelos con roles distintos sí sirve,
porque el segundo par de ojos es el que encuentra lo que el primero dio por
sentado.

La división que propongo no es por tema sino por **función**.

## Roles

### Claude — implementación
- Escribe el código del monorepo.
- Mantiene los contratos (`shared-types`) y el motor (`show-engine`, `timeline`).
- Escribe los tests.
- Es el único que hace commits sobre `packages/` y `apps/`.

### ChatGPT — adversario técnico y exploración
- Revisa lo que Claude escribió **buscando romperlo**, no buscando aprobarlo.
- Explora alternativas de stack, de hardware y de contenido.
- Redacta lo que va a leer gente que no es técnica: propuestas de marca, pliegos,
  documentación comercial.
- Investiga protocolos específicos (Art-Net, sACN, APIs de procesadores LED).

La regla: **ChatGPT propone, Claude implementa.** Si ChatGPT genera código, entra
como propuesta en `docs/proposals/`, no como commit directo.

## Por qué así

El riesgo real de este proyecto no es escribir mal una función. Es tomar una
decisión de arquitectura a las tres semanas que a los seis meses te cuesta
rehacer todo. Para eso sirve un revisor que no esté enamorado del código que ya
escribió — y un modelo que no escribió el código no lo está.

## Ciclo de trabajo

1. **Definir** el milestone (vos).
2. **Implementar** (Claude): código + tests + doc corta del módulo.
3. **Auditar** (ChatGPT): se le pasa el diff o los archivos con el prompt de abajo.
4. **Resolver** (vos + Claude): qué observación entra y qué se descarta, con motivo.
5. **Cerrar**: actualizar `docs/architecture/DECISIONS.md`.

## Prompt de auditoría para ChatGPT

> Sos revisor técnico senior de TRUST PLATFORM, la plataforma de control de un
> edificio con pantallas LED y luz arquitectónica frente al Obelisco, Buenos Aires.
>
> Te paso código ya implementado. Tu trabajo NO es reescribirlo ni elogiarlo.
> Tu trabajo es encontrar en qué se rompe.
>
> Enfocate en:
> 1. Determinismo: ¿hay algún caso donde `resolveStateAt(t)` dé dos resultados
>    distintos para la misma `t`?
> 2. Casos borde no cubiertos por los tests.
> 3. Supuestos implícitos que no están documentados.
> 4. Qué de esto va a doler cuando haya que ejecutar contra hardware real
>    (Art-Net/DMX, procesadores LED, sincronía entre pantallas).
> 5. Riesgos de seguridad según `docs/cybersecurity/PRINCIPLES.md`.
>
> Devolvé una lista priorizada: severidad, archivo, línea, qué rompe y cómo
> reproducirlo. Si algo está bien, no lo menciones.

## Qué NO delegar a ningún modelo

- La geometría real del edificio. Eso sale de relevamiento, no de una estimación.
- Las especificaciones eléctricas y de montaje.
- Las normativas municipales de contaminación lumínica y publicidad en vía pública.
- La relación con los proveedores de LED.

En todos esos casos, lo que salga del modelo es una hipótesis para verificar con
alguien que firme.

## Contexto para compartir entre ambos

Cuando arranques una sesión con cualquiera de los dos, pasale:
- `MASTER_PROMPT_CLAUDE_v1.md`
- `docs/architecture/OVERVIEW.md`
- `docs/architecture/DECISIONS.md`
- los archivos puntuales en discusión

No hace falta el repo entero. Menos contexto irrelevante = respuestas más
precisas y menos consumo de límite de uso.
