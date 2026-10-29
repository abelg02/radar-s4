// Gráficos en SVG generados a mano: sin librerías, se imprimen igual que se ven.
import type { ResultadoObjeto } from '../tipos';
import { DECISIONES, esc, num, pct } from './util';

/** Barra apilada horizontal con leyenda debajo. */
export function barraApilada(partes: { nombre: string; valor: number; color: string; titulo?: string }[]): string {
  const total = partes.reduce((t, p) => t + p.valor, 0) || 1;
  let x = 0;
  const rects = partes
    .filter((p) => p.valor > 0)
    .map((p) => {
      const w = (100 * p.valor) / total;
      const r = `<rect x="${x}%" y="0" width="${w}%" height="100%" fill="${p.color}"><title>${esc(p.nombre)}: ${num(p.valor)} (${pct(p.valor, total)})</title></rect>`;
      x += w;
      return r;
    })
    .join('');
  const leyenda = partes
    .map((p) => `<li><span class="punto" style="background:${p.color}"></span>${esc(p.nombre)} <b>${num(p.valor)}</b> <span class="tenue">${pct(p.valor, total)}</span></li>`)
    .join('');
  return `<div class="apilada"><svg width="100%" height="18" role="img" aria-label="Reparto">${rects}</svg><ul class="leyenda">${leyenda}</ul></div>`;
}

/**
 * Mapa de riesgo: eje X uso (ejecuciones, escala logarítmica; "no medido" en una franja aparte),
 * eje Y complejidad del cambio. Arriba a la derecha, lo crítico: muy usado y difícil.
 */
export function mapaRiesgo(rs: ResultadoObjeto[], ancho = 760, alto = 380): string {
  const m = { izq: 54, der: 34, arr: 16, aba: 44 };
  const franja = 70; // zona "no medido"
  const w = ancho - m.izq - m.der;
  const h = alto - m.arr - m.aba;
  const maxLog = Math.max(1, ...rs.map((r) => Math.log10(1 + (r.ejecuciones || 0))));
  const xDe = (r: ResultadoObjeto) => {
    // Posición estable por objeto para separar puntos superpuestos sin azar
    const desplaza = ((hash(r.objeto.id) % 1000) / 1000 - 0.5);
    if (r.ejecuciones === null) return m.izq + franja / 2 + desplaza * (franja - 16);
    return m.izq + franja + 12 + (Math.log10(1 + r.ejecuciones) / maxLog) * (w - franja - 20) + desplaza * 6;
  };
  const yDe = (r: ResultadoObjeto) => m.arr + h - (r.complejidad / 100) * h + ((hash(r.objeto.id + 'y') % 100) / 100 - 0.5) * 6;

  const puntos = rs
    .filter((r) => r.decision !== 'retirar')
    .map((r) => `<circle cx="${xDe(r).toFixed(1)}" cy="${yDe(r).toFixed(1)}" r="4" fill="${DECISIONES[r.decision].color}" fill-opacity=".75" data-id="${esc(r.objeto.id)}"><title>${esc(r.objeto.nombre)} · ${DECISIONES[r.decision].nombre} · ${r.ejecuciones === null ? 'uso no medido' : num(r.ejecuciones) + ' ejecuciones'}</title></circle>`)
    .join('');

  const marcasX = [0, 1, 2, 3, 4, 5, 6, 7].filter((e) => e <= Math.ceil(maxLog)).map((e) => {
    const x = m.izq + franja + 12 + (Math.log10(1 + 10 ** e) / maxLog) * (w - franja - 20);
    return x <= m.izq + w ? `<line x1="${x}" x2="${x}" y1="${m.arr}" y2="${m.arr + h}" class="rejilla"/><text x="${x}" y="${m.arr + h + 16}" text-anchor="middle">${e === 0 ? '1' : num(10 ** e)}</text>` : '';
  }).join('');

  const xCrit = m.izq + franja + 12 + 0.5 * (w - franja - 20);
  const yCrit = m.arr + h * 0.45;
  return `<svg class="mapa" viewBox="0 0 ${ancho} ${alto}" width="100%" role="img" aria-label="Mapa de riesgo">
    <rect x="${xCrit}" y="${m.arr}" width="${m.izq + w - xCrit}" height="${yCrit - m.arr}" class="zona-critica"/>
    <text x="${m.izq + w - 6}" y="${m.arr + 14}" text-anchor="end" class="etiqueta-zona">Crítico: muy usado y difícil de cambiar</text>
    <rect x="${m.izq}" y="${m.arr}" width="${franja}" height="${h}" class="franja"/>
    <text x="${m.izq + franja / 2}" y="${m.arr + h + 16}" text-anchor="middle">No medido</text>
    ${marcasX}
    <line x1="${m.izq}" x2="${m.izq + w}" y1="${m.arr + h}" y2="${m.arr + h}" class="eje"/>
    <line x1="${m.izq}" x2="${m.izq}" y1="${m.arr}" y2="${m.arr + h}" class="eje"/>
    <text x="${m.izq + franja + (w - franja) / 2}" y="${alto - 6}" text-anchor="middle" class="titulo-eje">Ejecuciones en el periodo medido (escala logarítmica)</text>
    <text transform="translate(14 ${m.arr + h / 2}) rotate(-90)" text-anchor="middle" class="titulo-eje">Complejidad del cambio</text>
    <text x="${m.izq - 6}" y="${m.arr + 10}" text-anchor="end">Alta</text>
    <text x="${m.izq - 6}" y="${m.arr + h}" text-anchor="end">Baja</text>
    ${puntos}
  </svg>`;
}

/** Barras horizontales simples (rango mínimo-máximo). */
export function barrasRango(filas: { nombre: string; min: number; max: number; nota?: string }[], unidad: string): string {
  const max = Math.max(1, ...filas.map((f) => f.max));
  return `<div class="barras">${filas
    .map((f) => `<div class="barra-fila"><span class="barra-nombre">${esc(f.nombre)}</span><span class="barra-pista"><span class="barra-min" style="width:${(100 * f.min) / max}%"></span><span class="barra-max" style="left:${(100 * f.min) / max}%;width:${(100 * (f.max - f.min)) / max}%"></span></span><span class="barra-valor">${num(f.min)}–${num(f.max)} ${unidad}${f.nota ? ` <span class="tenue">${esc(f.nota)}</span>` : ''}</span></div>`)
    .join('')}</div>`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}
