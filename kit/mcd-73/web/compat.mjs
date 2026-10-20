// Compatibilidad con navegadores viejos (p. ej. el de una tele): baja la sintaxis del JS del sitio
// (??, ?., spread de objetos, catch sin variable…) y agrega polyfills chicos. Corre en kit-web.yml al armar el sitio.
// Uso: node compat.mjs <carpeta public>
const { transformSync } = await import(process.env.ESBUILD || 'esbuild');   // en el Action se instala con npm
import fs from 'node:fs'; import path from 'node:path';
const PUB = process.argv[2], TARGET = ['chrome51'];   // lo más bajo que esbuild baja sin romper let/const ni desestructuración
const POLY = `<script>(function(){var A=Array.prototype;if(!A.flat)A.flat=function(d){d=d===undefined?1:d;return d<1?A.slice.call(this):A.reduce.call(this,function(a,v){return a.concat(Array.isArray(v)?v.flat(d-1):v)},[])};if(!A.flatMap)A.flatMap=function(f,t){return A.map.call(this,f,t).flat()};if(!Object.fromEntries)Object.fromEntries=function(it){var o={};Array.from(it).forEach(function(p){o[p[0]]=p[1]});return o};if(!String.prototype.padStart)String.prototype.padStart=function(n,s){var t=String(this);s=s===undefined?' ':String(s);while(t.length<n)t=s+t;return t.slice(t.length-Math.max(n,String(this).length))};if(!Promise.prototype.finally)Promise.prototype.finally=function(f){return this.then(function(v){return Promise.resolve(f()).then(function(){return v})},function(e){return Promise.resolve(f()).then(function(){throw e})})};if(!window.structuredClone)window.structuredClone=function(v){return JSON.parse(JSON.stringify(v))};})();</script>`;
const bajarCss = (code, nombre) => transformSync(code, { loader: 'css', target: TARGET, charset: 'utf8', sourcefile: nombre }).code;   // inset → top/right/bottom/left, etc.
const bajar = (code, nombre) => transformSync(code, { loader: 'js', target: TARGET, charset: 'utf8', legalComments: 'inline', sourcefile: nombre }).code;
let n = 0;
for (const f of fs.readdirSync(path.join(PUB, 'control')).filter((f) => /\.(js|css)$/.test(f))) {
  const p = path.join(PUB, 'control', f), c = fs.readFileSync(p, 'utf8'); fs.writeFileSync(p, f.endsWith('.css') ? bajarCss(c, f) : bajar(c, f)); n++;
}
for (const h of ['index.html', 'control/index.html', 'presentacion.html']) {
  const p = path.join(PUB, h); if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) => `<script>${bajar(code, h).replace(/<\/script/gi, '<\\/script')}</script>`);
  s = s.replace(/<style>([\s\S]*?)<\/style>/g, (m, css) => `<style>${bajarCss(css, h)}</style>`);
  s = s.replace(/<head>/i, '<head>' + POLY); fs.writeFileSync(p, s); n++;
}
console.log(`compat: ${n} archivos bajados a ${TARGET.join(', ')}`);
