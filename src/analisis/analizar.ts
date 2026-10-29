// Análisis en dos pasos:
//  1. analizarBase: lo costoso y que solo depende del código y del destino (reglas, referencias, niveles, dependencias).
//  2. evaluar: uso, decisiones, esfuerzo y resumen. Es instantáneo, así que se repite cada vez que el usuario
//     cambia un supuesto o una regla de decisión.
import { esCloud } from '../tipos';
import type { Analisis, Decision, Destino, EstadoUso, GrupoDuplicadoResultado, Hallazgo, Nivel, ObjetoZ, Opciones, Partida, ResultadoObjeto, Resumen, Supuesto, UsoSap } from '../tipos';
import type { GrupoDuplicado } from './duplicados';
import type { DatosUso } from '../entrada/uso';
import { CleanCore } from './motor';
import { referenciasDe, esPropio } from './referencias';
import { BaseSap, evaluarUsosSap, peorNivel } from './sap';

export interface ObjetoBase {
  objeto: ObjetoZ;
  lineas: number;
  lineasCodigo: number;
  nota: number | null;
  hallazgos: Hallazgo[];
  sap: UsoSap[];
  nivel: Nivel;
  usa: string[];
  usadoPor: string[];
}

const CON_ABAP = new Set(['PROG', 'CLAS', 'INTF', 'FUNC', 'FUGR', 'ENHO']);
// Tipos cuyo uso mide SUSG/SCMON directamente
export const EJECUTABLES = new Set(['PROG', 'CLAS', 'FUNC', 'FUGR', 'TRAN']);
// Reglas del motor que ya cubre el cruce con el Cloudification Repository (para no contar dos veces)
const CUBIERTAS_POR_SAP = new Set(['CLD-002', 'CLD-006', 'CLD-010', 'SEC-008']);

