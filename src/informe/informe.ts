// Informe ejecutivo en 5 páginas A4, en español o en inglés. Se genera en HTML y el navegador lo guarda como PDF.
import { esCloud, type Analisis, type ResultadoObjeto } from '../tipos';
import { barraApilada, barrasRango, gantt, mapaRiesgo } from '../ui/graficos';
import { calendario } from '../esfuerzo/calendario';
import { CATEGORIAS, DECISIONES, DESTINOS, NIVELES, ORDEN_DECISION, conIdioma, esc, idioma, num, pct, rango, tipo, tr, type Idioma } from '../ui/util';
import { conclusiones, datosQueFaltan, veredictoCalendario } from './conclusiones';
import { motivoEn } from './en';
import { porPaquete } from './paquetes';

const TXT = {
  es: {
    pie: 'Generado con Radar S/4 · herramienta gratuita de Abel González Guerra · no afiliado a SAP',
    titulo: 'Informe de migración del código Z', destino: 'Destino', usoReal: 'Uso real', del: 'del', sinUso: 'Sin datos de uso',
    objetosZ: 'Objetos Z', lineas: 'Líneas de código', retirables: 'Se pueden retirar', esfuerzo: 'Esfuerzo estimado', jornadas: 'jornadas',
    queHacer: 'Qué hacer con cada objeto', nivel: 'Nivel de clean core', conclusiones: 'Conclusiones', noIncluye: 'Qué no incluye este análisis',
    mapa: 'Mapa de riesgo', usoComplejidad: 'Uso frente a complejidad del cambio',
    notaMapa: 'Cada punto es un objeto que se migra. Arriba a la derecha, lo que más se usa y más cuesta cambiar: conviene empezar por ahí las pruebas.',
    criticos: 'Objetos críticos', objeto: 'Objeto', decision: 'Decisión', nivelCorto: 'Nivel', ejecuciones: 'Ejecuciones', motivo: 'Motivo principal',
    plan: 'Plan por fases', calendario: 'Calendario', dedicacion: 'de dedicación, desde el', fase: 'Fase', objetos: 'objetos', yMas: (n: string) => `y ${n} más (en el CSV del plan)`,
    detalle: 'Detalle técnico', paquetes: 'Por paquete', paquete: 'Paquete', sinUsoCorto: 'Sin uso', sapNoLib: 'Objetos de SAP no liberados más usados', objSap: 'Objeto de SAP',
    sucesor: 'Sucesor indicado por SAP', sinSucesor: 'Sin sucesor en la lista', duplicado: 'Código casi duplicado', iguales: 'Iguales', ahorro: 'Ahorro si se unifican',
    hallazgos: 'Hallazgos de migración y ABAP Cloud', regla: 'Regla', hallazgo: 'Hallazgo', apariciones: 'Apariciones', totalCat: 'Total de hallazgos por categoría',
    metodologia: 'Supuestos y metodología', supuestos: 'Supuestos de esfuerzo', supuesto: 'Supuesto', horas: 'Horas', fuente: 'Fuente',
    notaSup: (h: number) => `Jornada de ${h} horas. El resultado es un rango, nunca una cifra única.`, mueven: 'Supuestos que más mueven el total',
    comoSeDecide: 'Cómo se decide', limites: 'Límites',
  },
  en: {
    pie: 'Generated with Radar S/4 · free tool by Abel González Guerra · not affiliated with SAP',
    titulo: 'Custom code migration report', destino: 'Target', usoReal: 'Actual usage', del: 'from', sinUso: 'No usage data',
    objetosZ: 'Custom objects', lineas: 'Lines of code', retirables: 'Can be retired', esfuerzo: 'Estimated effort', jornadas: 'person-days',
    queHacer: 'What to do with each object', nivel: 'Clean core level', conclusiones: 'Conclusions', noIncluye: 'What this analysis does not include',
    mapa: 'Risk map', usoComplejidad: 'Usage versus change complexity',
    notaMapa: 'Each dot is an object that is migrated. Top right: what is used most and costs most to change. Start testing there.',
    criticos: 'Critical objects', objeto: 'Object', decision: 'Decision', nivelCorto: 'Level', ejecuciones: 'Executions', motivo: 'Main reason',
    plan: 'Phased plan', calendario: 'Schedule', dedicacion: 'allocation, starting', fase: 'Phase', objetos: 'objects', yMas: (n: string) => `and ${n} more (in the plan CSV)`,
    detalle: 'Technical detail', paquetes: 'By package', paquete: 'Package', sinUsoCorto: 'Not used', sapNoLib: 'Most used non-released SAP objects', objSap: 'SAP object',
    sucesor: 'Successor named by SAP', sinSucesor: 'No successor in the list', duplicado: 'Near-duplicate code', iguales: 'Similar', ahorro: 'Saving if consolidated',
    hallazgos: 'Migration and ABAP Cloud findings', regla: 'Rule', hallazgo: 'Finding', apariciones: 'Occurrences', totalCat: 'Total findings by category',
    metodologia: 'Assumptions and methodology', supuestos: 'Effort assumptions', supuesto: 'Assumption', horas: 'Hours', fuente: 'Source',
    notaSup: (h: number) => `${h}-hour working day. The result is a range, never a single figure.`, mueven: 'Assumptions that move the total most',
    comoSeDecide: 'How decisions are made', limites: 'Limits',
  },
};

