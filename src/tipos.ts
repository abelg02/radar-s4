// Tipos compartidos por la lectura, el análisis, el esfuerzo y el informe.

export type Destino = 's4op' | 's4pce' | 's4pub' | 'btp';
/** Destinos donde solo vale ABAP Cloud */
export const esCloud = (d: Destino) => d === 's4pub' || d === 'btp';
export type Nivel = 'A' | 'B' | 'C' | 'D';
export type Decision = 'retirar' | 'mantener' | 'adaptar' | 'rehacer';
export type EstadoUso = 'usado' | 'sin-uso' | 'desconocido';

export interface Archivo {
  ruta: string;
  contenido: string;
}

/** Un objeto Z del repositorio (programa, clase, módulo de función, CDS, tabla...). */
export interface ObjetoZ {
  /** Clave única: TIPO:NOMBRE */
  id: string;
  nombre: string;
  /** Tipo de objeto en el sentido de TADIR (PROG, CLAS, INTF, FUNC, FUGR, DDLS, TABL, BDEF, ENHO...) */
  tipo: string;
  paquete: string;
  /** Grupo de funciones al que pertenece un módulo de función */
  grupo?: string;
  descripcion?: string;
  /** Código ABAP o fuente CDS/BDEF unido (vacío en objetos de diccionario) */
  fuente: string;
  archivos: string[];
  /** Programa include (SUBC = I) o include de grupo de funciones */
  esInclude?: boolean;
  /** Implementación de un punto de ampliación implícito (ENHO de tipo HOOK) */
  ampliacionImplicita?: boolean;
}

export type TipoReferencia = 'tabla' | 'escritura' | 'funcion' | 'clase' | 'programa' | 'transaccion' | 'autorizacion' | 'badi' | 'include';

export interface Referencia {
  nombre: string;
  tipo: TipoReferencia;
  linea: number;
}

/** Estado de un objeto de SAP según el Cloudification Repository */
export interface InfoSap {
  tipo: string;
  pce: string;
  pub: string;
  btp: string;
  clasificacion: string;
  sucesores: string[];
}

export interface UsoSap {
  nombre: string;
  tipo: TipoReferencia;
  nivel: Nivel;
  /** Bloquea en Public Edition o en BTP (no liberado) */
  bloqueaCloud: boolean;
  motivo: string;
  sucesores: string[];
  lineas: number[];
}

export interface Hallazgo {
  regla: string;
  categoria: string;
  severidad: 'error' | 'warning' | 'info';
  titulo: string;
  linea: number;
  detalle: string;
  /** Ejemplo de corrección de la regla (código después) */
  correccion?: string;
}

export interface Uso {
  ejecuciones: number;
  ultima?: string;
}

export interface ResultadoObjeto {
  objeto: ObjetoZ;
  lineas: number;
  lineasCodigo: number;
  nota: number | null;
  hallazgos: Hallazgo[];
  sap: UsoSap[];
  nivel: Nivel;
  /** Objetos Z que usa este objeto */
  usa: string[];
  /** Objetos Z que usan este objeto */
  usadoPor: string[];
  uso: EstadoUso;
  ejecuciones: number | null;
  ultimaEjecucion?: string;
  decision: Decision;
  motivos: string[];
  esfuerzo: { min: number; max: number; partidas: Partida[] };
  /** Complejidad del cambio de 0 a 100, para el mapa de riesgo */
  complejidad: number;
  fase: 0 | 1 | 2 | 3;
}

export interface Partida {
  supuesto: string;
  veces: number;
  min: number;
  max: number;
}

export interface Supuesto {
  id: string;
  grupo: 'hallazgo' | 'decision' | 'sap';
  nombre: string;
  descripcion: string;
  min: number;
  max: number;
  /** Fuente o "Estimación del autor" */
  fuente: string;
}

export interface ReglasDecision {
  /** Considerar "sin uso" lo que no aparece en el CSV de uso (si se ha cargado) */
  ausenteEsSinUso: boolean;
  /** Retirar aunque otro objeto lo use, si todos los que lo usan también se retiran */
  retirarEnCadena: boolean;
  /** En on-premise / Private Edition, el nivel D obliga a rehacer */
  nivelDEsRehacer: boolean;
  /** Clean core estricto en Private Edition: el nivel C y las reglas de ABAP Cloud cuentan como cambios obligatorios */
  nivelCEsAdaptar: boolean;
}

export interface Opciones {
  destino: Destino;
  reglas: ReglasDecision;
  supuestos: Supuesto[];
  horasPorJornada: number;
  equipo: Equipo;
}

/** Equipo para el calendario: cuántas personas, qué parte de su jornada y desde cuándo. */
export interface Equipo {
  personas: number;
  /** Fracción de la jornada dedicada a la migración, de 0,1 a 1 */
  dedicacion: number;
  /** AAAA-MM-DD */
  inicio: string;
}

export interface GrupoDuplicadoResultado {
  miembros: string[];
  similitud: number;
  /** El que se propone conservar: el más usado o, sin uso, el más grande */
  principal: string;
  /** Esfuerzo de migrar las copias, que se ahorra si se unifican */
  ahorro: { min: number; max: number };
}

export interface Resumen {
  objetos: number;
  lineas: number;
  porDecision: Record<Decision, number>;
  porNivel: Record<Nivel, number>;
  porTipo: Record<string, number>;
  uso: Record<EstadoUso, number>;
  esfuerzo: { min: number; max: number };
  porFase: { fase: number; nombre: string; objetos: number; min: number; max: number }[];
  sensibilidad: { supuesto: string; peso: number; min: number; max: number }[];
  topSap: { nombre: string; tipo: string; nivel: Nivel; objetos: number; sucesores: string[] }[];
  hallazgosPorCategoria: Record<string, number>;
  tieneUso: boolean;
  periodoUso?: string;
  datosSap: { commit: string; generado: string; objetos: number };
  /** Copias casi iguales que no se retiran: objetos afectados y horas que se ahorran unificándolas */
  duplicados: { grupos: number; objetos: number; min: number; max: number };
}

export interface Analisis {
  nombre: string;
  fecha: string;
  opciones: Opciones;
  resultados: ResultadoObjeto[];
  resumen: Resumen;
  duplicados: GrupoDuplicadoResultado[];
  avisos: string[];
}
