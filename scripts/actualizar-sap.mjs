// Descarga el Cloudification Repository de SAP (github.com/SAP/abap-atc-cr-cv-s4hc) y lo compacta
// en public/datos/sap-apis.json, que es lo que lee la web. Lo ejecuta GitHub Actions cada semana.
//
// Fuentes (las mismas que usa el ATC de SAP):
//  - objectReleaseInfo_PCELatest.json  -> S/4HANA Cloud Private Edition / on-premise (última versión)
//  - objectReleaseInfoLatest.json      -> S/4HANA Cloud Public Edition
//  - objectReleaseInfo_BTPLatest.json  -> SAP BTP ABAP Environment
//  - objectClassifications_SAP.json    -> classic APIs y objetos "noAPI" (modelo de niveles de clean core)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'SAP/abap-atc-cr-cv-s4hc';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/src/`;
const FUENTES = {
  pce: 'objectReleaseInfo_PCELatest.json',
  pub: 'objectReleaseInfoLatest.json',
  btp: 'objectReleaseInfo_BTPLatest.json',
  cls: 'objectClassifications_SAP.json',
};

// Solo los tipos que se pueden detectar leyendo código ABAP. Los elementos de datos y dominios
// (más de 25.000) multiplicarían el tamaño sin aportar a la decisión de migración.
const TIPOS = new Set(['TABL', 'CDS_STOB', 'DDLS', 'CLAS', 'INTF', 'FUNC', 'BADI_DEF', 'SUSO', 'BDEF', 'XSLT']);
const ESTADO = { released: 'R', notToBeReleased: 'N', notToBeReleasedStable: 'S', deprecated: 'D', classicAPI: 'B', noAPI: 'X' };
const tipoCorto = (t) => (t === 'CDS_STOB' ? 'DDLS' : t);

async function bajar(nombre) {
  const r = await fetch(RAW + nombre);
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status}`);
  return r.json();
}

const datos = {};
for (const [clave, archivo] of Object.entries(FUENTES)) {
  datos[clave] = await bajar(archivo);
  process.stdout.write(`${archivo} ✓\n`);
}

// nombre -> tipo -> [pce, pub, btp, clasificación, sucesores]
const mapa = new Map();
function entrada(o) {
  const tipo = tipoCorto(o.objectType);
  if (!TIPOS.has(o.objectType) && !TIPOS.has(tipo)) return null;
  const nombre = o.objectKey.toUpperCase();
  if (!mapa.has(nombre)) mapa.set(nombre, new Map());
  const porTipo = mapa.get(nombre);
  if (!porTipo.has(tipo)) porTipo.set(tipo, ['', '', '', '', []]);
  return porTipo.get(tipo);
}
function sucesores(o, e) {
  for (const s of o.successors || []) {
    const n = s.objectKey.toUpperCase();
    if (!e[4].includes(n)) e[4].push(n);
  }
}

['pce', 'pub', 'btp'].forEach((clave, i) => {
  for (const o of datos[clave].objectReleaseInfo) {
    const e = entrada(o);
    if (!e) continue;
    e[i] = ESTADO[o.state] || '';
    sucesores(o, e);
  }
});
for (const o of datos.cls.objectClassifications) {
  const e = entrada(o);
  if (!e) continue;
  e[3] = ESTADO[o.state] || '';
  sucesores(o, e);
}

// Formato compacto: { "VBAK": "TABL|N|N||_|I_SALESDOCUMENT" ... }; varios tipos separados por ";"
const objetos = {};
for (const [nombre, porTipo] of [...mapa].sort((a, b) => a[0].localeCompare(b[0]))) {
  objetos[nombre] = [...porTipo].map(([t, e]) => [t, e[0], e[1], e[2], e[3], e[4].join(',')].join('|')).join(';');
}

let commit = '';
try {
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits?path=src&per_page=1`, { headers: { 'User-Agent': 'radar-s4' } });
  const [c] = await r.json();
  commit = c ? `${c.sha.slice(0, 7)} · ${c.commit.committer.date.slice(0, 10)}` : '';
} catch { /* sin conexión a la API: se deja vacío */ }

const salida = {
  meta: {
    fuente: `https://github.com/${REPO}`,
    commit,
    generado: new Date().toISOString().slice(0, 10),
    objetos: Object.keys(objetos).length,
    formato: 'tipo|PCE|Public|BTP|clasificación|sucesores. R liberado · N no se liberará · S no se liberará (estable) · D obsoleto · B classic API · X noAPI',
  },
  objetos,
};
const destino = path.join(raiz, 'public', 'datos', 'sap-apis.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(salida));
console.log(`${salida.meta.objetos} objetos de SAP · ${(fs.statSync(destino).size / 1024 / 1024).toFixed(1)} MB · ${commit}`);
