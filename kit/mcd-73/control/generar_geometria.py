"""Regenera control/geometria.js desde packages/experience-core/src/composition.ts (VIEW_GEOMETRY.HERO_CORNER).
Uso, desde la raíz del repo: python3 -I kit/mcd-73/control/generar_geometria.py
La geometría es la calibrada y aprobada en M2C (posición fijada por Fer). Solo se copian datos."""
import re, json, hashlib, os
R = os.getcwd()
src = open(os.path.join(R, 'packages/experience-core/src/composition.ts')).read()
blk = src[src.index('HERO_CORNER: {'):src.index('CORRIENTES: {')]
PAT = r'q\(\[([\d.]+), ([\d.]+)\], \[([\d.]+), ([\d.]+)\], \[([\d.]+), ([\d.]+)\], \[([\d.]+), ([\d.]+)\]\)'
def quads(t):
    return [[[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]] for v in (list(map(float, m.groups())) for m in re.finditer(PAT, t))]
a = quads(blk[blk.index('screen_a'):blk.index('screen_b')])[0]
b = quads(blk[blk.index('screen_b'):blk.index('horizontal')])[0]
h = quads(blk[blk.index('horizontal'):blk.index('lights')])
c = quads(blk[blk.index('clock'):])[0]
assert len(h) == 24, len(h)
foto = os.path.join(R, 'kit/mcd-73/control/fotos/trust-noche.jpg')
sha = hashlib.sha256(open(foto, 'rb').read()).hexdigest()
dia = os.path.join(R, 'kit/mcd-73/control/fotos/trust-dia.jpg')
g = {"fuente": "packages/experience-core/src/composition.ts · VIEW_GEOMETRY.HERO_CORNER (M2C congelado, posición fijada por Fer sobre boceto4.png, 05-10-2026). Copia de datos, sin modificar el código fuente.",
     "foto": {"noche": {"archivo": "fotos/trust-noche.jpg", "origen": "apps/control/public/experience/hero-corner.jpg", "sha256": sha, "ancho": 2560, "alto": 1733},
              "dia": {"archivo": "fotos/trust-dia.jpg", "sha256": hashlib.sha256(open(dia, 'rb').read()).hexdigest() if os.path.exists(dia) else None,
                      "nota": "Foto diurna de Fer desde el mismo punto. Si sha256 es null, Día usa la foto nocturna con aviso."}},
     "orden_vertices": "tl, tr, br, bl en coordenadas normalizadas 0..1 de la foto",
     "superficies": {
         "corrientes": {"nombre": "Pantalla Corrientes", "lado": "izquierda", "fisico_m": [7.68, 3.84], "contenido_px": [1152, 576], "quads": [a]},
         "pellegrini": {"nombre": "Pantalla Pellegrini", "lado": "derecha", "fisico_m": [9.60, 3.84], "contenido_px": [1440, 576], "quads": [b]},
         "media": {"nombre": "Pantalla media (banda curva existente)", "lado": "ochava", "fisico_m": None, "contenido_px": [1920, 412], "quads": h}},
     "reloj": {"quad": c},
     "nota_proporcion": "La posición fijada por Fer manda sobre la proporción del pliego: proyectado A≈2,8:1 y B≈2,41:1 (PLACEMENT_ASPECT). Las resoluciones de contenido NO son dimensiones físicas."}
open(os.path.join(R, 'kit/mcd-73/control/geometria.js'), 'w').write("// GENERADO por control/generar_geometria.py desde composition.ts. No editar a mano.\nwindow.GEOMETRIA = " + json.dumps(g, ensure_ascii=False, indent=1) + ";\n")
print('geometria.js OK', sha[:16], 'media', len(h), 'tramos')
