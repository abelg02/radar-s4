// Calendario del plan: con el equipo indicado, cuándo termina cada fase (rango optimista-pesimista)
// y si se llega antes del fin del mantenimiento estándar de SAP ECC 6.0 (finales de 2027, paquetes de mejora 6 a 8).
// Días laborables de lunes a viernes, sin festivos. Las fases van una detrás de otra.
import type { Equipo, Resumen } from '../tipos';

export const FIN_ECC = '2027-12-31';

export interface FaseCalendario {
  fase: number;
  nombre: string;
  jornadasMin: number;
  jornadasMax: number;
  inicioMin: string;
  finMin: string;
  inicioMax: string;
  finMax: string;
}

export interface Calendario {
  fases: FaseCalendario[];
  inicio: string;
  finMin: string;
  finMax: string;
  /** Llega en el caso pesimista */
  llega: boolean;
  /** Llega solo en el optimista */
  llegaJusto: boolean;
  /** Personas con la misma dedicación para terminar el caso pesimista antes del fin de ECC */
  personasNecesarias: number | null;
  diasLaborablesHastaFin: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fecha = (s: string) => new Date(`${s}T12:00:00Z`);
const laborable = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

/** Primer día laborable igual o posterior */
function laborableDesde(s: string): Date {
  const d = fecha(s);
  while (!laborable(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Suma n días laborables (n >= 1 devuelve el último día de trabajo) */
function sumarLaborables(desde: Date, n: number): Date {
  const d = new Date(desde);
  let quedan = Math.max(1, Math.ceil(n)) - 1;
  while (quedan > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (laborable(d)) quedan--;
  }
  return d;
}

function siguienteLaborable(d: Date): Date {
  const x = new Date(d);
  do x.setUTCDate(x.getUTCDate() + 1); while (!laborable(x));
  return x;
}

export function diasLaborables(desde: string, hasta: string): number {
  const d = fecha(desde);
  const fin = fecha(hasta);
  let n = 0;
  while (d <= fin) {
    if (laborable(d)) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

export function calendario(r: Resumen, equipo: Equipo): Calendario {
  const capacidad = Math.max(0.1, equipo.personas * equipo.dedicacion); // jornadas de trabajo por día laborable
  const inicio = laborableDesde(equipo.inicio || iso(new Date()));
  let cursorMin = new Date(inicio);
  let cursorMax = new Date(inicio);
  let finMin = new Date(inicio);
  let finMax = new Date(inicio);
  const fases: FaseCalendario[] = [];
  for (const f of r.porFase) {
    if (f.objetos === 0 || f.max <= 0) continue;
    const dMin = f.min / capacidad;
    const dMax = f.max / capacidad;
    const fMin = sumarLaborables(cursorMin, dMin);
    const fMax = sumarLaborables(cursorMax, dMax);
    fases.push({ fase: f.fase, nombre: f.nombre, jornadasMin: f.min, jornadasMax: f.max, inicioMin: iso(cursorMin), finMin: iso(fMin), inicioMax: iso(cursorMax), finMax: iso(fMax) });
    finMin = fMin;
    finMax = fMax;
    cursorMin = siguienteLaborable(fMin);
    cursorMax = siguienteLaborable(fMax);
  }
  const hasta = diasLaborables(iso(inicio), FIN_ECC);
  const total = r.porFase.reduce((t, f) => t + f.max, 0);
  return {
    fases,
    inicio: iso(inicio),
    finMin: iso(finMin),
    finMax: iso(finMax),
    llega: iso(finMax) <= FIN_ECC,
    llegaJusto: iso(finMax) > FIN_ECC && iso(finMin) <= FIN_ECC,
    personasNecesarias: hasta > 0 ? Math.max(1, Math.ceil(total / (hasta * equipo.dedicacion))) : null,
    diasLaborablesHastaFin: hasta,
  };
}