export function analizarBase(objetos: ObjetoZ[], base: BaseSap, destino: Destino, progreso?: (hechos: number, total: number) => void): ObjetoBase[] {
  const espacios = new Set(objetos.map((o) => (o.nombre.match(/^\/[A-Z0-9_]+\//) || [''])[0]).filter(Boolean));
  const porNombre = new Map<string, ObjetoZ[]>();
  for (const o of objetos) {
    if (!porNombre.has(o.nombre)) porNombre.set(o.nombre, []);
    porNombre.get(o.nombre)!.push(o);
  }

  const resultados: ObjetoBase[] = objetos.map((o, i) => {
    let nota: number | null = null;
    let hallazgos: Hallazgo[] = [];
    let lineas = o.fuente ? o.fuente.split(/\r?\n/).length : 0;
    let lineasCodigo = lineas;
    if (CON_ABAP.has(o.tipo) && o.fuente.trim()) {
      const r = CleanCore.analyze(o.fuente, { target: destino });
      nota = r.score;
      lineas = r.lines;
      lineasCodigo = r.codeLines;
      hallazgos = r.findings.map((f) => ({ regla: f.rule, categoria: f.cat, severidad: f.sev, titulo: f.title, linea: f.line, detalle: f.detail, correccion: f.after }));
    }
    if (o.tipo === 'TABL') lineas = lineasCodigo = 0;

    const refs = referenciasDe(o);
    const usa = new Set<string>();
    const ajenas = refs.filter((r) => {
      const propios = porNombre.get(r.nombre);
      if (propios) {
        for (const p of propios) if (p.id !== o.id) usa.add(p.id);
        return false;
      }
      return !esPropio(r.nombre, espacios);
    });
    // Los includes de un programa forman parte de él: lo que usa el include lo usa el programa
    const sap = evaluarUsosSap(ajenas, base, destino);
    let nivel: Nivel = sap.reduce<Nivel>((n, u) => peorNivel(n, u.nivel), 'A');
    if (o.ampliacionImplicita) nivel = 'D';

    progreso?.(i + 1, objetos.length);
    return { objeto: o, lineas, lineasCodigo, nota, hallazgos, sap, nivel, usa: [...usa], usadoPor: [] };
  });

  // Módulos de función: el grupo los contiene (comparten includes y datos globales)
  const porId = new Map(resultados.map((r) => [r.objeto.id, r]));
  for (const r of resultados) {
    if (r.objeto.tipo === 'FUNC' && r.objeto.grupo) {
      const g = porId.get(`FUGR:${r.objeto.grupo}`);
      if (g && !r.usa.includes(g.objeto.id)) r.usa.push(g.objeto.id);
    }
  }
  for (const r of resultados) for (const id of r.usa) porId.get(id)?.usadoPor.push(r.objeto.id);
  return resultados;
}

// ---------------------------------------------------------------------------------------------

const FASES = ['Retirar antes de migrar', 'Mantener y adaptar (riesgo bajo)', 'Adaptar (riesgo alto)', 'Rehacer con clean core'];

/** Hallazgos que obligan a tocar el objeto para el destino elegido. */
function hallazgosObligatorios(hs: Hallazgo[], destino: Destino, estricto: boolean): Hallazgo[] {
  return hs.filter((h) => {
    if (CUBIERTAS_POR_SAP.has(h.regla)) return false;
    if (h.categoria === 's4') return h.severidad !== 'info';
    // En Private Edition las reglas de ABAP Cloud son recomendación, salvo con clean core estricto
    if (h.categoria === 'cloud') return esCloud(destino) ? h.severidad !== 'info' : destino === 's4pce' && estricto && h.severidad === 'warning';
    if (h.categoria === 'release') return esCloud(destino) && h.severidad === 'error';
    return false;
  });
}

function decidirUso(b: ObjetoBase, uso: DatosUso | null, opciones: Opciones): { estado: EstadoUso; ejecuciones: number | null; ultima?: string } {
  if (!uso || !EJECUTABLES.has(b.objeto.tipo)) return { estado: 'desconocido', ejecuciones: null };
  if (b.objeto.tipo === 'PROG' && b.objeto.esInclude) return { estado: 'desconocido', ejecuciones: null };
  const u = uso.porClave.get(b.objeto.id) || uso.porClave.get(b.objeto.nombre);
  if (u) return { estado: u.ejecuciones > 0 ? 'usado' : 'sin-uso', ejecuciones: u.ejecuciones, ultima: u.ultima };
  return opciones.reglas.ausenteEsSinUso ? { estado: 'sin-uso', ejecuciones: 0 } : { estado: 'desconocido', ejecuciones: null };
}

export function evaluar(nombre: string, bases: ObjetoBase[], uso: DatosUso | null, opciones: Opciones, datosSap: Resumen['datosSap'], avisos: string[] = [], gruposDuplicados: GrupoDuplicado[] = []): Analisis {
  const { destino, reglas } = opciones;
  const sup = new Map(opciones.supuestos.map((s) => [s.id, s]));
  const porId = new Map(bases.map((b) => [b.objeto.id, b]));

  // 1. Uso directo y, para lo que no se mide (includes, tablas, CDS...), heredado de quien lo usa
  const estados = new Map<string, ReturnType<typeof decidirUso>>();
  for (const b of bases) estados.set(b.objeto.id, decidirUso(b, uso, opciones));
  if (uso) {
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      let cambios = 0;
      for (const b of bases) {
        const e = estados.get(b.objeto.id)!;
        if (e.ejecuciones !== null || !b.usadoPor.length) continue;
        const usuarios = b.usadoPor.map((id) => estados.get(id)!.estado);
        const nuevo: EstadoUso = usuarios.includes('usado') ? 'usado' : usuarios.every((x) => x === 'sin-uso') ? 'sin-uso' : 'desconocido';
        if (nuevo !== e.estado) { e.estado = nuevo; cambios++; }
      }
      if (!cambios) break;
    }
  }

  // 2. Retirar: sin uso y sin nadie (que se quede) que lo necesite. Se itera para retirar en cadena.
  const retirar = new Set<string>();
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    let cambios = 0;
    for (const b of bases) {
      const id = b.objeto.id;
      if (retirar.has(id) || estados.get(id)!.estado !== 'sin-uso') continue;
      const necesitado = b.usadoPor.some((u) => !(reglas.retirarEnCadena && retirar.has(u)));
      if (!necesitado) { retirar.add(id); cambios++; }
    }
    if (!cambios) break;
  }

  // 3. Decisión, motivos y esfuerzo de cada objeto
  const resultados: ResultadoObjeto[] = bases.map((b) => {
    const e = estados.get(b.objeto.id)!;
    const motivos: string[] = [];
    const partidas: Partida[] = [];
    const sumar = (s: Supuesto | undefined, veces: number) => {
      if (!s || veces <= 0) return;
      partidas.push({ supuesto: s.id, veces, min: s.min * veces, max: s.max * veces });
    };
    const obligatorios = hallazgosObligatorios(b.hallazgos, destino, reglas.nivelCEsAdaptar);
    const nivelD = b.sap.filter((s) => s.nivel === 'D');
    const cloud = esCloud(destino);
    const sapACambiar = b.sap.filter((s) => s.nivel !== 'D' && (cloud ? s.bloqueaCloud : reglas.nivelCEsAdaptar && destino === 's4pce' && s.nivel === 'C'));

    let decision: Decision;
    if (retirar.has(b.objeto.id)) {
      decision = 'retirar';
      motivos.push(e.ejecuciones === 0 ? 'Sin ejecuciones en el periodo medido.' : 'Solo lo usan objetos que también se retiran.');
      if (b.usadoPor.length) motivos.push(`Lo usan ${b.usadoPor.length} objeto(s) que también se retiran.`);
      sumar(sup.get('base-retirar'), 1);
    } else {
      const bloqueosCloud = cloud ? obligatorios.filter((h) => h.categoria === 'cloud' && h.severidad === 'error').length : 0;
      const sinSucesor = sapACambiar.filter((s) => !s.sucesores.length);
      const rehacer = (reglas.nivelDEsRehacer && (nivelD.length > 0 || b.objeto.ampliacionImplicita)) || (cloud && (bloqueosCloud > 0 || sinSucesor.length > 2 || nivelD.length > 0));
      if (rehacer) {
        decision = 'rehacer';
        if (b.objeto.ampliacionImplicita) motivos.push('Ampliación implícita de código estándar (nivel D).');
        for (const s of nivelD.slice(0, 3)) motivos.push(s.motivo);
        if (bloqueosCloud) motivos.push(`${bloqueosCloud} uso(s) de tecnología que no existe en ABAP Cloud (SAP GUI, ficheros, transacciones...).`);
        if (cloud && sinSucesor.length > 2) motivos.push(`${sinSucesor.length} objetos de SAP no liberados y sin sucesor indicado.`);
        sumar(sup.get('base-rehacer'), 1);
        // Tope de 20 (2.000 líneas): en objetos enormes se rehace la parte afectada, no todo el código
        sumar(sup.get('rehacer-100'), Math.min(20, Math.ceil(b.lineasCodigo / 100)));
      } else if (obligatorios.length || sapACambiar.length || nivelD.length) {
        decision = 'adaptar';
        const s4 = obligatorios.filter((h) => h.categoria === 's4').length;
        if (s4) motivos.push(`${s4} punto(s) afectados por simplificaciones de S/4HANA.`);
        const cl = obligatorios.length - s4;
        if (cl) motivos.push(`${cl} ajuste(s) para ABAP Cloud.`);
        if (sapACambiar.length) motivos.push(`${sapACambiar.length} objeto(s) de SAP a sustituir por su sucesor liberado.`);
        if (nivelD.length) motivos.push(`${nivelD.length} uso(s) de nivel D a revisar.`);
        sumar(sup.get('base-adaptar'), 1);
      } else {
        decision = 'mantener';
        motivos.push(e.estado === 'desconocido' ? 'Sin cambios obligatorios para el destino (uso no medido).' : 'Se usa y no tiene cambios obligatorios para el destino.');
        sumar(sup.get('base-mantener'), 1);
      }
      if (decision !== 'mantener') {
        const n = (cat: string, sev: string) => obligatorios.filter((h) => h.categoria === cat && h.severidad === sev).length;
        sumar(sup.get('s4-error'), n('s4', 'error'));
        sumar(sup.get('s4-aviso'), n('s4', 'warning'));
        if (destino !== 's4op') {
          sumar(sup.get('cloud-error'), n('cloud', 'error') + n('release', 'error'));
          sumar(sup.get('cloud-aviso'), n('cloud', 'warning'));
        }
        sumar(sup.get('sap-sucesor'), sapACambiar.filter((s) => s.sucesores.length).length);
        sumar(sup.get('sap-sin-sucesor'), sapACambiar.filter((s) => !s.sucesores.length).length);
        if (decision === 'adaptar') sumar(sup.get('sap-nivel-d'), nivelD.length);
      }
    }

    const min = partidas.reduce((t, p) => t + p.min, 0);
    const max = partidas.reduce((t, p) => t + p.max, 0);
    const complejidad = decision === 'retirar' ? 0 : Math.min(100, Math.round(100 * Math.log10(1 + max) / Math.log10(1 + 120)));
    const fase = (decision === 'retirar' ? 0 : decision === 'rehacer' ? 3 : decision === 'adaptar' && complejidad >= 55 ? 2 : 1) as ResultadoObjeto['fase'];

    return {
      ...b,
      uso: e.estado,
      ejecuciones: e.ejecuciones,
      ultimaEjecucion: e.ultima,
      decision,
      motivos,
      esfuerzo: { min, max, partidas },
      complejidad,
      fase,
    };
  });

  // Copias casi iguales: se propone conservar la más usada (o la más grande) y retirar el resto tras unificar.
  // El ahorro es el esfuerzo de migrar las copias que no se retiran ya por falta de uso.
  const porIdRes = new Map(resultados.map((r) => [r.objeto.id, r]));
  const duplicados: GrupoDuplicadoResultado[] = gruposDuplicados
    .map((g) => {
      const rs = g.miembros.map((id) => porIdRes.get(id)).filter((r): r is ResultadoObjeto => !!r);
      const vivos = rs.filter((r) => r.decision !== 'retirar');
      const principal = [...(vivos.length ? vivos : rs)].sort((x, y) => (y.ejecuciones ?? -1) - (x.ejecuciones ?? -1) || y.lineasCodigo - x.lineasCodigo)[0];
      const copias = vivos.filter((r) => r !== principal);
      return {
        miembros: g.miembros,
        similitud: g.similitud,
        principal: principal?.objeto.id || g.miembros[0],
        ahorro: { min: copias.reduce((t, r) => t + r.esfuerzo.min, 0), max: copias.reduce((t, r) => t + r.esfuerzo.max, 0) },
      };
    })
    .sort((x, y) => y.ahorro.max - x.ahorro.max || y.miembros.length - x.miembros.length);

  return { nombre, fecha: new Date().toISOString(), opciones, resultados, resumen: resumir(resultados, opciones, uso, datosSap, duplicados), duplicados, avisos };
}

function resumir(rs: ResultadoObjeto[], opciones: Opciones, uso: DatosUso | null, datosSap: Resumen['datosSap'], duplicados: GrupoDuplicadoResultado[]): Resumen {
  const porDecision = { retirar: 0, mantener: 0, adaptar: 0, rehacer: 0 } as Record<Decision, number>;
  const porNivel = { A: 0, B: 0, C: 0, D: 0 } as Record<Nivel, number>;
  const porTipo: Record<string, number> = {};
  const usoCuenta = { usado: 0, 'sin-uso': 0, desconocido: 0 } as Record<EstadoUso, number>;
  const hallazgosPorCategoria: Record<string, number> = {};
  for (const r of rs) {
    porDecision[r.decision]++;
    porNivel[r.nivel]++;
    porTipo[r.objeto.tipo] = (porTipo[r.objeto.tipo] || 0) + 1;
    usoCuenta[r.uso]++;
    for (const h of r.hallazgos) hallazgosPorCategoria[h.categoria] = (hallazgosPorCategoria[h.categoria] || 0) + 1;
  }
  const h = opciones.horasPorJornada;
  const total = (f: (r: ResultadoObjeto) => boolean) => ({
    min: rs.filter(f).reduce((t, r) => t + r.esfuerzo.min, 0) / h,
    max: rs.filter(f).reduce((t, r) => t + r.esfuerzo.max, 0) / h,
  });

  // Sensibilidad: qué supuestos pesan más en el máximo total
  const peso = new Map<string, { min: number; max: number }>();
  for (const r of rs) for (const p of r.esfuerzo.partidas) {
    const a = peso.get(p.supuesto) || { min: 0, max: 0 };
    a.min += p.min; a.max += p.max;
    peso.set(p.supuesto, a);
  }
  const totalMax = [...peso.values()].reduce((t, v) => t + v.max, 0) || 1;
  const nombres = new Map(opciones.supuestos.map((s) => [s.id, s.nombre]));
  const sensibilidad = [...peso].map(([id, v]) => ({ supuesto: nombres.get(id) || id, peso: v.max / totalMax, min: v.min / h, max: v.max / h }))
    .sort((a, b) => b.peso - a.peso).slice(0, 5);

  // Objetos de SAP más usados entre los que hay que cambiar
  const sapCuenta = new Map<string, { nombre: string; tipo: string; nivel: Nivel; objetos: Set<string>; sucesores: string[] }>();
  for (const r of rs) {
    if (r.decision === 'retirar') continue;
    for (const s of r.sap) {
      if (s.nivel === 'A') continue;
      const k = `${s.tipo}:${s.nombre}`;
      const a = sapCuenta.get(k) || { nombre: s.nombre, tipo: s.tipo, nivel: s.nivel, objetos: new Set<string>(), sucesores: s.sucesores };
      a.objetos.add(r.objeto.id);
      sapCuenta.set(k, a);
    }
  }
  const topSap = [...sapCuenta.values()].map((a) => ({ ...a, objetos: a.objetos.size }))
    .sort((a, b) => b.objetos - a.objetos || a.nombre.localeCompare(b.nombre)).slice(0, 15);

  return {
    objetos: rs.length,
    lineas: rs.reduce((t, r) => t + r.lineasCodigo, 0),
    porDecision,
    porNivel,
    porTipo,
    uso: usoCuenta,
    esfuerzo: total(() => true),
    porFase: FASES.map((nombre, fase) => ({ fase, nombre, objetos: rs.filter((r) => r.fase === fase).length, ...total((r) => r.fase === fase) })),
    sensibilidad,
    topSap,
    hallazgosPorCategoria,
    tieneUso: !!uso,
    periodoUso: uso?.desde && uso?.hasta ? `${uso.desde} a ${uso.hasta}` : undefined,
    datosSap,
    duplicados: {
      grupos: duplicados.filter((g) => g.ahorro.max > 0).length,
      objetos: duplicados.reduce((t, g) => t + g.miembros.length, 0),
      min: duplicados.reduce((t, g) => t + g.ahorro.min, 0) / h,
      max: duplicados.reduce((t, g) => t + g.ahorro.max, 0) / h,
    },
  };
}
