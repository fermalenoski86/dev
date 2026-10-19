"""Arma control/material_mcd.js con el material de marca (kit/mcd-73/material/) y las piezas animadas de material.json.
El material de McDonald's NO va al repositorio (es público): este .js queda fuera de git y viaja solo en el paquete privado.
Uso: python3 -I material.py <carpeta_material> <control/material_mcd.js>"""
import base64, json, os, sys

ent, sal = sys.argv[1], sys.argv[2]
cfg = json.load(open(os.path.join(ent, 'material.json')))
fuentes = {}
for k, a in cfg['archivos'].items():
    f = os.path.join(ent, a['archivo'])
    if os.path.exists(f): fuentes[k] = 'data:image/jpeg;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
piezas = []
for p in cfg['piezas']:
    usadas = {s['fuente'] for pista in p['pistas'].values() for s in pista}
    if not usadas <= set(fuentes): print('falta material para', p['id'], usadas - set(fuentes)); continue
    piezas.append(dict(p, fuentes={k: fuentes[k] for k in usadas}, material=True))
with open(sal, 'w') as fo:
    fo.write('// Generado por ia/material.py — material de McDonald\'s (privado, fuera de git). SIMULACIÓN CONCEPTUAL / mockup ilustrativo, no publicar.\n')
    fo.write('window.PIEZAS_IA = (window.PIEZAS_IA || []).concat(' + json.dumps(piezas, ensure_ascii=False) + ');\n')
print(f'{len(piezas)} piezas con material → {sal} ({os.path.getsize(sal) / 1e6:.2f} MB)')
