// Plan de trabajo en CSV (BOM UTF-8 y ";" para Excel en español; "," en inglés) y resumen en Markdown.
import type { Analisis } from '../tipos';
import { DECISIONES, DESTINOS, USOS, conIdioma, idioma, rango, tipo, tr, type Idioma } from '../ui/util';
import { conclusiones } from './conclusiones';
import { motivoEn } from './en';

const CABECERA = {
  es: ['Fase', 'Paquete', 'Tipo', 'Objeto', 'Decisión', 'Nivel clean core', 'Uso', 'Ejecuciones', 'Última ejecución', 'Horas mín.', 'Horas máx.', 'Motivo', 'Objetos de SAP a sustituir', 'Sucesores indicados por SAP', 'Hallazgos S/4HANA', 'Lo usan'],
  en: ['Phase', 'Package', 'Type', 'Object', 'Decision', 'Clean core level', 'Usage', 'Executions', 'Last execution', 'Min. hours', 'Max. hours', 'Reason', 'SAP objects to replace', 'Successors named by SAP', 'S/4HANA findings', 'Used by'],
};

export function csvPlan(a: Analisis, l: Idioma = 'es'): string {
  return conIdioma(l, () => {
    const sep = l === 'en' ? ',' : ';';
    const celda = (v: unknown) => {
      const s = String(v ?? '');
      return new RegExp(`[${sep}"\\n\\r]`).test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const horas = (n: number) => (l === 'en' ? String(n) : String(n).replace('.', ','));
    const filas = [...a.resultados]
      .sort((x, y) => x.fase - y.fase || x.objeto.paquete.localeCompare(y.objeto.paquete) || x.objeto.nombre.localeCompare(y.objeto.nombre))
      .map((r) => {
        const sap = r.sap.filter((s) => s.nivel !== 'A');
        const motivo = r.motivos.map((m) => (l === 'en' ? motivoEn(m) : m)).join(' ');
        return [
          `${r.fase} · ${tr(a.resumen.porFase[r.fase].nombre)}`, r.objeto.paquete, tipo(r.objeto.tipo), r.objeto.nombre, tr(DECISIONES[r.decision].nombre), r.nivel, tr(USOS[r.uso]),
          r.ejecuciones ?? '', r.ultimaEjecucion ?? '', horas(r.esfuerzo.min), horas(r.esfuerzo.max), motivo,
          sap.map((s) => s.nombre).join(', '), [...new Set(sap.flatMap((s) => s.sucesores))].join(', '),
          r.hallazgos.filter((h) => h.categoria === 's4').length, r.usadoPor.length,
        ].map(celda).join(sep);
      });
    return '﻿' + [CABECERA[l].join(sep), ...filas].join('\r\n') + '\r\n';
  });
}

export function markdown(a: Analisis, l: Idioma = 'es'): string {
  return conIdioma(l, () => {
    const r = a.resumen;
    const en = idioma() === 'en';
    const L = en
      ? [
          `# Radar S/4 · ${a.nombre}`, '',
          `- Target: ${DESTINOS[a.opciones.destino].nombre}`,
          `- Custom objects: ${r.objetos} · lines of code: ${r.lineas}`,
          `- Estimated effort: ${rango(r.esfuerzo.min, r.esfuerzo.max)} person-days`,
          `- Actual usage: ${r.tieneUso ? `yes${r.periodoUso ? ` (${r.periodoUso})` : ''}` : 'not loaded'}`,
          `- SAP object list: Cloudification Repository ${r.datosSap.commit}`, '', '## Conclusions',
        ]
      : [
          `# Radar S/4 · ${a.nombre}`, '',
          `- Destino: ${DESTINOS[a.opciones.destino].nombre}`,
          `- Objetos Z: ${r.objetos} · líneas de código: ${r.lineas}`,
          `- Esfuerzo estimado: ${rango(r.esfuerzo.min, r.esfuerzo.max)} jornadas`,
          `- Uso real: ${r.tieneUso ? `sí${r.periodoUso ? ` (${r.periodoUso})` : ''}` : 'no cargado'}`,
          `- Lista oficial de SAP: Cloudification Repository ${r.datosSap.commit}`, '', '## Conclusiones',
        ];
    L.push(...conclusiones(a).map((c) => `- ${c}`), '');
    L.push(en ? '| Decision | Objects |' : '| Decisión | Objetos |', '|---|---|');
    L.push(...(['retirar', 'mantener', 'adaptar', 'rehacer'] as const).map((d) => `| ${tr(DECISIONES[d].nombre)} | ${r.porDecision[d]} |`), '');
    L.push(en ? '| Phase | Objects | Person-days |' : '| Fase | Objetos | Jornadas |', '|---|---|---|');
    L.push(...r.porFase.map((f) => `| ${f.fase} · ${tr(f.nombre)} | ${f.objetos} | ${rango(f.min, f.max)} |`), '');
    L.push(en
      ? 'Generated with Radar S/4, a free tool by Abel González Guerra. Not affiliated with SAP. Complements, and does not replace, SAP Readiness Check and the ATC.'
      : 'Generado con Radar S/4, herramienta gratuita de Abel González Guerra. No afiliado a SAP. Complementa, no sustituye, a SAP Readiness Check y al ATC.');
    return L.join('\n');
  });
}
