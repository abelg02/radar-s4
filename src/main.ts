import './estilos.css';
import type { Analisis, Archivo, Destino, Opciones } from './tipos';
import type { ObjetoBase } from './analisis/analizar';
import { evaluar } from './analisis/analizar';
import type { DatosSap } from './analisis/sap';
import type { Peticion, Respuesta } from './analisis/worker';
import type { GrupoDuplicado } from './analisis/duplicados';
import { leerUso, type DatosUso } from './entrada/uso';
import { EQUIPO_POR_DEFECTO, HORAS_POR_JORNADA, REGLAS_POR_DEFECTO, SUPUESTOS_POR_DEFECTO, hoy } from './esfuerzo/supuestos';
import { pintarInicio } from './ui/inicio';
import { pintarResultados } from './ui/resultados';
import { $, esc, type Idioma } from './ui/util';
import { comparar, leerAnalisis, reconstruir, type Comparacion } from './informe/guardar';

export interface Estado {
  datosSap: DatosSap | null;
  nombre: string;
  /** Archivos tal como llegaron, para el ZIP corregido. Solo en memoria. */
  archivos: Archivo[];
  esEjemplo: boolean;
  uso: DatosUso | null;
  usoNombre: string;
  opciones: Opciones;
  bases: ObjetoBase[] | null;
  avisos: string[];
  duplicados: GrupoDuplicado[];
  analisis: Analisis | null;
  /** Análisis abierto desde un archivo guardado: sin código, no se puede cambiar de destino ni generar el ZIP */
  soloResultados: boolean;
  comparacion: Comparacion | null;
  comparacionBase: Analisis | null;
  /** Idioma del informe, el CSV y el resumen */
  idiomaInforme: Idioma;
}

const GUARDADO = 'radar-s4:opciones';
function opcionesGuardadas(): Opciones {
  const base: Opciones = { destino: 's4op', reglas: { ...REGLAS_POR_DEFECTO }, supuestos: SUPUESTOS_POR_DEFECTO.map((s) => ({ ...s })), horasPorJornada: HORAS_POR_JORNADA, equipo: { ...EQUIPO_POR_DEFECTO, inicio: hoy() } };
  try {
    const g = JSON.parse(localStorage.getItem(GUARDADO) || 'null');
    if (!g) return base;
    return {
      destino: g.destino || base.destino,
      reglas: { ...base.reglas, ...g.reglas },
      horasPorJornada: g.horasPorJornada || base.horasPorJornada,
      equipo: { ...base.equipo, ...(g.equipo || {}) },
      supuestos: base.supuestos.map((s) => {
        const x = (g.supuestos || []).find((y: { id: string }) => y.id === s.id);
        return x ? { ...s, min: x.min, max: x.max, fuente: x.min !== s.min || x.max !== s.max ? 'Ajustado por el usuario' : s.fuente } : s;
      }),
    };
  } catch {
    return base;
  }
}

export const estado: Estado = { datosSap: null, nombre: '', archivos: [], esEjemplo: false, uso: null, usoNombre: '', opciones: opcionesGuardadas(), bases: null, avisos: [], duplicados: [], analisis: null, soloResultados: false, comparacion: null, comparacionBase: null, idiomaInforme: 'es' };

export function guardarOpciones() {
  try {
    const o = estado.opciones;
    localStorage.setItem(GUARDADO, JSON.stringify({ destino: o.destino, reglas: o.reglas, horasPorJornada: o.horasPorJornada, equipo: o.equipo, supuestos: o.supuestos.map(({ id, min, max }) => ({ id, min, max })) }));
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
function pedir(p: Peticion, progreso: (hechos: number, total: number) => void): Promise<{ bases: ObjetoBase[]; avisos: string[]; duplicados: GrupoDuplicado[] }> {
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
    estado.soloResultados = false;
    estado.comparacion = null;
    estado.archivos = archivos;
    estado.esEjemplo = esEjemplo;
    progresoCarga(`Analizando ${archivos.length} archivos…`);
    const r = await pedir({ tipo: 'analizar', archivos, nombre, raiz, destino: estado.opciones.destino, datosSap }, (h, t) => progresoCarga(`Analizando objeto ${h} de ${t}…`, h, t));
    estado.bases = r.bases;
    estado.avisos = r.avisos;
    estado.duplicados = r.duplicados;
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
  const meta = estado.datosSap?.meta ?? estado.analisis?.resumen.datosSap;
  if (!estado.bases || !meta) return;
  estado.analisis = evaluar(estado.nombre, estado.bases, estado.uso, estado.opciones, meta, estado.avisos, estado.duplicados);
  if (estado.comparacionBase) estado.comparacion = comparar(estado.analisis, estado.comparacionBase);
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
  estado.comparacion = null;
  estado.comparacionBase = null;
  estado.soloResultados = false;
  pintarInicio(estado);
}

window.addEventListener('popstate', () => {
  if (location.hash !== '#resultados' && estado.analisis) volverAlInicio();
});

pintarInicio(estado);
cargarDatosSap().catch(() => { /* se reintenta al analizar */ });

/** Abre un análisis guardado (.json): se pueden cambiar supuestos, reglas y equipo, pero no el destino. */
export function abrirAnalisis(texto: string) {
  const a = leerAnalisis(texto);
  const r = reconstruir(a);
  estado.nombre = a.nombre;
  estado.archivos = [];
  estado.esEjemplo = /(ficticio)|(fictitious)/i.test(a.nombre);
  estado.uso = r.uso;
  estado.usoNombre = r.uso ? 'uso del análisis guardado' : '';
  estado.bases = r.bases;
  estado.duplicados = r.duplicados;
  estado.avisos = [...(a.avisos || []), 'Análisis abierto desde un archivo guardado: no incluye el código, así que no se puede cambiar de destino ni ver la propuesta de cambio. Puedes ajustar supuestos, reglas y equipo.'];
  estado.opciones = { ...estado.opciones, ...a.opciones, equipo: { ...estado.opciones.equipo, ...(a.opciones.equipo || {}) } };
  estado.soloResultados = true;
  estado.comparacion = null;
  estado.comparacionBase = null;
  estado.analisis = a;
  recalcular('resumen');
  history.pushState({ vista: 'resultados' }, '', '#resultados');
}

/** Compara el análisis actual con uno guardado antes (avance de la migración). */
export function compararCon(texto: string) {
  estado.comparacionBase = leerAnalisis(texto);
  recalcular('resumen');
}
