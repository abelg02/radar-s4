// Informe ejecutivo en 5 páginas A4. Se genera en HTML y el navegador lo guarda como PDF (Imprimir → Guardar como PDF).
import type { Analisis, ResultadoObjeto } from '../tipos';
import { barraApilada, barrasRango, mapaRiesgo } from '../ui/graficos';
import { CATEGORIAS, DECISIONES, DESTINOS, NIVELES, ORDEN_DECISION, esc, num, pct, rango, tipo } from '../ui/util';
import { conclusiones, datosQueFaltan } from './conclusiones';

const pie = (n: number) => `<footer class="pag-pie"><span>Generado con Radar S/4 · herramienta gratuita de Abel González Guerra · no afiliado a SAP</span><span>${n} / 5</span></footer>`;

function criticos(a: Analisis, n: number): ResultadoObjeto[] {
  return a.resultados
    .filter((r) => r.decision === 'adaptar' || r.decision === 'rehacer')
    .sort((x, y) => (y.ejecuciones ?? 0) * (y.complejidad + 1) - (x.ejecuciones ?? 0) * (x.complejidad + 1) || y.esfuerzo.max - x.esfuerzo.max)
    .slice(0, n);
}

export function htmlInforme(a: Analisis): string {
  const r = a.resumen;
  const fecha = new Date(a.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const decisiones = barraApilada(ORDEN_DECISION.map((d) => ({ nombre: DECISIONES[d].nombre, valor: r.porDecision[d], color: DECISIONES[d].color })));
  const niveles = barraApilada((['A', 'B', 'C', 'D'] as const).map((n) => ({ nombre: NIVELES[n].nombre, valor: r.porNivel[n], color: NIVELES[n].color })));
  const filaCritico = (o: ResultadoObjeto) => `<tr><td><b>${esc(o.objeto.nombre)}</b><br><span class="tenue">${esc(tipo(o.objeto.tipo))} · ${esc(o.objeto.paquete)}</span></td><td>${DECISIONES[o.decision].nombre}</td><td>${o.nivel}</td><td class="num">${o.ejecuciones === null ? '—' : num(o.ejecuciones)}</td><td class="num">${num(o.esfuerzo.min)}–${num(o.esfuerzo.max)} h</td><td>${esc(o.motivos[0] || '')}</td></tr>`;

  const s4 = Object.entries(r.hallazgosPorCategoria).sort((x, y) => y[1] - x[1]);
  const porRegla = new Map<string, { titulo: string; n: number; objetos: Set<string> }>();
  for (const o of a.resultados) for (const h of o.hallazgos) {
    if (h.categoria !== 's4' && h.categoria !== 'cloud') continue;
    const e = porRegla.get(h.regla) || { titulo: h.titulo, n: 0, objetos: new Set<string>() };
    e.n++; e.objetos.add(o.objeto.id);
    porRegla.set(h.regla, e);
  }
  const reglas = [...porRegla].sort((x, y) => y[1].objetos.size - x[1].objetos.size).slice(0, 12);

  return `
<section class="pagina">
  <header class="pag-cab"><span class="marca">Radar S/4</span><span>Informe de migración del código Z</span></header>
  <h1>${esc(a.nombre)}</h1>
  <p class="sub">Destino: <b>${esc(DESTINOS[a.opciones.destino].nombre)}</b> · ${esc(fecha)}${r.tieneUso ? ` · Uso real${r.periodoUso ? ` del ${esc(r.periodoUso)}` : ''}` : ' · Sin datos de uso'}</p>
  <div class="kpis">
    <div><span>Objetos Z</span><b>${num(r.objetos)}</b></div>
    <div><span>Líneas de código</span><b>${num(r.lineas)}</b></div>
    <div><span>Se pueden retirar</span><b>${r.tieneUso ? pct(r.porDecision.retirar, r.objetos) : '—'}</b></div>
    <div><span>Esfuerzo estimado</span><b>${rango(r.esfuerzo.min, r.esfuerzo.max)}</b><small>jornadas</small></div>
  </div>
  <h2>Qué hacer con cada objeto</h2>${decisiones}
  <h2>Nivel de clean core</h2>${niveles}
  <h2>Conclusiones</h2><ol class="conclusiones">${conclusiones(a).map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
  <h2>Qué no incluye este análisis</h2><ul class="faltan">${datosQueFaltan(a).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  ${pie(1)}
</section>

<section class="pagina">
  <header class="pag-cab"><span class="marca">Radar S/4</span><span>Mapa de riesgo</span></header>
  <h2>Uso frente a complejidad del cambio</h2>
  <p class="nota">Cada punto es un objeto que se migra. Arriba a la derecha, lo que más se usa y más cuesta cambiar: conviene empezar por ahí las pruebas.</p>
  ${mapaRiesgo(a.resultados, 760, 340)}
  <ul class="leyenda">${(['mantener', 'adaptar', 'rehacer'] as const).map((d) => `<li><span class="punto" style="background:${DECISIONES[d].color}"></span>${DECISIONES[d].nombre}</li>`).join('')}</ul>
  <h2>Objetos críticos</h2>
  <table class="tabla"><thead><tr><th>Objeto</th><th>Decisión</th><th>Nivel</th><th class="num">Ejecuciones</th><th class="num">Esfuerzo</th><th>Motivo principal</th></tr></thead><tbody>${criticos(a, 10).map(filaCritico).join('')}</tbody></table>
  ${pie(2)}
</section>

<section class="pagina">
  <header class="pag-cab"><span class="marca">Radar S/4</span><span>Plan por fases</span></header>
  <h2>Plan por fases</h2>
  ${barrasRango(r.porFase.map((f) => ({ nombre: `${f.fase}. ${f.nombre}`, min: f.min, max: f.max, nota: `${num(f.objetos)} objetos` })), 'jornadas')}
  ${r.porFase.map((f) => {
    const objs = a.resultados.filter((o) => o.fase === f.fase).sort((x, y) => y.esfuerzo.max - x.esfuerzo.max);
    if (!objs.length) return '';
    return `<h3>Fase ${f.fase} · ${esc(f.nombre)} <span class="tenue">${num(f.objetos)} objetos · ${rango(f.min, f.max)} jornadas</span></h3>
      <p class="lista-objetos">${objs.slice(0, 18).map((o) => esc(o.objeto.nombre)).join(' · ')}${objs.length > 18 ? ` · y ${num(objs.length - 18)} más (en el CSV del plan)` : ''}</p>`;
  }).join('')}
  ${pie(3)}
</section>

<section class="pagina">
  <header class="pag-cab"><span class="marca">Radar S/4</span><span>Detalle técnico</span></header>
  <h2>Objetos de SAP no liberados más usados</h2>
  <table class="tabla"><thead><tr><th>Objeto de SAP</th><th>Nivel</th><th class="num">Objetos Z</th><th>Sucesor indicado por SAP</th></tr></thead>
  <tbody>${r.topSap.filter((s) => s.nivel !== 'A').slice(0, 12).map((s) => `<tr><td><b>${esc(s.nombre)}</b></td><td>${s.nivel}</td><td class="num">${num(s.objetos)}</td><td>${s.sucesores.length ? esc(s.sucesores.slice(0, 3).join(', ')) : '<span class="tenue">Sin sucesor en la lista</span>'}</td></tr>`).join('')}</tbody></table>
  <h2>Hallazgos de migración y ABAP Cloud</h2>
  <table class="tabla"><thead><tr><th>Regla</th><th>Hallazgo</th><th class="num">Apariciones</th><th class="num">Objetos</th></tr></thead>
  <tbody>${reglas.map(([id, e]) => `<tr><td>${esc(id)}</td><td>${esc(e.titulo)}</td><td class="num">${num(e.n)}</td><td class="num">${num(e.objetos.size)}</td></tr>`).join('')}</tbody></table>
  <p class="nota">Total de hallazgos por categoría: ${s4.map(([c, n]) => `${esc(CATEGORIAS[c] || c)} ${num(n)}`).join(' · ')}.</p>
  ${pie(4)}
</section>

<section class="pagina">
  <header class="pag-cab"><span class="marca">Radar S/4</span><span>Supuestos y metodología</span></header>
  <h2>Supuestos de esfuerzo</h2>
  <table class="tabla"><thead><tr><th>Supuesto</th><th class="num">Horas</th><th>Fuente</th></tr></thead>
  <tbody>${a.opciones.supuestos.map((s) => `<tr><td><b>${esc(s.nombre)}</b><br><span class="tenue">${esc(s.descripcion)}</span></td><td class="num">${String(s.min).replace('.', ',')}–${String(s.max).replace('.', ',')}</td><td>${esc(s.fuente)}</td></tr>`).join('')}</tbody></table>
  <p class="nota">Jornada de ${a.opciones.horasPorJornada} horas. El resultado es un rango, nunca una cifra única. ${r.sensibilidad.length ? `Supuestos que más mueven el total: ${r.sensibilidad.slice(0, 3).map((s) => `${esc(s.supuesto)} (${Math.round(s.peso * 100)} %)`).join(', ')}.` : ''}</p>
  <h2>Cómo se decide</h2>
  <ul class="metodo">
    <li><b>Retirar:</b> sin ejecuciones en el periodo medido${a.opciones.reglas.ausenteEsSinUso ? ' (o ausente del CSV de uso)' : ''} y sin objetos que lo necesiten${a.opciones.reglas.retirarEnCadena ? ', salvo otros que también se retiran' : ''}.</li>
    <li><b>Rehacer:</b> ${a.opciones.destino === 's4pub' ? 'usa tecnología que no existe en ABAP Cloud, más de dos objetos de SAP no liberados sin sucesor o algún uso de nivel D.' : a.opciones.reglas.nivelDEsRehacer ? 'tiene usos de nivel D (escritura en tablas de SAP, objetos "noAPI" o ampliaciones implícitas).' : 'no se propone en este destino con las reglas elegidas.'}</li>
    <li><b>Adaptar:</b> tiene hallazgos obligatorios de S/4HANA${a.opciones.destino !== 's4op' ? ' o de ABAP Cloud' : ''}, u objetos de SAP que sustituir.</li>
    <li><b>Mantener:</b> el resto.</li>
    <li><b>Nivel de clean core:</b> modelo de niveles A a D de SAP, a partir del Cloudification Repository (${esc(r.datosSap.commit)}, ${num(r.datosSap.objetos)} objetos de SAP).</li>
  </ul>
  <h2>Límites</h2>
  <ul class="metodo">
    <li>Analiza el código exportado con abapGit; no accede al sistema. Es una primera foto para decidir cómo empezar.</li>
    <li>Complementa, no sustituye, a SAP Readiness Check, al ATC y a la app Custom Code Migration.</li>
    <li>Las horas son supuestos editables, no datos de SAP. Ajústalos a tu equipo antes de presupuestar.</li>
    <li>El análisis se hace en el navegador: el código no se envía a ningún servidor.</li>
    <li>Resultados orientativos, sin garantía. Lista de objetos de SAP: Cloudification Repository, © SAP SE, licencia Apache 2.0.</li>
  </ul>
  ${pie(5)}
</section>`;
}

export function imprimirInforme(a: Analisis) {
  const cont = document.getElementById('informe')!;
  cont.innerHTML = htmlInforme(a);
  const titulo = document.title;
  document.title = `Radar S4 - ${a.nombre} - ${DESTINOS[a.opciones.destino].corto}`;
  window.addEventListener('afterprint', () => { document.title = titulo; }, { once: true });
  window.print();
}

