// Gráficos en SVG generados a mano: sin librerías, se imprimen igual que se ven.
import type { ResultadoObjeto } from '../tipos';
import { FIN_ECC, type Calendario } from '../esfuerzo/calendario';
import { DECISIONES, esc, idioma, num, pct, tr } from './util';

const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mes = (i: number) => (idioma() === 'en' ? MESES_EN : MESES_ES)[i];
export const fechaCorta = (s: string) => {
  const [a, m, d] = s.split('-').map(Number);
  return `${d} ${mes(m - 1)} ${a}`;
};

/**
 * Calendario por fases: barra oscura hasta el final optimista, rayada hasta el pesimista,
 * y la línea del fin del mantenimiento estándar de ECC.
 */
export function gantt(c: Calendario, ancho = 760): string {
  if (!c.fases.length) return `<p class="tenue">${tr('No hay trabajo que planificar.')}</p>`;
  const fila = 34;
  const m = { izq: 240, der: 20, arr: 26, aba: 28 };
  const alto = m.arr + c.fases.length * fila + m.aba;
  const t = (s: string) => new Date(`${s}T12:00:00Z`).getTime();
  const t0 = t(c.inicio);
  const t1 = Math.max(t(c.finMax), t(FIN_ECC)) + 20 * 864e5;
  const x = (s: string) => m.izq + ((t(s) - t0) / (t1 - t0)) * (ancho - m.izq - m.der);

  // Marcas cada trimestre
  const marcas: string[] = [];
  const d = new Date(t0);
  d.setUTCDate(1);
  d.setUTCMonth(Math.ceil((d.getUTCMonth() + 1) / 3) * 3);
  while (d.getTime() < t1) {
    const s = d.toISOString().slice(0, 10);
    marcas.push(`<line x1="${x(s)}" x2="${x(s)}" y1="${m.arr - 6}" y2="${alto - m.aba}" class="rejilla"/><text x="${x(s)}" y="${m.arr - 10}" text-anchor="middle">${mes(d.getUTCMonth())} ${d.getUTCFullYear()}</text>`);
    d.setUTCMonth(d.getUTCMonth() + 3);
  }
  const barras = c.fases.map((f, i) => {
    const y = m.arr + i * fila + 8;
    return `<text x="0" y="${y + 13}" class="titulo-eje">${f.fase}. ${esc(tr(f.nombre))}</text>
      <rect x="${x(f.inicioMax)}" y="${y}" width="${Math.max(2, x(f.finMax) - x(f.inicioMax))}" height="18" class="pesimista"><title>Pesimista: ${fechaCorta(f.inicioMax)} a ${fechaCorta(f.finMax)}</title></rect>
      <rect x="${x(f.inicioMin)}" y="${y + 4}" width="${Math.max(2, x(f.finMin) - x(f.inicioMin))}" height="10" class="optimista"><title>Optimista: ${fechaCorta(f.inicioMin)} a ${fechaCorta(f.finMin)}</title></rect>`;
  }).join('');
  const xf = x(FIN_ECC);
  return `<svg class="mapa gantt" viewBox="0 0 ${ancho} ${alto}" width="100%" role="img" aria-label="Calendario por fases">
    <defs><pattern id="rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e3e7ea"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9aa5ad" stroke-width="2.5"/></pattern></defs>
    ${marcas.join('')}
    ${barras}
    <line x1="${xf}" x2="${xf}" y1="${m.arr - 6}" y2="${alto - m.aba + 6}" class="limite"/>
    <text x="${xf - 6}" y="${alto - 6}" text-anchor="end" class="etiqueta-zona">${tr('Fin del mantenimiento estándar de ECC 6.0')}</text>
  </svg>`;
}

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
    <text x="${m.izq + w - 6}" y="${m.arr + 14}" text-anchor="end" class="etiqueta-zona">${tr('Crítico: muy usado y difícil de cambiar')}</text>
    <rect x="${m.izq}" y="${m.arr}" width="${franja}" height="${h}" class="franja"/>
    <text x="${m.izq + franja / 2}" y="${m.arr + h + 16}" text-anchor="middle">${tr('No medido')}</text>
    ${marcasX}
    <line x1="${m.izq}" x2="${m.izq + w}" y1="${m.arr + h}" y2="${m.arr + h}" class="eje"/>
    <line x1="${m.izq}" x2="${m.izq}" y1="${m.arr}" y2="${m.arr + h}" class="eje"/>
    <text x="${m.izq + franja + (w - franja) / 2}" y="${alto - 6}" text-anchor="middle" class="titulo-eje">${tr('Ejecuciones en el periodo medido (escala logarítmica)')}</text>
    <text transform="translate(14 ${m.arr + h / 2}) rotate(-90)" text-anchor="middle" class="titulo-eje">${tr('Complejidad del cambio')}</text>
    <text x="${m.izq - 6}" y="${m.arr + 10}" text-anchor="end">${tr('Alta')}</text>
    <text x="${m.izq - 6}" y="${m.arr + h}" text-anchor="end">${tr('Baja')}</text>
    ${puntos}
  </svg>`;
}

/** Barras horizontales simples (rango mínimo-máximo). */
export function barrasRango(filas: { nombre: string; min: number; max: number; nota?: string }[], unidad: string): string {
  const max = Math.max(1, ...filas.map((f) => f.max));
  return `<div class="barras">${filas
    .map((f) => `<div class="barra-fila"><span class="barra-nombre">${esc(f.nombre)}</span><span class="barra-pista"><span class="barra-min" style="width:${(100 * f.min) / max}%"></span><span class="barra-max" style="left:${(100 * f.min) / max}%;width:${(100 * (f.max - f.min)) / max}%"></span></span><span class="barra-valor">${num(f.min)}–${num(f.max)} ${tr(unidad)}${f.nota ? ` <span class="tenue">${esc(f.nota)}</span>` : ''}</span></div>`)
    .join('')}</div>`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}
