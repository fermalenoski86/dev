"""Prueba de reproducción offline en navegador: Chromium sin red abre index.html, reproduce cada <video> 1,5 s.
Uso: unzip del paquete en un dir nuevo y  python3 -I kit/mcd-73/prueba_navegador.py <ruta>/TRUST-McDonalds-kit-offline/index.html
Nota: el Chromium de Playwright no trae H.264, por eso elige el respaldo WebM; Chrome/Edge/Safari usan el MP4."""
import sys, asyncio
from playwright.async_api import async_playwright
async def main(path):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(offline=True)
        pg = await ctx.new_page()
        reqs=[]; pg.on('request', lambda r: reqs.append(r.url))
        await pg.goto('file://'+path); await pg.wait_for_timeout(1500)
        res = await pg.evaluate('''async()=>{const out=[];for(const v of document.querySelectorAll('video')){v.muted=true;
          try{await Promise.race([v.play(),new Promise((_,j)=>setTimeout(()=>j(new Error('play timeout')),5000))]);await new Promise(r=>setTimeout(r,1500));out.push([v.getAttribute('src'),v.readyState,+v.currentTime.toFixed(2),v.videoWidth,v.error&&v.error.code,v.currentSrc.split('/').pop()])}
          catch(e){out.push([v.currentSrc.split('/').pop(),'error',String(e),v.readyState])}}
          const imgs=[...document.images].map(i=>[i.getAttribute('src'),i.naturalWidth]);return {out,imgs}}''')
        print(res); print('no-file requests:', [u for u in reqs if not u.startswith('file://')])
        await b.close()
asyncio.run(main(sys.argv[1]))
