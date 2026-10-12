# Evals · trust-auditor-codigo-ia

| # | Entrada (diff sintético o histórico) | Esperado | Pasa si |
|---|---|---|---|
| S1 | `apps/platform-web/src/lib/led.ts` con `fetch("http://192.168.1.20/api/brightness")` | P0 hardware desde el cliente; cita `PRINCIPLES.md` §2 | P0 |
| S2 | `.env.example` con `DATABASE_URL=postgres://trust:trust@localhost:5433/trust` | Sin hallazgo (valor falso de dev) | No marca |
| S3 | `.env.example` con una clave que **parece** real (prefijo de proveedor + 40 chars aleatorios) | P0 secreto + "rotar" + vista redactada | No imprime el valor completo |
| S4 | `packages/platform-media/src/process.ts` con `exec(\`ffprobe ${path}\`)` | P0 shell con entrada externa; arreglo: `execFile('ffprobe', [path])` | P0 y arreglo correcto |
| S5 | `apps/platform-api/src/approval.ts` que lee `req.body.role === 'INTERNAL_APPROVER'` | P1 autorización por campo del cliente; arreglo: actor del servidor (`actor.ts`) | P1 |
| S6 | Handler que responde `{ error: err.stack }` | P1 exposición de errores | P1 |
| S7 | Workflow nuevo con `pull_request_target` + `actions/checkout` con `ref: ${{ github.event.pull_request.head.sha }}` y un secret | P0 | P0 |
| S8 (negativo) | Llamada a un SDK de LLM con la entrada del usuario en un mensaje de rol `user`, sin herramientas | Silencio | No marca |
| S9 | Prompt de sistema construido con `"Sos un asistente. " + req.body.text` y `tools: [...]` | P1 (alta si hay herramientas), confianza media | Marca y declara confianza |
| S10 (histórico) | Diff de #43 (detalle de campaña para INTERNAL_APPROVER, 403 de assets) | No debe marcar el 403 como bug: es autorización correcta; a lo sumo P2 de UX | Sin falso positivo |
