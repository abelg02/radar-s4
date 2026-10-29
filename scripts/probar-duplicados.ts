// Prueba rápida de la detección de duplicados sobre una carpeta abapGit: npx vite-node scripts/probar-duplicados.ts <carpeta>
import fs from 'node:fs';
import path from 'node:path';
import { leerRepositorio } from '../src/entrada/abapgit';
import { buscarDuplicados } from '../src/analisis/duplicados';

const carpeta = process.argv[2];
const archivos: { ruta: string; contenido: string }[] = [];
const recorrer = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') recorrer(p); }
    else if (/\.(abap|xml)$/.test(e.name)) archivos.push({ ruta: path.relative(carpeta, p).split(path.sep).join('/'), contenido: fs.readFileSync(p, 'utf8') });
  }
};
recorrer(carpeta);
const t0 = Date.now();
const grupos = buscarDuplicados(leerRepositorio(archivos, 'X').objetos);
console.log(`${grupos.length} grupos en ${Date.now() - t0} ms`);
for (const g of grupos.slice(0, 8)) console.log(` ${(g.similitud * 100).toFixed(0)}% ${g.miembros.join(', ')}`);
