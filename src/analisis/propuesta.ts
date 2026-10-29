// Propuesta de cambio: lo que se puede corregir solo (sintaxis segura, con el motor de CleanCore Check)
// y la lista de cambios manuales con el sucesor que indica SAP. También el ZIP de abapGit corregido.
import { zipSync, strToU8 } from 'fflate';
import type { Analisis, Archivo, Destino, ResultadoObjeto } from '../tipos';
import { CleanCore } from './motor';
import { DESTINOS } from '../ui/util';

export interface CambioLinea {
  linea: number;
  regla: string;
  de: string;
  a: string;
}

export interface Manual {
  linea: number;
  titulo: string;
  detalle: string;
  ejemplo?: string;
}

export interface Propuesta {
  original: string;
  propuesto: string;
  cambios: CambioLinea[];
  manuales: Manual[];
}

/** Propuesta para un objeto, sobre su código unido (las líneas coinciden con las del análisis). */
export function propuestaObjeto(r: ResultadoObjeto, destino: Destino): Propuesta {
  const original = r.objeto.tipo === 'TABL' ? '' : r.objeto.fuente;
  const auto = original && ['PROG', 'CLAS', 'INTF', 'FUNC', 'FUGR', 'ENHO'].includes(r.objeto.tipo)
    ? CleanCore.modernize(original, { target: destino })
    : { code: original, changes: [] };
  const cambios = auto.changes.map((c) => ({ linea: c.line, regla: c.rule, de: c.from, a: c.to }));
  const corregidas = new Set(cambios.map((c) => c.linea));

  const manuales: Manual[] = [];
  for (const s of r.sap) {
    if (s.nivel === 'A') continue;
    manuales.push({
      linea: s.lineas[0] || 0,
      titulo: `${s.nombre} (nivel ${s.nivel})`,
      detalle: s.sucesores.length ? `${s.motivo} Sucesor que indica SAP: ${s.sucesores.slice(0, 4).join(', ')}.` : s.motivo,
    });
  }
  const relevantes = new Set(['s4', 'cloud', 'release', 'security']);
  for (const h of r.hallazgos) {
    if (!relevantes.has(h.categoria) || h.severidad === 'info' || corregidas.has(h.linea)) continue;
    if (['CLD-002', 'CLD-006', 'CLD-010', 'SEC-008'].includes(h.regla)) continue; // ya están arriba, con el sucesor oficial
    manuales.push({ linea: h.linea, titulo: `${h.titulo} (${h.regla})`, detalle: h.detalle, ejemplo: h.correccion });
  }
  manuales.sort((a, b) => a.linea - b.linea);
  return { original, propuesto: auto.code, cambios, manuales };
}

/**
 * ZIP con el repositorio tal cual llegó, con las correcciones automáticas aplicadas a cada archivo .abap,
 * y un CAMBIOS-RADAR-S4.md con lo cambiado y lo que queda a mano. Se importa de nuevo con abapGit.
 */
export function zipCorregido(a: Analisis, archivos: Archivo[]): { zip: Uint8Array; archivosCambiados: number; cambios: number } {
  const destino = a.opciones.destino;
  const salida: Record<string, Uint8Array> = {};
  const informe: string[] = [
    `# Cambios propuestos por Radar S/4`,
    '',
    `Destino: ${DESTINOS[destino].nombre}. Solo se han aplicado correcciones de sintaxis seguras (las mismas de CleanCore Check).`,
    'Revisa cada cambio, compila y prueba antes de importar en un sistema. Lo que requiere decisión está en la lista de cambios manuales.',
    '',
  ];
  let archivosCambiados = 0;
  let cambios = 0;
  for (const f of archivos) {
    let contenido = f.contenido;
    if (/\.abap$/i.test(f.ruta) && !/\.testclasses\.abap$/i.test(f.ruta)) {
      const r = CleanCore.modernize(f.contenido, { target: destino });
      if (r.changes.length) {
        // Respeta el fin de línea original
        contenido = /\r\n/.test(f.contenido) ? r.code.replace(/\r?\n/g, '\r\n') : r.code;
        archivosCambiados++;
        cambios += r.changes.length;
        informe.push(`## ${f.ruta}`, '', ...r.changes.map((c) => `- Línea ${c.line} (${c.rule}): \`${c.from}\` → \`${c.to}\``), '');
      }
    }
    salida[f.ruta] = strToU8(contenido);
  }
  informe.push('## Cambios manuales por objeto', '');
  for (const r of a.resultados) {
    if (r.decision === 'retirar' || r.decision === 'mantener') continue;
    const p = propuestaObjeto(r, destino);
    if (!p.manuales.length) continue;
    informe.push(`### ${r.objeto.nombre} (${r.decision})`, '', ...p.manuales.map((m) => `- Línea ${m.linea}: ${m.titulo}. ${m.detalle}`), '');
  }
  informe.push('', 'Generado con Radar S/4, herramienta gratuita de Abel González Guerra. No afiliada a SAP. Sin garantía.');
  salida['CAMBIOS-RADAR-S4.md'] = strToU8(informe.join('\n'));
  return { zip: zipSync(salida, { level: 6 }), archivosCambiados, cambios };
}