function criticos(a: Analisis, n: number): ResultadoObjeto[] {
  return a.resultados
    .filter((r) => r.decision === 'adaptar' || r.decision === 'rehacer')
    .sort((x, y) => (y.ejecuciones ?? 0) * (y.complejidad + 1) - (x.ejecuciones ?? 0) * (x.complejidad + 1) || y.esfuerzo.max - x.esfuerzo.max)
    .slice(0, n);
}

const motivo = (m: string) => (idioma() === 'en' ? motivoEn(m) : m);
const horas = (n: number) => (idioma() === 'en' ? String(n) : String(n).replace('.', ','));

function metodo(a: Analisis): { decide: string[]; limites: string[] } {
  const r = a.resumen;
  const o = a.opciones;
  const cloud = esCloud(o.destino);
  if (idioma() === 'en') {
    return {
      decide: [
        `<b>Retire:</b> no executions in the measured period${o.reglas.ausenteEsSinUso ? ' (or absent from the usage CSV)' : ''} and no objects that depend on it${o.reglas.retirarEnCadena ? ', except others that are also retired' : ''}.`,
        `<b>Rebuild:</b> ${cloud ? 'uses technology not available in ABAP Cloud, more than two non-released SAP objects with no successor, or any level D usage.' : o.reglas.nivelDEsRehacer ? 'has level D usages (writes to SAP tables, "noAPI" objects or implicit enhancements).' : 'not proposed for this target with the chosen rules.'}`,
        `<b>Adapt:</b> has mandatory S/4HANA${o.destino !== 's4op' ? ' or ABAP Cloud' : ''} findings, or SAP objects to replace.`,
        '<b>Keep:</b> everything else.',
        `<b>Clean core level:</b> SAP's A to D level model, based on the Cloudification Repository (${esc(r.datosSap.commit)}, ${num(r.datosSap.objetos)} SAP objects).`,
        '<b>Near-duplicate code:</b> sequences of statements compared with the Jaccard index (70% or more), ignoring comments and literals.',
      ],
      limites: [
        'It analyses the code exported with abapGit; it does not access the system. It is a first snapshot to decide how to start.',
        'It complements, and does not replace, SAP Readiness Check, the ATC and the Custom Code Migration app.',
        'Hours are editable assumptions, not SAP data. Adjust them to your team before budgeting.',
        'The analysis runs in the browser: the code is not sent to any server.',
        'Indicative results, without warranty. SAP object list: Cloudification Repository, © SAP SE, Apache License 2.0.',
      ],
    };
  }
  return {
    decide: [
      `<b>Retirar:</b> sin ejecuciones en el periodo medido${o.reglas.ausenteEsSinUso ? ' (o ausente del CSV de uso)' : ''} y sin objetos que lo necesiten${o.reglas.retirarEnCadena ? ', salvo otros que también se retiran' : ''}.`,
      `<b>Rehacer:</b> ${cloud ? 'usa tecnología que no existe en ABAP Cloud, más de dos objetos de SAP no liberados sin sucesor o algún uso de nivel D.' : o.reglas.nivelDEsRehacer ? 'tiene usos de nivel D (escritura en tablas de SAP, objetos "noAPI" o ampliaciones implícitas).' : 'no se propone en este destino con las reglas elegidas.'}`,
      `<b>Adaptar:</b> tiene hallazgos obligatorios de S/4HANA${o.destino !== 's4op' ? ' o de ABAP Cloud' : ''}, u objetos de SAP que sustituir.`,
      '<b>Mantener:</b> el resto.',
      `<b>Nivel de clean core:</b> modelo de niveles A a D de SAP, a partir del Cloudification Repository (${esc(r.datosSap.commit)}, ${num(r.datosSap.objetos)} objetos de SAP).`,
      '<b>Código casi duplicado:</b> secuencias de sentencias comparadas con el índice de Jaccard (70 % o más), sin comentarios ni textos.',
    ],
    limites: [
      'Analiza el código exportado con abapGit; no accede al sistema. Es una primera foto para decidir cómo empezar.',
      'Complementa, no sustituye, a SAP Readiness Check, al ATC y a la app Custom Code Migration.',
      'Las horas son supuestos editables, no datos de SAP. Ajústalos a tu equipo antes de presupuestar.',
      'El análisis se hace en el navegador: el código no se envía a ningún servidor.',
      'Resultados orientativos, sin garantía. Lista de objetos de SAP: Cloudification Repository, © SAP SE, licencia Apache 2.0.',
    ],
  };
}

