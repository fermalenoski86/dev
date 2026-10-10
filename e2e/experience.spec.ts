import { expect, test } from '@playwright/test';

/**
 * Smoke E2E de CLIENT EXPERIENCE.
 *
 * Verifica lo que importa en una reunión: que la demo esté lista antes de
 * dejar apretar PLAY, que cambiar de vista NO reinicie el show, y que STOP y
 * RESET saquen de cualquier situación.
 */

const BASE = process.env.TRUST_CONTROL_URL ?? 'http://localhost:3001';

test.describe('MASTER OF TRUST — Client Mode (lo que ve el cliente)', () => {
  test('CRITERIO: sin controles de operador, sin media de prueba, con el copy ejecutivo', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE}/experience`);
    await expect(page.getByTestId('ready-state')).toHaveText('READY TO PRESENT', { timeout: 40_000 });

    // Nada de la maquinaria a la vista
    await expect(page.getByTestId('demo-check')).toHaveCount(0);
    await expect(page.getByTestId('demo-reset')).toHaveCount(0);
    await expect(page.getByTestId('ready-state')).not.toBeInViewport({ ratio: 0.5 });
    await expect(page.getByText(/ESC para salir/)).toHaveCount(0);
    // con una sola vista, no hay selector
    await expect(page.getByTestId('view-switcher')).toHaveCount(0);

    // Copy ejecutivo, sin vender iluminación ni reloj como instalados
    await expect(page.getByText('3 superficies digitales · 1 momento sincronizado', { exact: false })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/3 pantallas · iluminación · reloj/);
    // Nada de implementación técnica en la pantalla del cliente
    await expect(page.locator('body')).not.toContainText(/EDGE|Modbus|simulated|hardware/i);

    // En pleno takeover, todas las superficies muestran creatividad de campaña
    await page.getByTestId('play-the-moment').click();
    const hora = () => page.getByTestId('stage-time').textContent().then(Number);
    while ((await hora()) < 7000) await page.waitForTimeout(80);
    const fuentes = await page.locator('[data-testid^="surface-"][data-source]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-source')),
    );
    expect(fuentes.length).toBeGreaterThan(0);
    for (const f of fuentes) {
      expect(f, 'media de prueba delante del cliente').not.toMatch(/test_|\/demo\//);
      expect(f).toMatch(/^\/experience\/campaign\//);
    }
  });

  test('CRITERIO: Client Mode no muestra Brand Moments ni leyendas técnicas', async ({ page }) => {
    await page.goto(`${BASE}/experience`);
    await expect(page.getByTestId('ready-state')).toHaveText('READY TO PRESENT', { timeout: 40_000 });
    await expect(page.getByTestId('brand-signature')).toHaveCount(0);
    await expect(page.getByText('Brand moments', { exact: false })).toHaveCount(0);
    await expect(page.getByText('HERO CORNER', { exact: true })).toHaveCount(0);
    // Hero 16:9: la extensión no destructiva está, y el master original también
    await expect(page.getByTestId('stage-ext169')).toHaveCount(1);
    await expect(page.getByTestId('stage-background')).toHaveCount(1);
  });

  test('CRITERIO: HOW IT WORKS: cuatro pasos y la próxima fase, sin protocolos', async ({ page }) => {
    await page.goto(`${BASE}/experience`);
    await expect(page.getByTestId('ready-state')).toHaveText('READY TO PRESENT', { timeout: 40_000 });
    await page.getByTestId('how-it-works').click();
    const panel = page.getByTestId('how-panel');
    await expect(panel).toBeVisible();
    for (const t of ['CREATE', 'PREVIEW', 'OPERATE', 'MEASURE']) await expect(panel).toContainText(t);
    await expect(page.getByTestId('next-phase')).toContainText('Architectural Lighting');
    await expect(page.getByTestId('next-phase')).toContainText('Clock Integration');
    await expect(panel).not.toContainText(/Modbus|Art-Net|PLC|DMX/);
  });

  test('CRITERIO: funciona offline, el cursor se oculta en cinema y EXIT vuelve a negro físico', async ({ page, context }) => {
    test.setTimeout(150_000);
    await page.goto(`${BASE}/experience`);
    await expect(page.getByTestId('ready-state')).toHaveText('READY TO PRESENT', { timeout: 40_000 });
    // Sin red desde acá: todo lo que necesita la reunión ya está local y en memoria.
    await context.setOffline(true);
    await page.getByTestId('play-the-moment').click();
    await expect(page.getByTestId('experience-root')).toHaveAttribute('data-cursor', 'oculto', { timeout: 8_000 });
    await page.mouse.move(400, 300);
    await expect(page.getByTestId('experience-root')).toHaveAttribute('data-cursor', 'visible');
    const hora = () => page.getByTestId('stage-time').textContent().then(Number);
    while ((await hora()) < 7000) await page.waitForTimeout(100);
    await expect
      .poll(async () => page.evaluate(() => ((window as unknown as { __TRUST_SURFACES__?: () => Array<{ output: string; framesDrawn: number }> })
        .__TRUST_SURFACES__?.() ?? []).filter((x) => x.output === 'live').some((x) => x.framesDrawn > 2)), { timeout: 15_000 })
      .toBe(true);
    // EXIT: negro, pero con el renderer físico (LED apagada + gabinete), no un hueco
    while ((await hora()) < 14300 && !(await page.getByTestId('end-card').count())) await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid^="surface-"][data-output="black"]').first()).toBeAttached();
    await expect(page.getByTestId('cabinet-layer')).toBeAttached();
    await context.setOffline(false);
  });

  test('Shift+O abre el modo operador', async ({ page }) => {
    await page.goto(`${BASE}/experience`);
    // esperar la hidratación: antes, el atajo todavía no está escuchando
    await expect(page.getByTestId('ready-state')).toHaveText('READY TO PRESENT', { timeout: 40_000 });
    await expect(page.getByTestId('demo-check')).toHaveCount(0);
    await page.keyboard.press('Shift+O');
    await expect(page.getByTestId('demo-check')).toBeVisible();
    await expect(page.getByTestId('demo-reset')).toBeVisible();
  });
});

test.describe('MASTER OF TRUST — Operator Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Operator Mode explícito: Demo Check, Reset y Backup solo existen acá.
    await page.goto(`${BASE}/experience?operator=1`);
    await expect(page.getByTestId('ready-state')).toHaveText('READY TO PRESENT', { timeout: 40_000 });
  });

  test('presentación completa: play, vistas, stop y reset', async ({ page }) => {
    /* ── 1. Estado inicial ───────────────────────────────────── */
    await expect(page.getByTestId('experience-stage')).toHaveAttribute('data-view', 'HERO_CORNER');
    await expect(page.getByTestId('transparency-badge')).toContainText('CAMPAIGN PREVIEW');
    // Cinco moments del preset McDonald's.
    await expect(page.getByTestId('moment-chip')).toHaveCount(5);

    /* ── 2. PLAY THE MOMENT entra en cinema ──────────────────── */
    await page.getByTestId('play-the-moment').click();
    await expect(page.getByTestId('view-switcher')).toHaveCount(0);

    // El show avanza de verdad: en algún momento hay una superficie `live`.
    await expect
      .poll(async () => page.getByTestId('surface-screen_a').getAttribute('data-output'), {
        timeout: 10_000,
      })
      .toBe('live');

    /* ── 3. Los moments progresan ────────────────────────────── */
    await expect
      .poll(async () => page.locator('[data-testid="moment-chip"][data-active="true"]').count(), {
        timeout: 10_000,
      })
      .toBe(1);

    /* ── 4. STOP siempre disponible ──────────────────────────── */
    await page.getByTestId('stop-experience').click();
    // Con una sola vista en modo presentación, no hay selector que mostrar.
    await expect(page.getByTestId('view-switcher')).toHaveCount(0);

    /* ── 5. Cambiar de vista NO reinicia el show ─────────────── */
    await page.getByTestId('play-the-moment').click();
    // Se espera a salir del PRIMER moment: así "no volvió al principio" es una
    // afirmación verificable. Esperar un tiempo fijo sería frágil — el primer
    // moment del preset dura 3 s y el test pasaría o no según la máquina.
    await expect
      .poll(async () => page.getByTestId('stage-moment').textContent(), { timeout: 12_000 })
      .not.toBe('Normal');
    await page.keyboard.press('Escape'); // salir de cinema para ver el switcher
    const antes = await page.getByTestId('stage-moment').textContent();

    // Modo presentación: solo HERO CORNER hasta tener masters laterales.
    await expect(page.getByTestId('view-corrientes')).toHaveCount(0);
    expect(antes).not.toBe('Normal');

    /* ── 6. BEFORE / TAKEOVER es solo visual ─────────────────── */
    await page.getByTestId('comparison-before').click();
    await expect(page.getByTestId('experience-stage')).toHaveAttribute('data-comparison', 'BEFORE');
    await expect(page.getByTestId('surface-screen_a')).toHaveAttribute('data-output', 'black');
    await page.getByTestId('comparison-takeover').click();

    /* ── 7. DEMO RESET deja todo listo en un click ───────────── */
    await page.getByTestId('demo-reset').click();
    await expect(page.getByTestId('experience-stage')).toHaveAttribute('data-view', 'HERO_CORNER');
    await expect(page.getByTestId('ready-state')).toHaveText('READY TO PRESENT');
    await expect(page.getByTestId('surface-screen_a')).toHaveAttribute('data-output', 'black');

    /* ── 8. HOW IT WORKS → DETALLE TÉCNICO → Builder ──────────── */
    // M2C.2.3 / 10: HOW IT WORKS abre el esquema simple; el centro técnico
    // queda detrás de «DETALLE TÉCNICO».
    await page.getByTestId('how-it-works').click();
    await expect(page.getByTestId('how-panel')).toBeVisible();
    await page.getByRole('link', { name: 'DETALLE TÉCNICO' }).click();
    await page.getByTestId('tab-builder').click();
    await expect(page.getByTestId('preset-select')).toBeVisible();
  });

  test('la end card aparece al terminar y marca la capacidad futura', async ({ page }) => {
    await page.getByTestId('play-the-moment').click();
    // El show dura 15 s.
    await expect(page.getByTestId('end-card')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('end-card')).toContainText('BRAND DOMINANCE');
    await expect(page.getByTestId('planned-capability')).toBeVisible();
  });

  test('CRITERIO: SIGNATURE salta a los 12 s y no arranca desde Normal', async ({ page }) => {
    /*
     * M2C.2.1 / punto 7. `BRAND_MOMENTS.SIGNATURE` declara `seekToMs: 12000` y
     * la UI lo ignoraba: al elegirlo el show arrancaba desde NORMAL y el
     * cliente veía cualquier cosa menos el Signature.
     */
    await page.getByTestId('ready-state').getByText('READY TO PRESENT').waitFor({ timeout: 25_000 });

    await page.getByTestId('brand-signature').click();

    // El momento mostrado es el Signature, no el primero del show.
    await expect(page.getByTestId('stage-moment')).toHaveText(/signature/i);

    // Y el tiempo está en el entorno de los 12 s, no en cero.
    const ms = Number(await page.getByTestId('stage-time').textContent());
    expect(ms).toBeGreaterThanOrEqual(11_500);
    expect(ms).toBeLessThan(14_000);

    // Queda pausado: un Brand Moment es una imagen para mostrar y comentar.
    await page.waitForTimeout(700);
    const ms2 = Number(await page.getByTestId('stage-time').textContent());
    expect(Math.abs(ms2 - ms)).toBeLessThan(150);
  });

  test('CRITERIO: DEMO CHECK corre pruebas reales y da PRESENTATION READY', async ({ page }) => {
    /*
     * M2C.2.1 / punto 11. El check existe para la media hora ANTES de la
     * reunión. No mira un estado en memoria: pide cada archivo por la red
     * local, así que si alguien borra un master o rompe una ruta, esto falla
     * acá y no delante del cliente.
     */
    await page.getByTestId('ready-state').getByText('READY TO PRESENT').waitFor({ timeout: 25_000 });

    await page.getByTestId('demo-check').click();
    await expect(page.getByTestId('demo-check-panel')).toBeVisible();

    await page.getByTestId('demo-check-run').click();
    await expect(page.getByTestId('demo-check-status')).toHaveText('PRESENTATION READY', {
      timeout: 25_000,
    });

    // Las ocho pruebas están listadas y ninguna quedó sin ejecutar.
    const items = page.getByTestId('demo-check-item');
    await expect(items).toHaveCount(9);
    for (const item of await items.all()) {
      await expect(item).not.toContainText('—');
    }

    // Cada prueba requerida está presente y no reporta falta.
    for (const id of ['hero_master', 'views', 'media', 'show_package', 'preflight', 'playback']) {
      const fila = page.locator(`[data-testid="demo-check-item"][data-id="${id}"]`);
      await expect(fila, id).toBeVisible();
      await expect(fila, id).not.toContainText(/falta|no carga|no compila/i);
    }
  });

  test('CRITERIO: el respaldo local reproduce desde el panel de operador', async ({ page }) => {
    // Plan B: si el renderer falla en la reunión, esto tiene que arrancar sin
    // internet y sin depender de nada de lo que acaba de fallar.
    await page.getByTestId('ready-state').getByText('READY TO PRESENT').waitFor({ timeout: 25_000 });

    await page.getByTestId('demo-check').click();
    await page.getByTestId('play-backup').click();

    const player = page.getByTestId('backup-player');
    await expect(player).toBeVisible();

    const video = player.locator('video');
    await expect(video).toHaveAttribute('src', /^\/experience\//); // local, sin CDN

    // Reproduce de verdad: el tiempo avanza.
    await page.waitForTimeout(1500);
    const t = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    expect(t).toBeGreaterThan(0.2);

    // Y el panel del cliente no muestra nada de esto.
    await page.getByRole('button', { name: 'SALIR' }).click();
    await expect(player).toBeHidden();
  });

  test('CRITERIO: las pantallas pintan frames reales durante todo el takeover', async ({ page }) => {
    // Recorre tres momentos con lecturas de píxeles: sin GPU no entra en 30 s.
    test.setTimeout(150_000);
    /*
     * M2C.2.2 / P0. `data-output="live"` solo dice lo que PIDE el motor. Este
     * test mira el estado interno real y los píxeles: si el pintor vuelve a
     * desregistrarse por un objeto en las dependencias, falla acá.
     */
    await page.getByTestId('ready-state').getByText('READY TO PRESENT').waitFor({ timeout: 40_000 });
    await page.getByTestId('play-the-moment').click();

    const leer = () =>
      page.evaluate(() => (window as unknown as {
        __TRUST_SURFACES__?: () => Array<Record<string, number | string | boolean | null>>;
      }).__TRUST_SURFACES__?.() ?? []);
    const pixeles = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('canvas')].map((c) => {
          const g = (c as HTMLCanvasElement).getContext('2d', { willReadFrequently: true });
          if (!g || !c.width || !c.height) return 0;
          const d = g.getImageData(0, 0, Math.min(120, c.width), Math.min(60, c.height)).data;
          let max = 0;
          for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i]! + d[i + 1]! + d[i + 2]!);
          return max;
        }),
      );
    const hora = () => page.getByTestId('stage-time').textContent().then(Number);

    /*
     * Brand Reveal y Full Takeover se verifican reproduciendo. El Signature se
     * verifica con su Brand Moment (salta a 12 s y congela): sin GPU el test es
     * tan lento que, reproduciendo, llegaba al Signature cuando el show ya
     * estaba en Exit — no había canvas que leer y fallaba por el reloj.
     */
    for (const [momento, t] of [['brand reveal', 3400], ['full takeover', 7000], ['signature', -1]] as const) {
      if (t < 0) {
        // al reproducir entra en cinema y oculta los Brand Moments: ESC primero
        await page.keyboard.press('Escape');
        await page.getByTestId('brand-signature').click();
        await expect(page.getByTestId('stage-moment')).toHaveText(/signature/i);
      } else {
        while ((await hora()) < t) await page.waitForTimeout(80);
      }
      /*
       * Issue #26 / H1. Solo cuentan los pintores VIVOS (`detached === false`).
       * Al elegir SIGNATURE las 26 superficies pasan por black y se remontan;
       * las entradas del pintor anterior quedaban en el diagnóstico con
       * `framesDrawn` alto y `output: 'live'`, y el test las tomaba como base.
       * Además, en el paso SIGNATURE la salida esperada es `hold`, no `live`.
       */
      const esperado = t < 0 ? ['hold'] : ['live', 'hold'];
      const activas = (xs: Array<Record<string, number | string | boolean | null>>) =>
        xs.filter((x) => x.detached === false && esperado.includes(String(x.output)));
      await expect
        .poll(async () => {
          const a = activas(await leer());
          return a.length > 0 && a.every((x) => Number(x.readyState) >= 2 && Number(x.framesDrawn) > 0);
        }, { timeout: 8000 })
        .toBe(true);
      const vivas = activas(await leer());
      expect(vivas.length, `${momento}: ninguna superficie activa`).toBeGreaterThan(0);
      for (const x of vivas) {
        expect(Number(x.videoWidth), `${momento} ${x.id}`).toBeGreaterThan(0);
        expect(Number(x.canvasWidth), `${momento} ${x.id}`).toBeGreaterThan(0);
        expect(x.lastError, `${momento} ${x.id}`).toBeNull();
      }
      // Que SIGA pintando: con el bug original el contador volvía a cero.
      const antes = Object.fromEntries(vivas.map((x) => [`${x.id}_${x.segment}`, Number(x.framesDrawn)]));
      await page.waitForTimeout(900);
      for (const x of await leer()) {
        const prev = antes[`${x.id}_${x.segment}`];
        if (prev === undefined || x.detached) continue;
        expect(Number(x.framesDrawn), `${momento} ${x.id}: dejó de pintar`).toBeGreaterThan(prev + 1);
      }
      expect(Math.max(...(await pixeles())), `${momento}: canvas en negro`).toBeGreaterThan(60);
    }
  });

  test('CRITERIO: WARM UP MEDIA deja los decoders listos y lo informa', async ({ page }) => {
    await page.getByTestId('ready-state').getByText('READY TO PRESENT').waitFor({ timeout: 40_000 });
    await page.getByTestId('demo-check').click();
    await page.getByTestId('warm-up-media').click();
    await expect(page.getByTestId('warm-up-state')).toContainText(/clips listos/, { timeout: 30_000 });
    await expect(page.getByTestId('warm-up-state')).not.toContainText(/fallaron/);
  });
});
