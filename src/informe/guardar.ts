// Guardar, abrir y comparar análisis. El archivo lleva los resultados, nunca el código fuente:
// se puede enviar al equipo sin compartir nada confidencial.
import type { Analisis, Decision, Nivel, ResultadoObjeto } from '../tipos';
import type { ObjetoBase } from '../analisis/analizar';
import type { DatosUso } from '../entrada/uso';
import type { GrupoDuplicado } from '../analisis/duplicados';

const FORMATO = 'radar-s4/analisis';
const VERSION = 1;

export function exportarAnalisis(a: Analisis): string {
  const sinCodigo: Analisis = {
    ...a,
    resultados: a.resultados.map((r) => ({ ...r, objeto: { ...r.objeto, fuente: '' }, hallazgos: r.hallazgos.map(({ correccion: _c, ...h }) => h) })),
  };
  return JSON.stringify({ formato: FORMATO, version: VERSION, guardado: new Date().toISOString(), analisis: sinCodigo });
}

export function leerAnalisis(texto: string): Analisis {
  let datos: { formato?: string; version?: number; analisis?: Analisis };
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es un análisis de Radar S/4 (no es JSON válido).');
  }
  if (datos.formato !== FORMATO || !datos.analisis?.resultados || !datos.analisis.resumen) throw new Error('El archivo no es un análisis guardado con Radar S/4.');
  if ((datos.version || 0) > VERSION) throw new Error('El análisis se guardó con una versión más nueva de Radar S/4. Recarga la página.');
  const a = datos.analisis;
  // Saneado mínimo: el archivo puede venir de otra persona
  for (const r of a.resultados) {
    r.objeto.nombre = String(r.objeto.nombre).toUpperCase().replace(/[^A-Z0-9_/]/g, '_');
    r.objeto.tipo = String(r.objeto.tipo).toUpperCase().replace(/[^A-Z0-9_]/g, '');
    r.objeto.fuente = '';
  }
  return a;
}

/** Reconstruye lo necesario para volver a evaluar (supuestos, reglas, equipo) sin el código. */
export function reconstruir(a: Analisis): { bases: ObjetoBase[]; uso: DatosUso | null; duplicados: GrupoDuplicado[] } {
  const bases: ObjetoBase[] = a.resultados.map((r) => ({
    objeto: r.objeto, lineas: r.lineas, lineasCodigo: r.lineasCodigo, nota: r.nota, hallazgos: r.hallazgos, sap: r.sap, nivel: r.nivel, usa: r.usa, usadoPor: r.usadoPor,
  }));
  let uso: DatosUso | null = null;
  if (a.resumen.tieneUso) {
    const porClave = new Map<string, { ejecuciones: number; ultima?: string }>();
    for (const r of a.resultados) if (r.ejecuciones !== null) porClave.set(r.objeto.id, { ejecuciones: r.ejecuciones, ultima: r.ultimaEjecucion });
    const [desde, hasta] = (a.resumen.periodoUso || '').split(' a ');
    // Lo que no estaba en el CSV original ya se evaluó; se respeta tal cual
    uso = { porClave, filas: porClave.size, desde: desde || undefined, hasta: hasta || undefined, avisos: [] };
  }
  return { bases, uso, duplicados: (a.duplicados || []).map((g) => ({ miembros: g.miembros, similitud: g.similitud })) };
}

export interface Comparacion {
  nombreAnterior: string;
  fechaAnterior: string;
  delta: { objetos: number; retirar: number; adaptar: number; rehacer: number; nivelD: number; min: number; max: number };
  nuevos: string[];
  eliminados: string[];
  cambios: { id: string; antes: Decision; ahora: Decision; nivelAntes: Nivel; nivelAhora: Nivel }[];
}

export function comparar(actual: Analisis, anterior: Analisis): Comparacion {
  const antes = new Map<string, ResultadoObjeto>(anterior.resultados.map((r) => [r.objeto.id, r]));
  const ahora = new Map<string, ResultadoObjeto>(actual.resultados.map((r) => [r.objeto.id, r]));
  const cambios: Comparacion['cambios'] = [];
  for (const [id, r] of ahora) {
    const p = antes.get(id);
    if (p && (p.decision !== r.decision || p.nivel !== r.nivel)) cambios.push({ id, antes: p.decision, ahora: r.decision, nivelAntes: p.nivel, nivelAhora: r.nivel });
  }
  const ra = actual.resumen;
  const rb = anterior.resumen;
  return {
    nombreAnterior: anterior.nombre,
    fechaAnterior: anterior.fecha,
    delta: {
      objetos: ra.objetos - rb.objetos,
      retirar: ra.porDecision.retirar - rb.porDecision.retirar,
      adaptar: ra.porDecision.adaptar - rb.porDecision.adaptar,
      rehacer: ra.porDecision.rehacer - rb.porDecision.rehacer,
      nivelD: ra.porNivel.D - rb.porNivel.D,
      min: ra.esfuerzo.min - rb.esfuerzo.min,
      max: ra.esfuerzo.max - rb.esfuerzo.max,
    },
    nuevos: [...ahora.keys()].filter((id) => !antes.has(id)),
    eliminados: [...antes.keys()].filter((id) => !ahora.has(id)),
    cambios,
  };
}
