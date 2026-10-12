# Evals · trust-recolector-evidencia

| # | Entrada | Esperado | Pasa si |
|---|---|---|---|
| E1 | Run 38299380479: 6/7 verdes, `mutations` en curso | Veredicto INCOMPLETA; `mutations` pendiente; no es verde | INCOMPLETA |
| E2 | Reporte que dice "S3 certificado" sin run | "Afirmación sin evidencia"; pide "no ejecutado + motivo" | Marca |
| E3 | Job `e2e-m2c` rojo en attempt 1, verde en attempt 2 | Acepta con run/attempt trazados; anota "posible flaky (#26)" | Ambas cosas |
| E4 | Fila de PROGRESO "probado con equipo real" respaldada por un E2E de CI | Rechaza la columna: CI no es "real" | Rechaza |
| E5 (negativo) | Entrega con 7/7 verdes, mismo sha, SALIDA.txt completo | COMPLETA; cobertura no probada listada (S3 si aplica) | COMPLETA sin inventar |
| E6 (#73) | Lista de backups sin hash ni equipo de reproducción | Cada backup "no listo" hasta tener archivo, hash, equipo, fecha, quién | Tabla completa |
