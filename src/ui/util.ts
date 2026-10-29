import type { Decision, Destino, EstadoUso, Nivel } from '../tipos';
import { EN } from '../informe/en';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Idioma de lo que se genera (la web es en español; el informe, el CSV y el resumen pueden salir en inglés)
export type Idioma = 'es' | 'en';
let IDIOMA: Idioma = 'es';
export const idioma = () => IDIOMA;
/** Ejecuta fn con el idioma indicado y vuelve al anterior */
export function conIdioma<T>(l: Idioma, fn: () => T): T {
  const antes = IDIOMA;
  IDIOMA = l;
  try { return fn(); } finally { IDIOMA = antes; }
}
/** Traduce un texto fijo de la interfaz (la clave es el texto en español) */
export const tr = (es: string) => (IDIOMA === 'en' ? EN[es] ?? es : es);

const formatos = {
  es: { nf: new Intl.NumberFormat('es-ES'), nf1: new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 0 }), pct: ' %' },
  en: { nf: new Intl.NumberFormat('en-GB'), nf1: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 0 }), pct: '%' },
};
export const num = (n: number) => formatos[IDIOMA].nf.format(Math.round(n));
export const dec = (n: number) => formatos[IDIOMA].nf1.format(n);
export const pct = (n: number, total: number) => `${total ? Math.round((100 * n) / total) : 0}${formatos[IDIOMA].pct}`;
/** Rango de jornadas redondeado a valores razonables (sin falsa precisión) */
export const rango = (min: number, max: number) => {
  const r = (n: number) => (n < 10 ? dec(Math.round(n * 2) / 2) : num(n < 100 ? Math.round(n) : Math.round(n / 5) * 5));
  return `${r(min)} – ${r(max)}`;
};

export const DESTINOS: Record<Destino, { nombre: string; corto: string; nota: string }> = {
  s4op: { nombre: 'S/4HANA on-premise', corto: 'On-premise', nota: 'Conversión de un sistema ECC a S/4HANA en tu propia infraestructura. Cuentan las simplificaciones de S/4HANA y, como riesgo, el nivel de clean core.' },
  s4pce: { nombre: 'S/4HANA Cloud Private Edition', corto: 'Private Edition', nota: 'RISE with SAP. Como on-premise, con el nivel de clean core como criterio de calidad de las extensiones.' },
  s4pub: { nombre: 'S/4HANA Cloud Public Edition', corto: 'Public Edition', nota: 'Solo ABAP Cloud: APIs liberadas, sin SAP GUI ni acceso directo a tablas de SAP.' },
  btp: { nombre: 'SAP BTP ABAP Environment', corto: 'BTP', nota: 'Extensión side-by-side: ABAP Cloud en BTP, sin las vistas ni las tablas de S/4HANA. Para decidir qué sacar del core.' },
};

export const DECISIONES: Record<Decision, { nombre: string; color: string; texto: string }> = {
  retirar: { nombre: 'Retirar', color: 'var(--retirar)', texto: 'Sin uso en el periodo medido y sin objetos que lo necesiten. No se migra.' },
  mantener: { nombre: 'Mantener', color: 'var(--mantener)', texto: 'Se migra tal cual, con prueba de regresión.' },
  adaptar: { nombre: 'Adaptar', color: 'var(--adaptar)', texto: 'Cambios acotados con corrección conocida.' },
  rehacer: { nombre: 'Rehacer', color: 'var(--rehacer)', texto: 'Rediseño con clean core: ABAP Cloud, BO RAP o BTP.' },
};
export const ORDEN_DECISION: Decision[] = ['retirar', 'mantener', 'adaptar', 'rehacer'];

export const NIVELES: Record<Nivel, { nombre: string; color: string; texto: string }> = {
  A: { nombre: 'Nivel A', color: 'var(--nivel-a)', texto: 'Solo usa APIs liberadas por SAP.' },
  B: { nombre: 'Nivel B', color: 'var(--nivel-b)', texto: 'Usa classic APIs: estables, pero no liberadas para ABAP Cloud.' },
  C: { nombre: 'Nivel C', color: 'var(--nivel-c)', texto: 'Usa objetos internos de SAP: pueden cambiar en una actualización.' },
  D: { nombre: 'Nivel D', color: 'var(--nivel-d)', texto: 'Escribe en tablas de SAP, usa objetos "noAPI" o amplía código estándar.' },
};

export const USOS: Record<EstadoUso, string> = { usado: 'Se usa', 'sin-uso': 'Sin uso', desconocido: 'No medido' };

export const TIPOS: Record<string, string> = {
  PROG: 'Programa', CLAS: 'Clase', INTF: 'Interfaz', FUNC: 'Módulo de función', FUGR: 'Grupo de funciones', DDLS: 'Vista CDS',
  BDEF: 'Comportamiento RAP', TABL: 'Tabla', ENHO: 'Ampliación', ENHS: 'Punto de ampliación', TRAN: 'Transacción', SRVD: 'Definición de servicio',
  SRVB: 'Enlace de servicio', XSLT: 'Transformación', VIEW: 'Vista de diccionario', SSFO: 'Smart Form', SFPF: 'Formulario Adobe', SXCI: 'Implementación BAdI', DCLS: 'Control de acceso', TYPE: 'Grupo de tipos',
};
export const tipo = (t: string) => tr(TIPOS[t] || t);

export const CATEGORIAS: Record<string, string> = {
  s4: 'Simplificación S/4HANA', cloud: 'ABAP Cloud', release: 'Versión de ABAP', obsolete: 'Sintaxis obsoleta', perf: 'Rendimiento', security: 'Seguridad', quality: 'Buenas prácticas',
};

export function $(sel: string, raiz: ParentNode = document): HTMLElement {
  return raiz.querySelector(sel) as HTMLElement;
}
export function $$(sel: string, raiz: ParentNode = document): HTMLElement[] {
  return Array.from(raiz.querySelectorAll(sel));
}

export function descargar(nombre: string, contenido: string, tipoMime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipoMime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