export function htmlInforme(a: Analisis, l: Idioma = 'es'): string {
  return conIdioma(l, () => generar(a));
}

function generar(a: Analisis): string {
  const T = TXT[idioma()];
  const r = a.resumen;
  const pie = (n: number) => `<footer class="pag-pie"><span>${T.pie}</span><span>${n} / 5</span></footer>`;
  const cab = (t: string) => `<header class="pag-cab"><span class="marca">Radar S/4</span><span>${t}</span></header>`;
  const fecha = new Date(a.fecha).toLocaleDateString(idioma() === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const decisiones = barraApilada(ORDEN_DECISION.map((d) => ({ nombre: tr(DECISIONES[d].nombre), valor: r.porDecision[d], color: DECISIONES[d].color })));
  const niveles = barraApilada((['A', 'B', 'C', 'D'] as const).map((n) => ({ nombre: tr(NIVELES[n].nombre), valor: r.porNivel[n], color: NIVELES[n].color })));
  const filaCritico = (o: ResultadoObjeto) => `<tr><td><b>${esc(o.objeto.nombre)}</b><br><span class="tenue">${esc(tipo(o.objeto.tipo))} · ${esc(o.objeto.paquete)}</span></td><td>${tr(DECISIONES[o.decision].nombre)}</td><td>${o.nivel}</td><td class="num">${o.ejecuciones === null ? '—' : num(o.ejecuciones)}</td><td class="num">${num(o.esfuerzo.min)}–${num(o.esfuerzo.max)} h</td><td>${esc(motivo(o.motivos[0] || ''))}</td></tr>`;
  const cal = calendario(r, a.opciones.equipo);
  const m = metodo(a);

  const cats = Object.entries(r.hallazgosPorCategoria).sort((x, y) => y[1] - x[1]);
  const porRegla = new Map<string, { titulo: string; n: number; objetos: Set<string> }>();
  for (const o of a.resultados) for (const h of o.hallazgos) {
    if (h.categoria !== 's4' && h.categoria !== 'cloud') continue;
    const e = porRegla.get(h.regla) || { titulo: h.titulo, n: 0, objetos: new Set<string>() };
    e.n++;
    e.objetos.add(o.objeto.id);
    porRegla.set(h.regla, e);
  }
  const reglas = [...porRegla].sort((x, y) => y[1].objetos.size - x[1].objetos.size).slice(0, 10);
  const paquetes = porPaquete(a).slice(0, 8);

  return `
<section class="pagina">
  ${cab(T.titulo)}
  <h1>${esc(tr(a.nombre))}</h1>
  <p class="sub">${T.destino}: <b>${esc(DESTINOS[a.opciones.destino].nombre)}</b> · ${esc(fecha)}${r.tieneUso ? ` · ${T.usoReal}${r.periodoUso ? ` ${T.del} ${esc(r.periodoUso)}` : ''}` : ` · ${T.sinUso}`}</p>
  <div class="kpis">
    <div><span>${T.objetosZ}</span><b>${num(r.objetos)}</b></div>
    <div><span>${T.lineas}</span><b>${num(r.lineas)}</b></div>
    <div><span>${T.retirables}</span><b>${r.tieneUso ? pct(r.porDecision.retirar, r.objetos) : '—'}</b></div>
    <div><span>${T.esfuerzo}</span><b>${rango(r.esfuerzo.min, r.esfuerzo.max)}</b><small>${T.jornadas}</small></div>
  </div>
  <h2>${T.queHacer}</h2>${decisiones}
  <h2>${T.nivel}</h2>${niveles}
  <h2>${T.conclusiones}</h2><ol class="conclusiones">${conclusiones(a).map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
  <h2>${T.noIncluye}</h2><ul class="faltan">${datosQueFaltan(a).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  ${pie(1)}
</section>

<section class="pagina">
  ${cab(T.mapa)}
  <h2>${T.usoComplejidad}</h2>
  <p class="nota">${T.notaMapa}</p>
  ${mapaRiesgo(a.resultados, 760, 340)}
  <ul class="leyenda">${(['mantener', 'adaptar', 'rehacer'] as const).map((d) => `<li><span class="punto" style="background:${DECISIONES[d].color}"></span>${tr(DECISIONES[d].nombre)}</li>`).join('')}</ul>
  <h2>${T.criticos}</h2>
  <table class="tabla"><thead><tr><th>${T.objeto}</th><th>${T.decision}</th><th>${T.nivelCorto}</th><th class="num">${T.ejecuciones}</th><th class="num">${T.esfuerzo}</th><th>${T.motivo}</th></tr></thead><tbody>${criticos(a, 10).map(filaCritico).join('')}</tbody></table>
  ${pie(2)}
</section>

<section class="pagina">
  ${cab(T.plan)}
  <h2>${T.calendario}</h2>
  <p>${esc(veredictoCalendario(cal, a.opciones.equipo.personas))} ${pct(a.opciones.equipo.dedicacion * 100, 100)} ${T.dedicacion} ${esc(a.opciones.equipo.inicio)}.</p>
  ${gantt(cal, 760)}
  <h2>${T.plan}</h2>
  ${barrasRango(r.porFase.map((f) => ({ nombre: `${f.fase}. ${tr(f.nombre)}`, min: f.min, max: f.max, nota: `${num(f.objetos)} ${T.objetos}` })), 'jornadas')}
  ${r.porFase.map((f) => {
    const objs = a.resultados.filter((o) => o.fase === f.fase).sort((x, y) => y.esfuerzo.max - x.esfuerzo.max);
    if (!objs.length) return '';
    return `<h3>${T.fase} ${f.fase} · ${esc(tr(f.nombre))} <span class="tenue">${num(f.objetos)} ${T.objetos} · ${rango(f.min, f.max)} ${T.jornadas}</span></h3>
      <p class="lista-objetos">${objs.slice(0, 14).map((o) => esc(o.objeto.nombre)).join(' · ')}${objs.length > 14 ? ` · ${T.yMas(num(objs.length - 14))}` : ''}</p>`;
  }).join('')}
  ${pie(3)}
</section>

<section class="pagina">
  ${cab(T.detalle)}
  <h2>${T.paquetes}</h2>
  <table class="tabla"><thead><tr><th>${T.paquete}</th><th class="num">${T.objetosZ}</th>${ORDEN_DECISION.map((d) => `<th class="num">${tr(DECISIONES[d].nombre)}</th>`).join('')}<th class="num">${tr('Nivel D')}</th><th class="num">${T.esfuerzo}</th></tr></thead>
  <tbody>${paquetes.map((p) => `<tr><td><b>${esc(p.paquete)}</b></td><td class="num">${num(p.objetos)}</td>${ORDEN_DECISION.map((d) => `<td class="num">${num(p.porDecision[d])}</td>`).join('')}<td class="num">${num(p.porNivel.D)}</td><td class="num">${rango(p.min, p.max)}</td></tr>`).join('')}</tbody></table>
  <h2>${T.sapNoLib}</h2>
  <table class="tabla"><thead><tr><th>${T.objSap}</th><th>${T.nivelCorto}</th><th class="num">${T.objetosZ}</th><th>${T.sucesor}</th></tr></thead>
  <tbody>${r.topSap.filter((s) => s.nivel !== 'A').slice(0, 8).map((s) => `<tr><td><b>${esc(s.nombre)}</b></td><td>${s.nivel}</td><td class="num">${num(s.objetos)}</td><td>${s.sucesores.length ? esc(s.sucesores.slice(0, 3).join(', ')) : `<span class="tenue">${T.sinSucesor}</span>`}</td></tr>`).join('')}</tbody></table>
  ${a.duplicados.length ? `<h2>${T.duplicado}</h2><table class="tabla"><thead><tr><th>${T.objeto}</th><th class="num">${T.iguales}</th><th class="num">${T.ahorro}</th></tr></thead><tbody>${a.duplicados.slice(0, 4).map((g) => `<tr><td>${g.miembros.map((id) => esc(id.split(':')[1])).join(', ')}</td><td class="num">${pct(g.similitud * 100, 100)}</td><td class="num">${num(g.ahorro.min)}–${num(g.ahorro.max)} h</td></tr>`).join('')}</tbody></table>` : ''}
  <h2>${T.hallazgos}</h2>
  <table class="tabla"><thead><tr><th>${T.regla}</th><th>${T.hallazgo}</th><th class="num">${T.apariciones}</th><th class="num">${T.objetosZ}</th></tr></thead>
  <tbody>${reglas.map(([id, e]) => `<tr><td>${esc(id)}</td><td>${esc(tr(e.titulo))}</td><td class="num">${num(e.n)}</td><td class="num">${num(e.objetos.size)}</td></tr>`).join('')}</tbody></table>
  <p class="nota">${T.totalCat}: ${cats.map(([c, n]) => `${esc(tr(CATEGORIAS[c] || c))} ${num(n)}`).join(' · ')}.</p>
  ${pie(4)}
</section>

<section class="pagina">
  ${cab(T.metodologia)}
  <h2>${T.supuestos}</h2>
  <table class="tabla"><thead><tr><th>${T.supuesto}</th><th class="num">${T.horas}</th><th>${T.fuente}</th></tr></thead>
  <tbody>${a.opciones.supuestos.map((s) => `<tr><td><b>${esc(tr(s.nombre))}</b><br><span class="tenue">${esc(tr(s.descripcion))}</span></td><td class="num">${horas(s.min)}–${horas(s.max)}</td><td>${esc(tr(s.fuente))}</td></tr>`).join('')}</tbody></table>
  <p class="nota">${T.notaSup(a.opciones.horasPorJornada)} ${r.sensibilidad.length ? `${T.mueven}: ${r.sensibilidad.slice(0, 3).map((s) => `${esc(tr(s.supuesto))} (${pct(s.peso * 100, 100)})`).join(', ')}.` : ''}</p>
  <h2>${T.comoSeDecide}</h2>
  <ul class="metodo">${m.decide.map((x) => `<li>${x}</li>`).join('')}</ul>
  <h2>${T.limites}</h2>
  <ul class="metodo">${m.limites.map((x) => `<li>${x}</li>`).join('')}</ul>
  ${pie(5)}
</section>`;
}

export function imprimirInforme(a: Analisis, l: Idioma = 'es') {
  const cont = document.getElementById('informe')!;
  cont.innerHTML = htmlInforme(a, l);
  const titulo = document.title;
  document.title = `Radar S4 - ${a.nombre} - ${DESTINOS[a.opciones.destino].corto}${l === 'en' ? ' - EN' : ''}`;
  window.addEventListener('afterprint', () => { document.title = titulo; }, { once: true });
  window.print();
}
