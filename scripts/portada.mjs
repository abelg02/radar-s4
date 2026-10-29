// Genera docs/captura-*.png, docs/portada.png (README) y public/og.png (vista previa en redes) con la web en local.
// Requiere la web en marcha: npx vite preview --port 4790
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:4790/radar-s4/', { waitUntil: 'networkidle' });
await p.click('#probar-ejemplo');
await p.waitForSelector('.resultados .kpis');
await p.evaluate(() => document.querySelector('.aviso')?.remove());
await p.screenshot({ path: path.join(raiz, 'docs/captura-resumen.png'), clip: { x: 100, y: 70, width: 1160, height: 760 } });
await p.click('.pestanas [data-p="mapa"]');
await p.screenshot({ path: path.join(raiz, 'docs/captura-mapa.png'), clip: { x: 100, y: 300, width: 1160, height: 560 } });
await p.click('.pestanas [data-p="objetos"]');
await p.click('#filas tr[data-id]');
await p.waitForTimeout(300);
await p.screenshot({ path: path.join(raiz, 'docs/captura-detalle.png') });
const captura = 'data:image/png;base64,' + fs.readFileSync(path.join(raiz, 'docs/captura-resumen.png')).toString('base64');
const html = (w, h, t) => `<html><body style="margin:0;width:${w}px;height:${h}px;background:#f6f7f8;font-family:'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;gap:${w*0.035}px;padding:0 ${w*0.045}px;box-sizing:border-box;overflow:hidden">
<div style="flex:0 0 ${t}%;color:#1d252c">
<div style="display:flex;align-items:center;gap:12px;font-weight:600;font-size:${w*0.02}px"><svg viewBox="0 0 32 32" width="${w*0.028}" height="${w*0.028}"><rect width="32" height="32" rx="6" fill="#202a33"/><circle cx="16" cy="16" r="10" fill="none" stroke="#e8eef2" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="none" stroke="#e8eef2" stroke-width="2"/><path d="M16 16 L24 9" stroke="#d9743a" stroke-width="2.5" stroke-linecap="round"/></svg>Radar S/4</div>
<div style="font-size:${w*0.038}px;font-weight:600;line-height:1.15;margin:${w*0.02}px 0 ${w*0.015}px">El informe de migración a S/4HANA de tu código Z</div>
<div style="font-size:${w*0.0155}px;color:#3a454e;line-height:1.45">Qué retirar, adaptar o rehacer con clean core, nivel A–D con la lista oficial de SAP y esfuerzo con sus supuestos a la vista.</div>
<div style="font-size:${w*0.0125}px;color:#b4532a;margin-top:${w*0.02}px;font-weight:600">Gratis · En tu navegador · No afiliado a SAP</div></div>
<img src="${captura}" style="flex:1;min-width:0;border-radius:10px;border:1px solid #dfe4e8;box-shadow:0 12px 40px rgba(29,37,44,.12)"></body></html>`;
for (const [w, h, t, salida] of [[1600, 800, 38, 'docs/portada.png'], [1200, 630, 40, 'public/og.png']]) {
  const q = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: salida.includes('og') ? 1 : 2 });
  await q.setContent(html(w, h, t));
  await q.screenshot({ path: path.join(raiz, salida) });
}
await b.close();
console.log('portada, og y capturas generadas');
