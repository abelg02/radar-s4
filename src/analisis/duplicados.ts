// Código casi duplicado: objetos que son copias unos de otros (ZR_VENTAS, ZR_VENTAS_2, ZR_VENTAS_NUEVO...).
// Compara secuencias de 3 sentencias seguidas (sin comentarios ni literales, gracias al motor) con el índice de
// Jaccard. Las secuencias que aparecen en muchísimos objetos (código de plantilla) no cuentan.
import type { ObjetoZ } from '../tipos';
import { CleanCore } from './motor';

export interface GrupoDuplicado {
  miembros: string[];
  /** Parecido medio entre los pares del grupo, de 0 a 1 */
  similitud: number;
}

const TIPOS = new Set(['PROG', 'FUNC', 'CLAS']);
const MIN_SENTENCIAS = 8;
const K = 3;
export const UMBRAL = 0.7;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function huella(o: ObjetoZ): Set<number> | null {
  const { statements } = CleanCore.splitStatements(o.fuente);
  const nombre = o.nombre.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const propio = new RegExp(`\\b${nombre}\\b`, 'g');
  const sentencias = statements
    .map((s) => s.upper.replace(propio, '§').replace(/\s+/g, ' '))
    .filter((u) => !/^(REPORT|PROGRAM|FUNCTION|ENDFUNCTION|CLASS|ENDCLASS)\b/.test(u));
  if (sentencias.length < MIN_SENTENCIAS) return null;
  const tejas = new Set<number>();
  for (let i = 0; i + K <= sentencias.length; i++) tejas.add(hash(sentencias.slice(i, i + K).join('\n')));
  return tejas;
}

export function buscarDuplicados(objetos: ObjetoZ[]): GrupoDuplicado[] {
  const candidatos = objetos.filter((o) => TIPOS.has(o.tipo) && !o.esInclude && o.fuente);
  const huellas: { id: string; tejas: Set<number> }[] = [];
  for (const o of candidatos) {
    const t = huella(o);
    if (t) huellas.push({ id: o.id, tejas: t });
  }
  // Índice invertido: teja -> objetos que la tienen
  const indice = new Map<number, number[]>();
  huellas.forEach((h, i) => h.tejas.forEach((t) => {
    const l = indice.get(t);
    if (l) l.push(i); else indice.set(t, [i]);
  }));
  const maxFrecuencia = Math.max(20, Math.ceil(huellas.length * 0.05));
  const compartidas = new Map<number, number>(); // clave i * n + j
  const n = huellas.length;
  for (const lista of indice.values()) {
    if (lista.length < 2 || lista.length > maxFrecuencia) continue;
    for (let a = 0; a < lista.length; a++) for (let b = a + 1; b < lista.length; b++) {
      const k = lista[a] * n + lista[b];
      compartidas.set(k, (compartidas.get(k) || 0) + 1);
    }
  }

  // Unión de los pares parecidos en grupos
  const padre = huellas.map((_, i) => i);
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const aristas: { i: number; j: number; s: number }[] = [];
  for (const [k, c] of compartidas) {
    const i = Math.floor(k / n);
    const j = k % n;
    const s = c / (huellas[i].tejas.size + huellas[j].tejas.size - c);
    if (s >= UMBRAL) {
      aristas.push({ i, j, s });
      padre[raiz(i)] = raiz(j);
    }
  }
  const grupos = new Map<number, { miembros: Set<number>; suma: number; pares: number }>();
  for (const e of aristas) {
    const r = raiz(e.i);
    const g = grupos.get(r) || { miembros: new Set<number>(), suma: 0, pares: 0 };
    g.miembros.add(e.i).add(e.j);
    g.suma += e.s;
    g.pares++;
    grupos.set(r, g);
  }
  return [...grupos.values()]
    .map((g) => ({ miembros: [...g.miembros].map((i) => huellas[i].id).sort(), similitud: g.suma / g.pares }))
    .sort((a, b) => b.miembros.length - a.miembros.length || b.similitud - a.similitud);
}
