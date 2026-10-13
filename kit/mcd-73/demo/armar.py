"""Kit #73 (e): arma la grabación del flujo REAL de TRUST CONTROL.

Entrada: los videos que Playwright graba al correr
`kit/mcd-73/demo/playwright.demo.config.ts` (flow-41 contra el stack local).
Salida: un MP4 1920x1080 H.264 sin sonido, con placas de título entre pasos y
un rótulo fijo que aclara que es entorno de prueba con datos de prueba.

Uso (desde la raíz del repo, después de la corrida de Playwright):
    python3 -I kit/mcd-73/demo/armar.py test-results/kit73-demo kit/mcd-73/trust-control-demo.mp4
"""
import glob, os, subprocess, sys, tempfile

B = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'
L = '/usr/share/fonts/opentype/inter/Inter-Regular.otf'
TMP = tempfile.mkdtemp(prefix='kit73demo-')
ROTULO = 'GRABACIÓN REAL · TRUST CONTROL en entorno de prueba local · datos de prueba · sin pantallas ni equipos conectados'


def tf(s):
    p = os.path.join(TMP, f't{abs(hash(s))}.txt')
    open(p, 'w', encoding='utf-8').write(s)
    return p


def dt(s, font, size, x, y, color='white'):
    return f"drawtext=fontfile={font}:textfile={tf(s)}:fontsize={size}:fontcolor={color}:x={x}:y={y}"


def run(args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def placa(out, k, titulo, sub, dur=3.5):
    vf = ','.join([
        dt(k, B, 30, 140, 380, '0xFFC72C'),
        dt(titulo, B, 64, 140, 440),
        dt(sub, L, 34, 140, 540, '0xDDDDDD'),
        dt(ROTULO, L, 22, 140, 980, '0x999999'),
    ])
    run(['-f', 'lavfi', '-i', f'color=c=0x0b0b0c:s=1920x1080:r=25:d={dur}', '-vf', vf,
         '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '25', out])


def clip(out, src, paso):
    # 1280x900 → 1382x972 centrado en 1920x1080, con rótulo fijo abajo
    vf = ','.join([
        'scale=1382:972:flags=lanczos', 'pad=1920:1080:269:20:color=0x0b0b0c', 'fps=25',
        dt(paso, B, 22, 40, 1046, '0xFFC72C'),
        dt(ROTULO, L, 20, 'w-tw-40', 1048, '0xBBBBBB'),
    ])
    run(['-i', src, '-vf', vf, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '25', out])


def video_de(raiz, prefijo):
    """El video más largo de la página de plataforma de ese test (el Builder abre otra página)."""
    vs = glob.glob(os.path.join(raiz, f'flow-41-{prefijo}-*', 'videos', '*.webm'))
    if not vs:
        sys.exit(f'falta el video del test {prefijo} en {raiz}')
    dur = lambda f: float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]))
    # la página de plataforma es la que empieza con el login (la más larga en 1 y 3; única en 2)
    return max(vs, key=dur)


def main(raiz, salida):
    partes = []
    def p(n):
        f = os.path.join(TMP, f'{len(partes):02d}-{n}.mp4'); partes.append(f); return f
    placa(p('apertura'), 'TRUST CONTROL · HOY FUNCIONA', 'Del archivo a la versión aprobada',
          'Flujo real de la plataforma, grabado automáticamente con Playwright.', 4)
    pasos = [
        ('1', '1 · OPERADOR', 'Crea la campaña, sube los MP4 y envía a aprobación',
         'El servidor valida cada archivo (ffprobe) y genera una versión con hash.'),
        ('2', '2 · APROBADOR (otra persona)', 'Adjunta evidencia y aprueba el hash exacto',
         'Cuatro ojos: quien sube no es quien aprueba.'),
        ('3', '3 · OPERADOR', 'La versión aprobada no cambia',
         'Se puede seguir editando un borrador aparte; lo aprobado queda inmutable.'),
    ]
    for pref, k, t, s in pasos:
        placa(p(f'placa{pref}'), k, t, s)
        clip(p(f'paso{pref}'), video_de(raiz, pref), k)
    placa(p('cierre'), 'SE IMPLEMENTARÁ', 'Envío a pantallas, iluminación y reloj',
          'TRUST EDGE, DMX / Art-Net y reloj son roadmap: no se muestran como funcionando.', 4)
    lista = os.path.join(TMP, 'lista.txt')
    open(lista, 'w').write(''.join(f"file '{f}'\n" for f in partes))
    run(['-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', salida])
    print(salida, subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', salida]).decode().strip())


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
