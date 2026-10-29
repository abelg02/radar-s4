// Copia el motor de CleanCore Check desde Proyecto-SAP-ABAP: una sola fuente de verdad para las 72 reglas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origen = path.resolve(raiz, '..', 'Proyecto-SAP-ABAP', 'web', 'js', 'cleancore-engine.js');
const destino = path.join(raiz, 'src', 'engine', 'cleancore-engine.js');

if (!fs.existsSync(origen)) {
  console.error(`No encuentro el motor en ${origen}`);
  process.exit(1);
}
fs.copyFileSync(origen, destino);
console.log(`motor copiado: ${path.relative(raiz, destino)}`);
