// Analiza una carpeta abapGit desde la terminal, con el mismo código que la web. Sirve para probar con repositorios reales.
// Uso: npx vite-node scripts/analizar-carpeta.ts <carpeta> [destino] [csv-de-uso]
import fs from 'node:fs';
import path from 'node:path';
import { leerRepositorio } from '../src/entrada/abapgit';
import { leerUso } from '../src/entrada/uso';
import { analizarBase, evaluar } from '../src/analisis/analizar';
import { BaseSap, type DatosSap } from '../src/analisis/sap';
import { SUPUESTOS_POR_DEFECTO, REGLAS_POR_DEFECTO, HORAS_POR_JORNADA } from '../src/esfuerzo/supuestos';
import type { Archivo, Destino } from '../src/tipos';

const [carpeta, destino = 's4op', csv] = process.argv.slice(2);
const archivos: Archivo[] = [];
const recorrer = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') recorrer(p); }
    else if (/\.(abap|asddls|asbdef|xml)$/i.test(e.name)) archivos.push({ ruta: path.relative(carpeta, p).replace(/\\/g, '/'), contenido: fs.readFileSync(p, 'utf8') });
  }
};
recorrer(carpeta);

const datos = JSON.parse(fs.readFileSync(new URL('../public/datos/sap-apis.json', import.meta.url), 'utf8')) as DatosSap;
const t0 = Date.now();
const { objetos, avisos } = leerRepositorio(archivos, path.basename(carpeta));
const bases = analizarBase(objetos, new BaseSap(datos), destino as Destino);
const uso = csv ? leerUso(fs.readFileSync(csv, 'utf8')) : null;
const a = evaluar(path.basename(carpeta), bases, uso, { destino: destino as Destino, reglas: REGLAS_POR_DEFECTO, supuestos: SUPUESTOS_POR_DEFECTO, horasPorJornada: HORAS_POR_JORNADA, equipo: { personas: 2, dedicacion: 1, inicio: '2026-11-02' } }, datos.meta, avisos);
const r = a.resumen;
console.log(`${a.nombre} · ${destino} · ${Date.now() - t0} ms`);
console.log(`objetos ${r.objetos} · líneas ${r.lineas} · tipos ${JSON.stringify(r.porTipo)}`);
console.log(`decisión ${JSON.stringify(r.porDecision)} · nivel ${JSON.stringify(r.porNivel)} · uso ${JSON.stringify(r.uso)}`);
console.log(`esfuerzo ${r.esfuerzo.min.toFixed(1)}–${r.esfuerzo.max.toFixed(1)} jornadas`);
console.log('fases', r.porFase.map((f) => `${f.fase}:${f.objetos}`).join(' '));
console.log('sensibilidad', r.sensibilidad.map((s) => `${s.supuesto} ${(s.peso * 100).toFixed(0)}%`).join(' | '));
console.log('top SAP', r.topSap.slice(0, 10).map((s) => `${s.nombre}(${s.tipo},${s.nivel},${s.objetos}${s.sucesores.length ? '→' + s.sucesores[0] : ''})`).join(' '));
if (avisos.length) console.log('avisos', avisos);
const peores = [...a.resultados].sort((x, y) => y.esfuerzo.max - x.esfuerzo.max).slice(0, 5);
for (const p of peores) console.log(` ${p.objeto.id} [${p.objeto.paquete}] ${p.decision} nivel ${p.nivel} ${p.esfuerzo.min}-${p.esfuerzo.max}h · ${p.motivos[0]}`);
