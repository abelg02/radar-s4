// Plan de trabajo en CSV (Excel en español abre bien el ";" y el BOM UTF-8) e informe en Markdown.
import type { Analisis } from '../tipos';
import { DECISIONES, DESTINOS, USOS, rango, tipo } from '../ui/util';
import { conclusiones } from './conclusiones';

const celda = (v: unknown) => {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csvPlan(a: Analisis): string {
  const fases = a.resumen.porFase.map((f) => f.nombre);
  const cab = ['Fase', 'Paquete', 'Tipo', 'Objeto', 'Decisión', 'Nivel clean core', 'Uso', 'Ejecuciones', 'Última ejecución', 'Horas mín.', 'Horas máx.', 'Motivo', 'Objetos de SAP a sustituir', 'Sucesores indicados por SAP', 'Hallazgos S/4HANA', 'Lo usan'];
  const filas = [...a.resultados]
    .sort((x, y) => x.fase - y.fase || x.objeto.paquete.localeCompare(y.objeto.paquete) || x.objeto.nombre.localeCompare(y.objeto.nombre))
    .map((r) => {
      const sap = r.sap.filter((s) => s.nivel !== 'A');
      return [
        `${r.fase} · ${fases[r.fase]}`, r.objeto.paquete, tipo(r.objeto.tipo), r.objeto.nombre, DECISIONES[r.decision].nombre, r.nivel, USOS[r.uso],
        r.ejecuciones ?? '', r.ultimaEjecucion ?? '', r.esfuerzo.min.toString().replace('.', ','), r.esfuerzo.max.toString().replace('.', ','), r.motivos.join(' '),
        sap.map((s) => s.nombre).join(', '), [...new Set(sap.flatMap((s) => s.sucesores))].join(', '),
        r.hallazgos.filter((h) => h.categoria === 's4').length, r.usadoPor.length,
      ].map(celda).join(';');
    });
  return '﻿' + [cab.join(';'), ...filas].join('\r\n') + '\r\n';
}

export function markdown(a: Analisis): string {
  const r = a.resumen;
  const L = [
    `# Radar S/4 · ${a.nombre}`,
    '',
    `- Destino: ${DESTINOS[a.opciones.destino].nombre}`,
    `- Objetos Z: ${r.objetos} · líneas de código: ${r.lineas}`,
    `- Esfuerzo estimado: ${rango(r.esfuerzo.min, r.esfuerzo.max)} jornadas`,
    `- Uso real: ${r.tieneUso ? `sí${r.periodoUso ? ` (${r.periodoUso})` : ''}` : 'no cargado'}`,
    `- Lista oficial de SAP: Cloudification Repository ${r.datosSap.commit}`,
    '',
    '## Conclusiones',
    ...conclusiones(a).map((c) => `- ${c}`),
    '',
    '| Decisión | Objetos |',
    '|---|---|',
    ...(['retirar', 'mantener', 'adaptar', 'rehacer'] as const).map((d) => `| ${DECISIONES[d].nombre} | ${r.porDecision[d]} |`),
    '',
    '| Fase | Objetos | Jornadas |',
    '|---|---|---|',
    ...r.porFase.map((f) => `| ${f.fase} · ${f.nombre} | ${f.objetos} | ${rango(f.min, f.max)} |`),
    '',
    'Generado con Radar S/4, herramienta gratuita de Abel González Guerra. No afiliado a SAP. Complementa, no sustituye, a SAP Readiness Check y al ATC.',
  ];
  return L.join('\n');
}
