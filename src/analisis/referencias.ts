// Extrae de un objeto los objetos que usa: tablas, funciones, clases, programas, transacciones...
// Trabaja sobre las sentencias del motor de CleanCore (sin comentarios ni literales) para no dar falsos positivos.
import type { ObjetoZ, Referencia, TipoReferencia } from '../tipos';
import { CleanCore } from './motor';

const NOMBRE = '([A-Z_/][A-Z0-9_/]*)';
const RESERVADAS = new Set(['ME', 'SUPER', 'TABLE', 'OF', 'INTO', 'LINES', 'SINGLE', 'DATA', 'TYPE', 'REF', 'TO', 'CLIENT', 'SPECIFIED', 'CORRESPONDING', 'FIELDS', 'APPENDING', 'PACKAGE', 'SIZE', 'UP', 'ROWS', 'WHERE', 'ORDER', 'BY', 'GROUP', 'HAVING', 'AS', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'JOIN', 'ON', 'FROM', 'FOR', 'ALL', 'ENTRIES', 'IN', 'DISTINCT', 'VALUE', 'NEW', 'CAST', 'CONV', 'COND', 'SWITCH', 'EXACT', 'REDUCE', 'FILTER', 'LET', 'SET', 'VALUES', 'STRUCTURE', 'CDS']);

const anadir = (lista: Referencia[], nombre: string | undefined, tipo: TipoReferencia, linea: number) => {
  if (!nombre) return;
  const n = nombre.toUpperCase().replace(/^@/, '');
  if (!n || RESERVADAS.has(n) || /^\d/.test(n) || n.length < 2) return;
  lista.push({ nombre: n, tipo, linea });
};

/** Nombres de clases e interfaces definidas dentro del propio código (locales): no son dependencias. */
function localesDe(texto: string): Set<string> {
  const locales = new Set<string>();
  for (const m of texto.matchAll(/^(?:CLASS|INTERFACE)\s+([A-Z0-9_/]+)\s+(?:DEFINITION|IMPLEMENTATION)\b/gm)) locales.add(m[1]);
  return locales;
}

export function referenciasAbap(fuente: string): Referencia[] {
  const refs: Referencia[] = [];
  if (!fuente.trim()) return refs;
  const { statements, lines } = CleanCore.splitStatements(fuente);
  const locales = localesDe(statements.map((s) => s.upper).join('\n'));

  for (const s of statements) {
    const u = s.upper;
    const ln = s.start + 1;
    // Texto con literales (para CALL FUNCTION 'X'); solo la primera línea de la sentencia en adelante
    const crudo = lines.slice(s.start, s.end + 1).join(' ');

    // --- SQL: lectura y escritura
    if (/^(SELECT|WITH|OPEN\s+CURSOR)\b/.test(u)) {
      for (const m of u.matchAll(new RegExp(`\\b(?:FROM|JOIN)\\s+\\(?\\s*${NOMBRE}`, 'g'))) {
        if (!u.slice(0, m.index).endsWith('@')) anadir(refs, m[1], 'tabla', ln);
      }
    }
    let m = u.match(new RegExp(`^(?:UPDATE|MODIFY|INSERT|DELETE)\\s+(?:FROM\\s+|INTO\\s+)?${NOMBRE}`));
    // Las tablas internas usan la misma sintaxis: solo cuenta como escritura si el nombre es una tabla de
    // base de datos conocida (se comprueba después contra el Cloudification Repository y el inventario)
    if (m && !/\bINTO\s+TABLE\b|^MODIFY\s+ENTITIES|^(?:INSERT|DELETE|MODIFY)\s+(?:LINES|TABLE|ADJACENT|REPORT|TEXTPOOL|DATASET)\b/.test(u)) {
      anadir(refs, m[1], 'escritura', ln);
    }

    // --- Funciones
    for (const f of crudo.matchAll(/CALL\s+FUNCTION\s+'([^']+)'/gi)) anadir(refs, f[1], 'funcion', ln);

    // --- Clases e interfaces
    const clases = [
      ...u.matchAll(new RegExp(`\\b${NOMBRE}\\s*=>`, 'g')),
      ...u.matchAll(new RegExp(`\\bNEW\\s+${NOMBRE}\\s*\\(`, 'g')),
      ...u.matchAll(new RegExp(`\\bTYPE\\s+REF\\s+TO\\s+${NOMBRE}`, 'g')),
      ...u.matchAll(new RegExp(`\\bCREATE\\s+OBJECT\\s+\\S+\\s+TYPE\\s+${NOMBRE}`, 'g')),
      ...u.matchAll(new RegExp(`\\bINHERITING\\s+FROM\\s+${NOMBRE}`, 'g')),
      ...u.matchAll(new RegExp(`^INTERFACES\\s+${NOMBRE}`, 'g')),
      ...u.matchAll(new RegExp(`\\bCAST\\s+${NOMBRE}\\s*\\(`, 'g')),
    ];
    for (const c of clases) if (!locales.has(c[1])) anadir(refs, c[1], 'clase', ln);

    // --- Programas, includes, transacciones y autorizaciones
    m = u.match(new RegExp(`^SUBMIT\\s+${NOMBRE}`));
    if (m) anadir(refs, m[1], 'programa', ln);
    m = crudo.match(/^\s*SUBMIT\s+'([^']+)'/i);
    if (m) anadir(refs, m[1], 'programa', ln);
    m = u.match(new RegExp(`^INCLUDE\\s+${NOMBRE}\\s*$`));
    if (m && !/^INCLUDE\s+(TYPE|STRUCTURE)\b/.test(u)) anadir(refs, m[1], 'include', ln);
    m = u.match(new RegExp(`^PERFORM\\s+\\S+\\s+IN\\s+PROGRAM\\s+${NOMBRE}`)) || u.match(/^PERFORM\s+[A-Z0-9_]+\(([A-Z0-9_/]+)\)/);
    if (m) anadir(refs, m[1], 'programa', ln);
    for (const t of crudo.matchAll(/(?:CALL|LEAVE\s+TO)\s+TRANSACTION\s+'([^']+)'/gi)) anadir(refs, t[1], 'transaccion', ln);
    for (const a of crudo.matchAll(/AUTHORITY-CHECK\s+OBJECT\s+'([^']+)'/gi)) anadir(refs, a[1], 'autorizacion', ln);
  }
  return refs;
}

