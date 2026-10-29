// Resumen por paquete (área funcional): lo que se lleva a un comité para repartir el trabajo.
import type { Analisis, Decision, Nivel } from '../tipos';

export interface FilaPaquete {
  paquete: string;
  objetos: number;
  lineas: number;
  porDecision: Record<Decision, number>;
  porNivel: Record<Nivel, number>;
  /** Jornadas */
  min: number;
  max: number;
  sinUso: number;
  medidos: number;
}

export function porPaquete(a: Analisis): FilaPaquete[] {
  const h = a.opciones.horasPorJornada;
  const mapa = new Map<string, FilaPaquete>();
  for (const r of a.resultados) {
    const p = r.objeto.paquete;
    let f = mapa.get(p);
    if (!f) {
      f = { paquete: p, objetos: 0, lineas: 0, porDecision: { retirar: 0, mantener: 0, adaptar: 0, rehacer: 0 }, porNivel: { A: 0, B: 0, C: 0, D: 0 }, min: 0, max: 0, sinUso: 0, medidos: 0 };
      mapa.set(p, f);
    }
    f.objetos++;
    f.lineas += r.lineasCodigo;
    f.porDecision[r.decision]++;
    f.porNivel[r.nivel]++;
    f.min += r.esfuerzo.min / h;
    f.max += r.esfuerzo.max / h;
    if (r.uso !== 'desconocido') f.medidos++;
    if (r.uso === 'sin-uso') f.sinUso++;
  }
  return [...mapa.values()].sort((x, y) => y.max - x.max || x.paquete.localeCompare(y.paquete));
}

/** Color de una celda del mapa de calor: más intenso cuanto mayor es la proporción. */
export const calor = (proporcion: number, color: string) =>
  `background:color-mix(in srgb, ${color} ${Math.round(Math.min(1, proporcion) * 70)}%, white)`;
