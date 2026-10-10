# Diagnóstico del issue #26. NO es un gate: solo workflow_dispatch, matriz de
# workers y repeticiones, y siempre sube test-results. Corre los specs de
# e2e/diag/ (E1, E3) y, con `gate: true`, también el suite congelado tal cual,
# para medir la tasa de falla por configuración sin tocar gates.yml.
name: diag-e2e
on:
  # push a diag/** permite medir desde una rama sin mergear antes (workflow_dispatch
  # solo se dispara si el archivo ya está en main). Con push: 10 repeticiones y gate=true.
  push:
    branches: ['diag/**']
  workflow_dispatch:
    inputs:
      repeticiones:
        description: 'corridas por configuración'
        default: '5'
      gate:
        description: 'correr también e2e/experience.spec.ts + builder.spec.ts (sin cambios)'
        type: boolean
        default: true
permissions:
  contents: read
env:
  PNPM_VERSION: 12.5.1
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
jobs:
  diag:
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix:
        workers: [1, 2]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm i -g pnpm@$PNPM_VERSION && pnpm install --frozen-lockfile
      # Mismo alcance que el gate M2C de gates.yml: platform-web queda fuera porque su
      # `next build` exige NEXT_PUBLIC_TRUST_API_URL (BL-30) y M2C no lo usa.
      - run: pnpm -r --filter '!@trust/platform-web' build
      - name: Playwright 1.56.1 + Google Chrome del runner
        run: |
          npm i --no-save --prefix /tmp/pw @playwright/test@1.56.1
          /tmp/pw/node_modules/.bin/playwright install-deps chromium
      - name: 'Entorno (para correlacionar, E5)'
        run: |
          echo "sha=$(git rev-parse HEAD) tree=$(git write-tree)"
          google-chrome --version
          echo "ImageOS=$ImageOS ImageVersion=$ImageVersion"
          nproc; free -m; cat /proc/loadavg
          timeout 20 google-chrome --headless=new --disable-gpu --no-sandbox --dump-dom \
            'data:text/html,<script>document.write(document.createElement("video").canPlayType("video/mp4; codecs=avc1.640028"))</script>' 2>/dev/null | tail -c 40 || echo 'canPlayType: sin respuesta en 20 s'
      - name: Repeticiones
        env: { NODE_PATH: /tmp/pw/node_modules, TRUST_CHROMIUM_PATH: /usr/bin/google-chrome }
        run: |
          set +e
          N=${{ inputs.repeticiones || '10' }}
          for i in $(seq 1 $N); do
            echo "::group::corrida $i / workers ${{ matrix.workers }}"
            ( while true; do cat /proc/loadavg; sleep 5; done ) & LA=$!
            /tmp/pw/node_modules/.bin/playwright test -c playwright.config.ts e2e/diag \
              --workers=${{ matrix.workers }} --reporter=line --output=test-results/diag-$i 2>&1 | tee diag-$i.log
            echo "diag exit=${PIPESTATUS[0]}"
            if [ "${{ github.event_name == 'push' || inputs.gate }}" = "true" ]; then
              /tmp/pw/node_modules/.bin/playwright test -c playwright.config.ts e2e/experience.spec.ts e2e/builder.spec.ts \
                --workers=${{ matrix.workers }} --reporter=line --output=test-results/gate-$i 2>&1 | tee gate-$i.log
              RC=${PIPESTATUS[0]}
              FALLAS=$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' gate-$i.log | grep -aoE '^\s+[0-9]+\) \[chromium\] › [^ ]+' | sed 's/.*› //' | sort -u | tr '\n' ' ')
              echo "gate exit=$RC (corrida $i, workers ${{ matrix.workers }}) ${FALLAS}" | tee -a resumen.txt
            fi
            kill $LA
            echo "::endgroup::"
          done
          echo "== resumen workers=${{ matrix.workers }} =="; cat resumen.txt || true
      # Los agentes no siempre pueden bajar logs/artifacts: el resumen va como anotación.
      - name: Resumen como anotación
        if: always()
        run: |
          enc() { sed ':a;N;$!ba;s/%/%25/g;s/\r/%0D/g;s/\n/%0A/g'; }
          echo "::notice title=diag w${{ matrix.workers }} resumen::$(cat resumen.txt 2>/dev/null | enc)"
          E1=$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' diag-*.log 2>/dev/null | grep -ah '\[E1\]' | cut -c1-900)
          echo "::notice title=diag w${{ matrix.workers }} E1::$(printf '%s' "$E1" | enc)"
          E3=$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' diag-*.log 2>/dev/null | grep -ah '\[E3\]\|trust:warmup')
          echo "::notice title=diag w${{ matrix.workers }} E3::$(printf '%s' "$E3" | enc)"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: diag-e2e-${{ github.sha }}-w${{ matrix.workers }}-${{ github.run_attempt }}
          path: |
            test-results/
            resumen.txt
            diag-*.log
            gate-*.log
          retention-days: 30