/** CDS: FROM, JOIN, asociaciones, composiciones y proyecciones. BDEF: clases y tablas de persistencia. */
export function referenciasCds(fuente: string): Referencia[] {
  const refs: Referencia[] = [];
  const lineas = fuente.split(/\r?\n/);
  lineas.forEach((l, i) => {
    const sin = l.replace(/\/\/.*$/, '').replace(/'[^']*'/g, "''");
    const res = [
      /\b(?:from|join)\s+([A-Za-z_/][\w/]*)/gi,
      /\bassociation\s*(?:\[[^\]]*\])?\s*to\s+(?:parent\s+)?([A-Za-z_/][\w/]*)/gi,
      /\bcomposition\s*(?:\[[^\]]*\])?\s*of\s+([A-Za-z_/][\w/]*)/gi,
      /\bprojection\s+on\s+([A-Za-z_/][\w/]*)/gi,
      /\b(?:persistent|draft)\s+table\s+([A-Za-z_/][\w/]*)/gi,
      /\bimplementation\s+in\s+class\s+([A-Za-z_/][\w/]*)/gi,
    ];
    for (const re of res) for (const m of sin.matchAll(re)) anadir(refs, m[1], /class/i.test(re.source) ? 'clase' : 'tabla', i + 1);
  });
  return refs;
}

export function referenciasDe(o: ObjetoZ): Referencia[] {
  if (!o.fuente) return [];
  if (['DDLS', 'BDEF', 'DCLS', 'SRVD'].includes(o.tipo)) return referenciasCds(o.fuente);
  if (o.tipo === 'TABL') return [];
  return referenciasAbap(o.fuente);
}

/** El objeto es del cliente: Z, Y o un espacio de nombres propio (/ABC/) presente en el inventario. */
export function esPropio(nombre: string, espacios: Set<string>): boolean {
  if (/^[ZY]/.test(nombre) || /^(LCL|LIF|LTC|LTD)_/.test(nombre)) return true;
  const ns = nombre.match(/^\/[A-Z0-9_]+\//);
  return !!ns && espacios.has(ns[0]);
}
