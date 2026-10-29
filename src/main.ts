import './estilos.css';
import type { Analisis, Archivo, Destino, Opciones } from './tipos';
import type { ObjetoBase } from './analisis/analizar';
import { evaluar } from './analisis/analizar';
import type { DatosSap } from './analisis/sap';
import type { Peticion, Respuesta } from './analisis/worker';
import { leerUso, type DatosUso } from './entrada/uso';
import { HORAS_POR_JORNADA, REGLAS_POR_DEFECTO, SUPUESTOS_POR_DEFECTO } from './esfuerzo/supuestos';
import { pintarInicio } from './ui/inicio';
import { pintarResultados } from './ui/resultados';
import { $, esc } from './ui/util';

export interface Estado {
  datosSap: DatosSap | null;
  nombre: string;
  esEjemplo: boolean;
  uso: DatosUso | null;
  usoNombre: string;
  opciones: Opciones;
  bases: ObjetoBase[] | null;
  avisos: string[];
  analisis: Analisis | null;
}

const GUARDADO = 'radar-s4:opciones';
function opcionesGuardadas(): Opciones {
  const base: Opciones = { destino: 's4op', reglas: { ...REGLAS_POR_DEFECTO }, supuestos: SUPUESTOS_POR_DEFECTO.map((s) => ({ ...s })), horasPorJornada: HORAS_POR_JORNADA };
  try {
    const g = JSON.parse(localStorage.getItem(GUARDADO) || 'null');
    if (!g) return base;
    return {
      destino: g.destino || base.destino,
      reglas: { ...base.reglas, ...g.reglas },
      horasPorJornada: g.horasPorJornada || base.horasPorJornada,
      supuestos: base.supuestos.map((s) => {
        const x = (g.supuestos || []).find((y: { id: string }) => y.id === s.id);
        return x ? { ...s, min: x.min, max: x.max, fuente: x.min !== s.min || x.max !== s.max ? 'Ajustado por el usuario' : s.fuente } : s;
      }),
    };
  } catch {
    return base;
  }
}

export const estado: Estado = { datosSap: null, nombre: '', esEjemplo: false, uso: null, usoNombre: '', opciones: opcionesGuardadas(), bases: null, avisos: [], analisis: null };

export function guardarOpciones() {
  try {
    const o = estado.opciones;
    localStorage.setItem(GUARDADO, JSON.stringify({ destino: o.destino, reglas: o.reglas, horasPorJornada: o.horasPorJornada, supuestos: o.supuestos.map(({ id, min, max }) => ({ id, min, max })) }));
  } catch { /* almacenamiento no disponible: no pasa nada */ }
}

const base = import.meta.env.BASE_URL;
let promesaSap: Promise<DatosSap> | null = null;
export function cargarDatosSap(): Promise<DatosSap> {
  promesaSap ||= fetch(`${base}datos/sap-apis.json`).then((r) => {
    if (!r.ok) throw new Error('No se ha podido cargar la lista oficial de SAP.');
    return r.json();
  }).then((d: DatosSap) => (estado.datosSap = d));
  return promesaSap;
}

// ------------------------------------------------------------------ worker
let worker: Worker | null = null;
function pedir(p: Peticion, progreso: (hechos: number, total: number) => void): Promise<{ bases: ObjetoBase[]; avisos: string[] }> {
  worker ||= new Worker(new URL('./analisis/worker.ts', import.meta.url), { type: 'module' });
  return new Promise((ok, mal) => {
    worker!.onmessage = (e: MessageEvent<Respuesta>) => {
      const r = e.data;
      if (r.tipo === 'progreso') progreso(r.hechos, r.total);
      else if (r.tipo === 'base') ok(r);
      else mal(new Error(r.mensaje));
    };
    worker!.onerror = (e) => mal(new Error(e.message || 'Error en el análisis'));
    worker!.postMessage(p);
  });
}

function pantallaCarga(texto: string) {
  $('#app').innerHTML = `<section class="cargando"><div class="radar-anim" aria-hidden="true"></div><p id="carga-texto">${esc(texto)}</p><div class="progreso"><span id="carga-barra"></span></div></section>`;
}
export function progresoCarga(texto: string, hechos?: number, total?: number) {
  const t = document.getElementById('carga-texto');
  if (t) t.textContent = texto;
  const b = document.getElementById('carga-barra');
  if (b && total) b.style.width = `${Math.round((100 * (hechos || 0)) / total)}%`;
}

/** Punto de entrada común a ZIP, carpeta, GitHub y ejemplo. */
export async function analizarArchivos(archivos: Archivo[], nombre: string, esEjemplo = false, raiz?: string) {
  pantallaCarga('Cargando la lista oficial de SAP…');
  try {
    const datosSap = await cargarDatosSap();
    // El uso inventado del ejemplo nunca se aplica a otro código
    if (estado.esEjemplo && !esEjemplo) quitarUso();
    estado.nombre = nombre;
    estado.esEjemplo = esEjemplo;
    progresoCarga(`Analizando ${archivos.length} archivos…`);
    const r = await pedir({ tipo: 'analizar', archivos, nombre, raiz, destino: estado.opciones.destino, datosSap }, (h, t) => progresoCarga(`Analizando objeto ${h} de ${t}…`, h, t));
    estado.bases = r.bases;
    estado.avisos = r.avisos;
    if (!r.bases.length) throw new Error(r.avisos[0] || 'No se ha encontrado ningún objeto ABAP.');
    recalcular('resumen');
    history.pushState({ vista: 'resultados' }, '', '#resultados');
  } catch (err) {
    pintarInicio(estado, (err as Error).message);
  }
}

export async function cambiarDestino(destino: Destino) {
  estado.opciones.destino = destino;
  guardarOpciones();
  if (!estado.bases) return;
  pantallaCarga('Recalculando para el nuevo destino…');
  const r = await pedir({ tipo: 'destino', destino }, (h, t) => progresoCarga(`Analizando objeto ${h} de ${t}…`, h, t));
  estado.bases = r.bases;
  recalcular();
}

/** Uso, decisiones y esfuerzo: instantáneo, se repite al cambiar supuestos o reglas. */
export function recalcular(pestana?: string) {
  if (!estado.bases || !estado.datosSap) return;
  estado.analisis = evaluar(estado.nombre, estado.bases, estado.uso, estado.opciones, estado.datosSap.meta, estado.avisos);
  pintarResultados(estado, pestana);
}

export function cargarUsoTexto(texto: string, nombre: string): string[] {
  const u = leerUso(texto);
  if (!u.filas) {
    estado.uso = null;
    estado.usoNombre = '';
    return u.avisos.length ? u.avisos : ['El CSV de uso no tiene filas válidas.'];
  }
  estado.uso = u;
  estado.usoNombre = nombre;
  return u.avisos;
}

export function quitarUso() {
  estado.uso = null;
  estado.usoNombre = '';
}

export function volverAlInicio() {
  estado.bases = null;
  estado.analisis = null;
  pintarInicio(estado);
}

window.addEventListener('popstate', () => {
  if (location.hash !== '#resultados' && estado.analisis) volverAlInicio();
});

pintarInicio(estado);
cargarDatosSap().catch(() => { /* se reintenta al analizar */ });
