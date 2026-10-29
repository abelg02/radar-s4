// Lee el uso real exportado de SAP (SUSG o SCMON) en CSV.
// Las exportaciones cambian según versión e idioma, así que se reconocen las columnas por su nombre.
// También vale la plantilla propia: objeto;tipo;ejecuciones;ultima_ejecucion
import type { Uso } from '../tipos';

const COLUMNAS = {
  nombre: ['OBJ_NAME', 'OBJECT_NAME', 'OBJECT NAME', 'OBJNAME', 'ROOT_NAME', 'PROGNAME', 'PROGRAM', 'NOMBRE DE OBJETO', 'NOMBRE', 'OBJETO', 'PROGRAMA'],
  tipo: ['OBJ_TYPE', 'OBJECT_TYPE', 'OBJECT TYPE', 'OBJTYPE', 'ROOT_TYPE', 'TIPO DE OBJETO', 'TIPO'],
  proc: ['PROC_NAME', 'SUB_NAME', 'PROCESSING BLOCK', 'PROCEDURE', 'BLOQUE', 'METHOD/FUNCTION'],
  procTipo: ['PROC_TYPE', 'SUB_TYPE', 'PROCESSING BLOCK TYPE', 'TIPO DE BLOQUE'],
  contador: ['COUNTER', 'COUNT', 'EXECUTIONS', 'NUMBER OF CALLS', 'CALLS', 'EJECUCIONES', 'CONTADOR', 'LLAMADAS', 'EXEC_COUNT', 'COUNTER_TOTAL'],
  ultima: ['LAST_USED', 'LAST_USE', 'LAST USED', 'LAST EXECUTION', 'LAST_CALL', 'LAST CALL', 'LAST_DATE', 'ULTIMA_EJECUCION', 'ÚLTIMA EJECUCIÓN', 'ULTIMA EJECUCION', 'FECHA'],
};

export interface DatosUso {
  /** Clave TIPO:NOMBRE y NOMBRE (para cuando el tipo no coincide) */
  porClave: Map<string, Uso>;
  filas: number;
  desde?: string;
  hasta?: string;
  avisos: string[];
}

function separador(linea: string): string {
  const cuenta = (c: string) => linea.split(c).length;
  return [';', '\t', ',', '|'].sort((a, b) => cuenta(b) - cuenta(a))[0];
}

function trocear(linea: string, sep: string): string[] {
  const out: string[] = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (comillas && linea[i + 1] === '"') { actual += '"'; i++; } else comillas = !comillas;
    } else if (c === sep && !comillas) { out.push(actual.trim()); actual = ''; } else actual += c;
  }
  out.push(actual.trim());
  return out;
}

/** Fechas en AAAAMMDD, AAAA-MM-DD, DD.MM.AAAA o DD/MM/AAAA -> AAAA-MM-DD */
export function normalizarFecha(v: string): string | undefined {
  const s = v.trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m && m[1] !== '0000') return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

const TIPO_SAP: Record<string, string> = { REPS: 'PROG', PROG: 'PROG', CLAS: 'CLAS', FUGR: 'FUGR', FUNC: 'FUNC', TRAN: 'TRAN', METH: 'CLAS', INTF: 'INTF' };

export function leerUso(texto: string): DatosUso {
  const avisos: string[] = [];
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const porClave = new Map<string, Uso>();
  if (lineas.length < 2) return { porClave, filas: 0, avisos: ['El CSV de uso está vacío.'] };

  const sep = separador(lineas[0]);
  const cab = trocear(lineas[0], sep).map((c) => c.toUpperCase().replace(/^"|"$/g, ''));
  const col = (lista: string[]) => cab.findIndex((c) => lista.includes(c));
  const iNombre = col(COLUMNAS.nombre);
  const iTipo = col(COLUMNAS.tipo);
  const iProc = col(COLUMNAS.proc);
  const iProcTipo = col(COLUMNAS.procTipo);
  const iContador = col(COLUMNAS.contador);
  const iUltima = col(COLUMNAS.ultima);
  if (iNombre < 0) return { porClave, filas: 0, avisos: ['No encuentro la columna con el nombre del objeto (por ejemplo OBJ_NAME u "objeto").'] };
  if (iContador < 0) avisos.push('No hay columna de número de ejecuciones: cada fila cuenta como una ejecución.');

  let desde: string | undefined;
  let hasta: string | undefined;
  let filas = 0;
  const sumar = (clave: string, n: number, fecha?: string) => {
    const u = porClave.get(clave) || { ejecuciones: 0 };
    u.ejecuciones += n;
    if (fecha && (!u.ultima || fecha > u.ultima)) u.ultima = fecha;
    porClave.set(clave, u);
  };

  for (const linea of lineas.slice(1)) {
    const v = trocear(linea, sep);
    let nombre = (v[iNombre] || '').toUpperCase();
    if (!nombre) continue;
    let tipo = TIPO_SAP[(v[iTipo] || '').toUpperCase()] || (v[iTipo] || '').toUpperCase();
    const n = iContador >= 0 ? Number(String(v[iContador]).replace(/[.\s]/g, '').replace(',', '.')) || 0 : 1;
    const fecha = iUltima >= 0 ? normalizarFecha(v[iUltima] || '') : undefined;
    if (fecha) {
      if (!desde || fecha < desde) desde = fecha;
      if (!hasta || fecha > hasta) hasta = fecha;
    }
    // Un grupo de funciones (SAPLZFG) con el módulo de función como bloque -> uso del módulo
    const proc = iProc >= 0 ? (v[iProc] || '').toUpperCase() : '';
    const procTipo = iProcTipo >= 0 ? (v[iProcTipo] || '').toUpperCase() : '';
    if (proc && procTipo === 'FUNC') {
      sumar(`FUNC:${proc}`, n, fecha);
      sumar(proc, n, fecha);
    }
    if (/^SAPL/.test(nombre)) { nombre = nombre.slice(4); tipo = 'FUGR'; }
    if (tipo) sumar(`${tipo}:${nombre}`, n, fecha);
    sumar(nombre, n, fecha);
    filas++;
  }
  return { porClave, filas, desde, hasta, avisos };
}

export const PLANTILLA_USO = 'objeto;tipo;ejecuciones;ultima_ejecucion\nZR_PEDIDOS_PENDIENTES;PROG;1240;2026-09-30\nZCL_FACTURACION;CLAS;88310;2026-10-01\nZ_CALCULAR_PORTES;FUNC;0;\n';
