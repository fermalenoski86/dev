# Evals por perfil

Regla (del propio Multi-Agent Systems Architect, adoptada acá): **ningún perfil se activa sin
suite de casos y línea base.** Cada archivo tiene casos con entrada, salida esperada y criterio
de pase. Se corren a mano en la etapa E1 (ver `../PROPUESTA_AGENCY_AGENTS.md` §10): Claude invoca
el perfil con la entrada indicada y compara. Objetivo: 20 casos por perfil; hoy hay 6–8, varios
tomados de hallazgos reales del repo (PR #69, #26, #43) para medir si el perfil hubiera visto lo que
ChatGPT vio.

Formato de resultado (se pega en el issue de E1):

| Perfil | Casos | Pasan | Falsos positivos | Falsos negativos | Tokens por caso (mediana) |
|---|---|---|---|---|---|

Un perfil con falsos negativos en casos P0 no pasa a E2.
