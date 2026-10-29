// Consulta del Cloudification Repository compactado (public/datos/sap-apis.json) y niveles de clean core.
//
// Niveles (modelo de clean core de SAP, ATC "Usage of APIs"):
//   A  API liberada para ABAP Cloud
//   B  classic API (estable, clasificada por SAP)
//   C  objeto interno de SAP sin clasificar: funciona hoy, puede cambiar en una actualización
//   D  objeto marcado como "noAPI", escritura directa en tablas de SAP o ampliación implícita
// Es una aproximación a partir del código exportado: la referencia oficial es el ATC del sistema.
import type { Destino, InfoSap, Nivel, Referencia, UsoSap } from '../tipos';

export interface DatosSap {
  meta: { commit: string; generado: string; objetos: number; fuente: string };
  objetos: Record<string, string>;
}

const PREFERENCIA: Record<string, string[]> = {
  tabla: ['TABL', 'DDLS'],
  escritura: ['TABL'],
  funcion: ['FUNC'],
  clase: ['CLAS', 'INTF', 'BADI_DEF'],
  autorizacion: ['SUSO'],
  badi: ['BADI_DEF'],
  programa: [],
  transaccion: [],
  include: [],
};

export class BaseSap {
  constructor(readonly datos: DatosSap) {}

  info(nombre: string, tipoRef: string): InfoSap | null {
    const crudo = this.datos.objetos[nombre];
    if (!crudo) return null;
    const lista = crudo.split(';').map((e) => {
      const [tipo, pce, pub, btp, clasificacion, suc] = e.split('|');
      return { tipo, pce, pub, btp, clasificacion, sucesores: suc ? suc.split(',') : [] };
    });
    const pref = PREFERENCIA[tipoRef] || [];
    if (!pref.length) return null;
    return lista.find((i) => pref.includes(i.tipo)) || null;
  }
}

export const NIVEL_ORDEN: Record<Nivel, number> = { A: 0, B: 1, C: 2, D: 3 };
export const peorNivel = (a: Nivel, b: Nivel): Nivel => (NIVEL_ORDEN[a] >= NIVEL_ORDEN[b] ? a : b);

const ETIQUETA_TIPO: Record<string, string> = {
  tabla: 'Lectura de', escritura: 'Escritura en', funcion: 'Función', clase: 'Clase o interfaz', programa: 'Programa',
  transaccion: 'Transacción', autorizacion: 'Objeto de autorización', badi: 'BAdI', include: 'Include',
};

/** Evalúa cada objeto de SAP que usa un objeto Z. Agrupa por nombre y tipo de uso. */
export function evaluarUsosSap(refs: Referencia[], base: BaseSap, destino: Destino): UsoSap[] {
  const grupos = new Map<string, Referencia[]>();
  for (const r of refs) {
    const k = `${r.tipo}:${r.nombre}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(r);
  }

  const usos: UsoSap[] = [];
  for (const lista of grupos.values()) {
    const { nombre, tipo } = lista[0];
    const info = base.info(nombre, tipo === 'escritura' ? 'escritura' : tipo);
    // Una "escritura" sobre algo que no es una tabla de SAP conocida es una tabla interna: se descarta
    if (tipo === 'escritura' && !info) continue;
    // Clases desconocidas: pueden ser tipos locales o alias; solo cuentan si siguen el patrón de nombres de SAP.
    // Lo que va detrás de FROM o JOIN siempre es una tabla o vista, así que esas cuentan aunque no estén en la lista.
    if (!info && tipo === 'clase' && !/^(CL_|IF_|CX_|\/)/.test(nombre)) continue;

    const lineas = [...new Set(lista.map((r) => r.linea))].sort((a, b) => a - b);
    const pub = info ? (destino === 's4pub' ? info.pub : info.pub || info.btp) : '';
    const bloqueaCloud = pub !== 'R';
    let nivel: Nivel;
    let motivo: string;

    if (tipo === 'escritura') {
      nivel = 'D';
      motivo = 'Escribe directamente en una tabla de SAP: se salta la lógica y las validaciones estándar.';
    } else if (info?.clasificacion === 'X') {
      nivel = 'D';
      motivo = 'SAP lo marca como "noAPI": no debe usarse desde código propio.';
    } else if (info?.pce === 'R') {
      nivel = 'A';
      motivo = 'API liberada por SAP.';
    } else if (info?.clasificacion === 'B') {
      nivel = 'B';
      motivo = 'Classic API: estable, pero no liberada para ABAP Cloud.';
    } else {
      nivel = 'C';
      motivo = info?.pce === 'D'
        ? 'Obsoleto: SAP indica un sucesor.'
        : info?.pce === 'N' || info?.pce === 'S'
          ? 'SAP no lo liberará: usa el sucesor indicado.'
          : tipo === 'transaccion' || tipo === 'programa'
            ? 'Llamada a un programa o transacción estándar (SAP GUI): sin contrato de estabilidad.'
            : 'Objeto interno de SAP sin clasificar: puede cambiar en cualquier actualización.';
    }
    usos.push({ nombre, tipo, nivel, bloqueaCloud, motivo: `${ETIQUETA_TIPO[tipo]} ${nombre}. ${motivo}`, sucesores: info?.sucesores || [], lineas });
  }
  return usos.sort((a, b) => NIVEL_ORDEN[b.nivel] - NIVEL_ORDEN[a.nivel] || a.nombre.localeCompare(b.nombre));
}
