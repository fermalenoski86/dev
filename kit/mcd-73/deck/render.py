# Renderiza deck.html (1920x1080, 8 págs), propuesta.html y guion.html (A4) a PDF con Chromium local.
# Uso (desde la raíz del repo): python3 -I kit/mcd-73/deck/render.py <dir_salida>
import os, sys
from playwright.sync_api import sync_playwright
D = os.path.dirname(os.path.abspath(__file__)); O = sys.argv[1]; os.makedirs(O, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    # Captura del panel de la consola DMX virtual (preset McDonald's, sin red) para la diapositiva 4.
    cx = b.new_context(offline=True, viewport={'width': 1600, 'height': 1000}, device_scale_factor=2)
    cp = cx.new_page()
    cp.goto('file://' + os.path.join(D, '..', 'consola', 'consola.html'))
    cp.wait_for_function('document.getElementById("base").complete && window.consola')
    cp.evaluate('consola.setPreset("mcd")')
    cp.locator('.panel').screenshot(path=os.path.join(D, 'consola-panel.png'))
    cx.close()
    pg = b.new_page()
    pg.goto('file://' + os.path.join(D, 'deck.html')); pg.wait_for_load_state('networkidle')
    pg.pdf(path=os.path.join(O, 'trust-mcd-deck-v0.pdf'), width='1920px', height='1080px', print_background=True)
    pg.goto('file://' + os.path.join(D, 'propuesta.html')); pg.wait_for_load_state('networkidle')
    pg.pdf(path=os.path.join(O, 'trust-mcd-propuesta-v0.pdf'), format='A4', print_background=True,
           margin={'top': '14mm', 'bottom': '14mm', 'left': '15mm', 'right': '15mm'})
    pg.goto('file://' + os.path.join(D, 'guion.html')); pg.wait_for_load_state('networkidle')
    pg.pdf(path=os.path.join(O, 'trust-mcd-guion-v0.pdf'), format='A4', print_background=True,
           margin={'top': '12mm', 'bottom': '12mm', 'left': '14mm', 'right': '14mm'})
    b.close()
