// Panel de resultados: resumen, objetos, mapa de riesgo, plan por fases, objetos de SAP y supuestos.
import type { Decision, Destino, Nivel, ResultadoObjeto } from '../tipos';
import type { Estado } from '../main';
import { cambiarDestino, guardarOpciones, recalcular, volverAlInicio } from '../main';
import { conclusiones, datosQueFaltan, veredictoCalendario } from '../informe/conclusiones';
import { csvPlan, markdown } from '../informe/exportar';
import { imprimirInforme } from '../informe/informe';
import { SUPUESTOS_POR_DEFECTO, REGLAS_POR_DEFECTO } from '../esfuerzo/supuestos';
import { propuestaObjeto, zipCorregido } from '../analisis/propuesta';
import { calendario } from '../esfuerzo/calendario';
import { barraApilada, barrasRango, gantt, mapaRiesgo } from './graficos';
import { $, $$, CATEGORIAS, DECISIONES, DESTINOS, NIVELES, ORDEN_DECISION, USOS, dec, descargar, esc, num, pct, rango, tipo } from './util';

const PESTANAS = [
  ['resumen', 'Resumen'],
  ['objetos', 'Objetos'],
  ['mapa', 'Mapa de riesgo'],
  ['plan', 'Plan y calendario'],
  ['duplicados', 'Duplicados'],
  ['sap', 'Objetos de SAP'],
  ['supuestos', 'Supuestos y reglas'],
] as const;
type Pestana = (typeof PESTANAS)[number][0];

const filtros = { texto: '', decision: '' as Decision | '', nivel: '' as Nivel | '', tipo: '', paquete: '', orden: 'esfuerzo', limite: 200 };
let actual: Pestana = 'resumen';

export function pintarResultados(estado: Estado, pestana?: string) {
  const a = estado.analisis!;
  const r = a.resumen;
  if (pestana) actual = pestana as Pestana;
  document.title = `${a.nombre} · Radar S/4`;
  $('#app').innerHTML = `
  <section class="resultados">
    <div class="barra-resultados">
      <div>
        <button class="enlace volver" id="volver" type="button">← Analizar otro código</button>
        <h1>${esc(a.nombre)}</h1>
        <p class="tenue">${num(r.objetos)} objetos Z · ${num(r.lineas)} líneas de código · ${r.tieneUso ? `uso real${r.periodoUso ? ` del ${esc(r.periodoUso)}` : ''}${estado.esEjemplo ? ' (inventado)' : ''}` : 'sin datos de uso'}</p>
      </div>
      <div class="acciones">
        <label class="selector">Destino
          <select id="destino">${(Object.keys(DESTINOS) as Destino[]).map((d) => `<option value="${d}" ${a.opciones.destino === d ? 'selected' : ''}>${DESTINOS[d].nombre}</option>`).join('')}</select>
        </label>
        <button class="boton" id="pdf" type="button">Informe PDF</button>
        <button class="boton secundario" id="csv" type="button">Plan en CSV</button>
        <button class="boton secundario" id="zip" type="button" title="El repositorio con las correcciones de sintaxis seguras aplicadas, para importarlo con abapGit">Código corregido (ZIP)</button>
        <button class="boton secundario" id="md" type="button">Copiar resumen</button>
      </div>
    </div>
    ${estado.esEjemplo ? '<div class="aviso">Sistema de ejemplo: el código y el uso son ficticios, generados para probar la herramienta. Los objetos de SAP y su estado son reales.</div>' : ''}
    ${a.avisos.map((x) => `<div class="aviso">${esc(x)}</div>`).join('')}
    <nav class="pestanas" role="tablist">${PESTANAS.map(([id, t]) => `<button role="tab" data-p="${id}" class="${actual === id ? 'activa' : ''}">${t}</button>`).join('')}</nav>
    <div id="contenido"></div>
  </section>`;

  $('#volver').addEventListener('click', () => { history.pushState(null, '', './'); volverAlInicio(); });
  $('#destino').addEventListener('change', (e) => cambiarDestino((e.target as HTMLSelectElement).value as Destino));
  $('#pdf').addEventListener('click', () => imprimirInforme(a));
  $('#csv').addEventListener('click', () => descargar(`radar-s4-plan-${a.nombre.replace(/[^\w-]+/g, '_')}.csv`, csvPlan(a)));
  $('#zip').addEventListener('click', () => {
    const { zip, archivosCambiados, cambios } = zipCorregido(a, estado.archivos);
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
    const enlace = Object.assign(document.createElement('a'), { href: url, download: `radar-s4-corregido-${a.nombre.replace(/[^\w-]+/g, '_')}.zip` });
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const b = $('#zip');
    b.textContent = `${num(cambios)} cambios en ${num(archivosCambiados)} archivos`;
    setTimeout(() => (b.textContent = 'Código corregido (ZIP)'), 3000);
  });
  $('#md').addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try { await navigator.clipboard.writeText(markdown(a)); b.textContent = 'Copiado'; } catch { descargar('radar-s4-resumen.md', markdown(a), 'text/markdown'); }
    setTimeout(() => (b.textContent = 'Copiar resumen'), 1600);
  });
  $$('.pestanas button').forEach((b) => b.addEventListener('click', () => {
    actual = b.dataset.p as Pestana;
    $$('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b));
    pintarPestana(estado);
  }));
  pintarPestana(estado);
}

function pintarPestana(estado: Estado) {
  const c = $('#contenido');
  const pintores: Record<Pestana, (e: Estado, c: HTMLElement) => void> = { resumen, objetos, mapa, plan, duplicados, sap, supuestos };
  pintores[actual](estado, c);
}

// ------------------------------------------------------------------ Resumen
function resumen(estado: Estado, c: HTMLElement) {
  const a = estado.analisis!;
  const r = a.resumen;
  c.innerHTML = `
  <div class="kpis">
    <div><span>Objetos Z</span><b>${num(r.objetos)}</b><small>${Object.entries(r.porTipo).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t, n]) => `${num(n)} ${tipo(t).toLowerCase()}`).join(' · ')}</small></div>
    <div><span>Se pueden retirar</span><b>${r.tieneUso ? pct(r.porDecision.retirar, r.objetos) : '—'}</b><small>${r.tieneUso ? `${num(r.porDecision.retirar)} objetos sin uso` : 'Carga el uso real para saberlo'}</small></div>
    <div><span>Necesitan cambios</span><b>${num(r.porDecision.adaptar + r.porDecision.rehacer)}</b><small>${num(r.porDecision.adaptar)} adaptar · ${num(r.porDecision.rehacer)} rehacer</small></div>
    <div><span>Esfuerzo estimado</span><b>${rango(r.esfuerzo.min, r.esfuerzo.max)}</b><small>jornadas de ${a.opciones.horasPorJornada} h · <button class="enlace" data-ir="supuestos">ver supuestos</button></small></div>
  </div>
  <div class="dos">
    <div class="tarjeta"><h2>Qué hacer con cada objeto</h2>
      ${barraApilada(ORDEN_DECISION.map((d) => ({ nombre: DECISIONES[d].nombre, valor: r.porDecision[d], color: DECISIONES[d].color })))}
      <ul class="explica">${ORDEN_DECISION.map((d) => `<li><b>${DECISIONES[d].nombre}.</b> ${DECISIONES[d].texto}</li>`).join('')}</ul>
    </div>
    <div class="tarjeta"><h2>Nivel de clean core</h2>
      ${barraApilada((['A', 'B', 'C', 'D'] as const).map((n) => ({ nombre: NIVELES[n].nombre, valor: r.porNivel[n], color: NIVELES[n].color })))}
      <ul class="explica">${(['A', 'B', 'C', 'D'] as const).map((n) => `<li><b>${NIVELES[n].nombre}.</b> ${NIVELES[n].texto}</li>`).join('')}</ul>
    </div>
  </div>
  <div class="dos">
    <div class="tarjeta"><h2>Conclusiones</h2><ol class="conclusiones">${conclusiones(a).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
    <div class="tarjeta"><h2>Esfuerzo por fase</h2>
      ${barrasRango(r.porFase.map((f) => ({ nombre: `${f.fase}. ${f.nombre}`, min: f.min, max: f.max, nota: `${num(f.objetos)} obj.` })), 'jorn.')}
      <h3>Lo que más mueve el total</h3>
      <ul class="sensibilidad">${r.sensibilidad.slice(0, 3).map((s) => `<li><span>${esc(s.supuesto)}</span><b>${Math.round(s.peso * 100)} %</b></li>`).join('')}</ul>
    </div>
  </div>
  <div class="tarjeta"><h2>Qué no incluye este análisis</h2><ul class="faltan">${datosQueFaltan(a).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  $$('[data-ir]', c).forEach((b) => b.addEventListener('click', () => ($(`.pestanas [data-p="${b.dataset.ir}"]`) as HTMLButtonElement).click()));
}

// ------------------------------------------------------------------ Objetos
function filtrados(rs: ResultadoObjeto[]): ResultadoObjeto[] {
  const t = filtros.texto.trim().toUpperCase();
  const lista = rs.filter((r) =>
    (!filtros.decision || r.decision === filtros.decision) &&
    (!filtros.nivel || r.nivel === filtros.nivel) &&
    (!filtros.tipo || r.objeto.tipo === filtros.tipo) &&
    (!filtros.paquete || r.objeto.paquete === filtros.paquete) &&
    (!t || r.objeto.nombre.includes(t) || r.sap.some((s) => s.nombre.includes(t))));
  const ord: Record<string, (x: ResultadoObjeto, y: ResultadoObjeto) => number> = {
    esfuerzo: (x, y) => y.esfuerzo.max - x.esfuerzo.max,
    nombre: (x, y) => x.objeto.nombre.localeCompare(y.objeto.nombre),
    uso: (x, y) => (y.ejecuciones ?? -1) - (x.ejecuciones ?? -1),
    nivel: (x, y) => y.nivel.localeCompare(x.nivel) || y.esfuerzo.max - x.esfuerzo.max,
  };
  return lista.sort(ord[filtros.orden] || ord.esfuerzo);
}

function objetos(estado: Estado, c: HTMLElement) {
  const a = estado.analisis!;
  const tipos = [...new Set(a.resultados.map((r) => r.objeto.tipo))].sort();
  const paquetes = [...new Set(a.resultados.map((r) => r.objeto.paquete))].sort();
  c.innerHTML = `
  <div class="filtros">
    <input type="search" id="q" placeholder="Buscar objeto Z o de SAP (VBUK, BAPI_PO_CREATE1…)" value="${esc(filtros.texto)}">
    <select id="fd"><option value="">Todas las decisiones</option>${ORDEN_DECISION.map((d) => `<option value="${d}" ${filtros.decision === d ? 'selected' : ''}>${DECISIONES[d].nombre} (${a.resumen.porDecision[d]})</option>`).join('')}</select>
    <select id="fn"><option value="">Todos los niveles</option>${(['A', 'B', 'C', 'D'] as const).map((n) => `<option value="${n}" ${filtros.nivel === n ? 'selected' : ''}>${NIVELES[n].nombre} (${a.resumen.porNivel[n]})</option>`).join('')}</select>
    <select id="ft"><option value="">Todos los tipos</option>${tipos.map((t) => `<option value="${t}" ${filtros.tipo === t ? 'selected' : ''}>${esc(tipo(t))}</option>`).join('')}</select>
    <select id="fp"><option value="">Todos los paquetes</option>${paquetes.map((p) => `<option ${filtros.paquete === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
    <select id="fo"><option value="esfuerzo">Ordenar por esfuerzo</option><option value="nombre">por nombre</option><option value="uso">por uso</option><option value="nivel">por nivel</option></select>
  </div>
  <div class="tabla-envoltorio"><table class="tabla objetos"><thead><tr><th>Objeto</th><th>Decisión</th><th>Nivel</th><th>Uso</th><th class="num">Horas</th><th>Motivo</th></tr></thead><tbody id="filas"></tbody></table></div>
  <p id="mas" class="centro"></p>
  <div id="detalle" class="detalle" hidden></div>`;
  ($('#fo') as HTMLSelectElement).value = filtros.orden;

  const pintarFilas = () => {
    const lista = filtrados(a.resultados);
    $('#filas').innerHTML = lista.slice(0, filtros.limite).map((r) => `<tr data-id="${esc(r.objeto.id)}" tabindex="0">
      <td><b>${esc(r.objeto.nombre)}</b><br><span class="tenue">${esc(tipo(r.objeto.tipo))} · ${esc(r.objeto.paquete)}</span></td>
      <td><span class="chip" style="--c:${DECISIONES[r.decision].color}">${DECISIONES[r.decision].nombre}</span></td>
      <td><span class="nivel" style="--c:${NIVELES[r.nivel].color}">${r.nivel}</span></td>
      <td>${r.ejecuciones !== null ? `${num(r.ejecuciones)}` : `<span class="tenue">${USOS[r.uso]}</span>`}</td>
      <td class="num">${dec(r.esfuerzo.min)}–${dec(r.esfuerzo.max)}</td>
      <td class="motivo">${esc(r.motivos[0] || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="centro tenue">Ningún objeto con estos filtros.</td></tr>';
    $('#mas').innerHTML = lista.length > filtros.limite ? `<button class="boton secundario" id="ver-mas" type="button">Ver más (${num(lista.length - filtros.limite)} restantes)</button>` : `<span class="tenue">${num(lista.length)} objetos</span>`;
    $('#ver-mas')?.addEventListener('click', () => { filtros.limite += 300; pintarFilas(); });
    $$('#filas tr[data-id]').forEach((tr) => {
      const abrir = () => detalle(estado, tr.dataset.id!);
      tr.addEventListener('click', abrir);
      tr.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') abrir(); });
    });
  };
  const enlazar = (id: string, campo: keyof typeof filtros) => $(id).addEventListener(id === '#q' ? 'input' : 'change', (e) => {
    (filtros as Record<string, unknown>)[campo] = (e.target as HTMLInputElement).value;
    filtros.limite = 200;
    pintarFilas();
  });
  enlazar('#q', 'texto'); enlazar('#fd', 'decision'); enlazar('#fn', 'nivel'); enlazar('#ft', 'tipo'); enlazar('#fp', 'paquete'); enlazar('#fo', 'orden');
  pintarFilas();
}

function detalle(estado: Estado, id: string) {
  const a = estado.analisis!;
  const r = a.resultados.find((x) => x.objeto.id === id);
  if (!r) return;
  const nombres = new Map(a.opciones.supuestos.map((s) => [s.id, s.nombre]));
  const lineasMarcadas = new Map<number, string[]>();
  for (const h of r.hallazgos) lineasMarcadas.set(h.linea, [...(lineasMarcadas.get(h.linea) || []), `${h.regla} ${h.titulo}`]);
  for (const s of r.sap) for (const l of s.lineas) if (s.nivel !== 'A') lineasMarcadas.set(l, [...(lineasMarcadas.get(l) || []), `${s.nombre}: nivel ${s.nivel}`]);
  const prop = propuestaObjeto(r, a.opciones.destino);
  const cambiadas = new Map(prop.cambios.map((c) => [c.linea, c]));
  const pintarCodigo = (texto: string, propuesto: boolean) => texto ? texto.split(/\r?\n/).slice(0, 3000).map((l, i) => {
    const marca = lineasMarcadas.get(i + 1);
    const cambio = propuesto ? cambiadas.get(i + 1) : undefined;
    const clase = cambio ? ' cambiada' : marca ? ' marcada' : '';
    const titulo = cambio ? `Corregido (${cambio.regla}). Antes: ${cambio.de}` : marca ? marca.join(' · ') : '';
    return `<span class="ln${clase}" id="l-${i + 1}"${titulo ? ` title="${esc(titulo)}"` : ''}><i>${i + 1}</i>${esc(l) || ' '}</span>`;
  }).join('') : '';
  const codigo = pintarCodigo(prop.original, false);
  const propuestaHtml = r.decision === 'retirar' || (!prop.cambios.length && !prop.manuales.length) ? '' : `
    <h3>Propuesta de cambio</h3>
    <p class="tenue">${num(prop.cambios.length)} corrección(es) automática(s) de sintaxis segura · ${num(prop.manuales.length)} cambio(s) que requieren decisión.</p>
    ${prop.cambios.length ? `<table class="tabla compacta cambios"><tbody>${prop.cambios.slice(0, 40).map((c) => `<tr><td><a href="#l-${c.linea}" data-linea="${c.linea}">${c.linea}</a></td><td><code class="antes">${esc(c.de)}</code><br><code class="despues">${esc(c.a)}</code></td></tr>`).join('')}</tbody></table>` : ''}
    ${prop.manuales.length ? `<table class="tabla compacta"><tbody>${prop.manuales.slice(0, 40).map((m) => `<tr><td>${m.linea ? `<a href="#l-${m.linea}" data-linea="${m.linea}">${m.linea}</a>` : ''}</td><td><b>${esc(m.titulo)}</b>${m.detalle ? `<br><span class="tenue">${esc(m.detalle)}</span>` : ''}${m.ejemplo ? `<pre class="ejemplo">${esc(m.ejemplo)}</pre>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}`;
  const enlace = (zid: string) => {
    const [t, n] = zid.split(':');
    return `<button class="enlace" data-obj="${esc(zid)}" type="button">${esc(n)}</button> <span class="tenue">${esc(tipo(t))}</span>`;
  };

  const d = $('#detalle');
  d.hidden = false;
  d.innerHTML = `
  <div class="detalle-cab">
    <div><h2>${esc(r.objeto.nombre)}</h2><p class="tenue">${esc(tipo(r.objeto.tipo))} · ${esc(r.objeto.paquete)}${r.objeto.descripcion ? ` · ${esc(r.objeto.descripcion)}` : ''}</p></div>
    <button class="cerrar" id="cerrar" type="button" aria-label="Cerrar">×</button>
  </div>
  <div class="detalle-cuerpo">
    <p><span class="chip" style="--c:${DECISIONES[r.decision].color}">${DECISIONES[r.decision].nombre}</span> <span class="nivel" style="--c:${NIVELES[r.nivel].color}">${r.nivel}</span> · ${r.ejecuciones !== null ? `${num(r.ejecuciones)} ejecuciones${r.ultimaEjecucion ? `, última el ${esc(r.ultimaEjecucion)}` : ''}` : USOS[r.uso]} · ${dec(r.esfuerzo.min)}–${dec(r.esfuerzo.max)} horas${r.nota !== null ? ` · nota CleanCore ${r.nota}/100` : ''}</p>
    <h3>Por qué</h3><ul>${r.motivos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    ${propuestaHtml}
    ${r.sap.length ? `<h3>Objetos de SAP que usa</h3><table class="tabla compacta"><tbody>${r.sap.map((s) => `<tr><td><span class="nivel" style="--c:${NIVELES[s.nivel].color}">${s.nivel}</span></td><td><b>${esc(s.nombre)}</b> <span class="tenue">línea ${s.lineas.slice(0, 5).map((l) => `<a href="#l-${l}" data-linea="${l}">${l}</a>`).join(', ')}</span><br><span class="tenue">${esc(s.motivo)}</span>${s.sucesores.length ? `<br>Sucesor: <b>${esc(s.sucesores.slice(0, 4).join(', '))}</b>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    ${r.hallazgos.length ? `<h3>Hallazgos de CleanCore Check</h3><table class="tabla compacta"><tbody>${r.hallazgos.slice(0, 60).map((h) => `<tr><td><a href="#l-${h.linea}" data-linea="${h.linea}">${h.linea}</a></td><td><b>${esc(h.titulo)}</b> <span class="tenue">${esc(h.regla)} · ${esc(CATEGORIAS[h.categoria] || h.categoria)}</span>${h.detalle ? `<br><span class="tenue">${esc(h.detalle)}</span>` : ''}</td></tr>`).join('')}</tbody></table>${r.hallazgos.length > 60 ? `<p class="tenue">y ${r.hallazgos.length - 60} más.</p>` : ''}` : ''}
    ${r.usa.length || r.usadoPor.length ? `<h3>Dependencias</h3><div class="dos-col"><div><b>Usa</b><ul class="lista">${r.usa.map((x) => `<li>${enlace(x)}</li>`).join('') || '<li class="tenue">Ningún objeto Z</li>'}</ul></div><div><b>Lo usan</b><ul class="lista">${r.usadoPor.map((x) => `<li>${enlace(x)}</li>`).join('') || '<li class="tenue">Ningún objeto del repositorio</li>'}</ul></div></div>` : ''}
    <h3>Esfuerzo</h3><table class="tabla compacta"><tbody>${r.esfuerzo.partidas.map((p) => `<tr><td>${esc(nombres.get(p.supuesto) || p.supuesto)}${p.veces > 1 ? ` × ${p.veces}` : ''}</td><td class="num">${dec(p.min)}–${dec(p.max)} h</td></tr>`).join('')}</tbody></table>
    ${codigo ? `<div class="cab-codigo"><h3>Código</h3>${prop.cambios.length ? `<div class="conmutador" role="group"><button type="button" class="activa" data-ver="original">Original</button><button type="button" data-ver="propuesto">Propuesto (${num(prop.cambios.length)})</button></div><button class="enlace" id="bajar-objeto" type="button">Descargar propuesto</button>` : ''}</div><pre class="codigo" id="codigo">${codigo}</pre>` : ''}
  </div>`;
  $('#cerrar').addEventListener('click', () => (d.hidden = true));
  $$('[data-ver]', d).forEach((b) => b.addEventListener('click', () => {
    $$('[data-ver]', d).forEach((x) => x.classList.toggle('activa', x === b));
    $('#codigo', d).innerHTML = b.dataset.ver === 'propuesto' ? pintarCodigo(prop.propuesto, true) : codigo;
  }));
  $('#bajar-objeto', d)?.addEventListener('click', () => descargar(`${r.objeto.nombre.toLowerCase().replace(/\//g, '#')}-propuesto.abap`, prop.propuesto, 'text/plain;charset=utf-8'));
  $$('[data-obj]', d).forEach((b) => b.addEventListener('click', () => detalle(estado, b.dataset.obj!)));
  $$('[data-linea]', d).forEach((l) => l.addEventListener('click', (e) => {
    e.preventDefault();
    const fila = d.querySelector(`#l-${l.dataset.linea}`);
    fila?.scrollIntoView({ block: 'center' });
    fila?.classList.add('foco');
    setTimeout(() => fila?.classList.remove('foco'), 1500);
  }));
  d.scrollTop = 0;
}

// ------------------------------------------------------------------ Mapa de riesgo
function mapa(estado: Estado, c: HTMLElement) {
  const a = estado.analisis!;
  // Mismo criterio que la zona roja del mapa: mitad superior de complejidad y mitad derecha del uso
  const maxLog = Math.max(1, ...a.resultados.map((r) => Math.log10(1 + (r.ejecuciones || 0))));
  const criticos = a.resultados.filter((r) => r.decision !== 'retirar' && r.complejidad >= 55 && r.ejecuciones !== null && Math.log10(1 + r.ejecuciones) / maxLog >= 0.5).sort((x, y) => (y.ejecuciones ?? 0) - (x.ejecuciones ?? 0));
  c.innerHTML = `
  <div class="tarjeta">
    <h2>Uso frente a complejidad del cambio</h2>
    <p class="tenue">Cada punto es un objeto que se migra (los que se retiran no aparecen). Pasa el ratón para ver cuál es; haz clic para abrir su detalle.${a.resumen.tieneUso ? '' : ' Sin datos de uso, todos los objetos están en la franja "No medido".'}</p>
    ${mapaRiesgo(a.resultados)}
    <ul class="leyenda">${(['mantener', 'adaptar', 'rehacer'] as const).map((d) => `<li><span class="punto" style="background:${DECISIONES[d].color}"></span>${DECISIONES[d].nombre}</li>`).join('')}</ul>
  </div>
  <div class="tarjeta"><h2>Críticos: muy usados y difíciles de cambiar</h2>
    ${criticos.length ? `<table class="tabla"><thead><tr><th>Objeto</th><th>Decisión</th><th class="num">Ejecuciones</th><th class="num">Horas</th><th>Motivo</th></tr></thead><tbody>${criticos.slice(0, 25).map((r) => `<tr data-id="${esc(r.objeto.id)}"><td><b>${esc(r.objeto.nombre)}</b></td><td>${DECISIONES[r.decision].nombre}</td><td class="num">${num(r.ejecuciones || 0)}</td><td class="num">${dec(r.esfuerzo.min)}–${dec(r.esfuerzo.max)}</td><td class="motivo">${esc(r.motivos[0] || '')}</td></tr>`).join('')}</tbody></table>` : `<p class="tenue">${a.resumen.tieneUso ? 'Ningún objeto usado tiene una complejidad alta.' : 'Hace falta el uso real para saber qué es crítico.'}</p>`}
  </div>
  <div id="detalle" class="detalle" hidden></div>`;
  $$('circle[data-id], tr[data-id]', c).forEach((el) => el.addEventListener('click', () => detalle(estado, el.dataset.id || el.getAttribute('data-id')!)));
}

// ------------------------------------------------------------------ Plan por fases
function plan(estado: Estado, c: HTMLElement) {
  const a = estado.analisis!;
  const eq = a.opciones.equipo;
  const cal = calendario(a.resumen, eq);
  c.innerHTML = `
  <div class="tarjeta calendario">
    <h2>Calendario hasta el fin de ECC</h2>
    <div class="equipo">
      <label>Personas en el equipo<input type="number" id="eq-personas" min="1" max="200" step="1" value="${eq.personas}"></label>
      <label>Dedicación<select id="eq-dedicacion">${[1, 0.8, 0.6, 0.5, 0.4, 0.25].map((v) => `<option value="${v}" ${eq.dedicacion === v ? 'selected' : ''}>${Math.round(v * 100)} % de la jornada</option>`).join('')}</select></label>
      <label>Empieza el<input type="date" id="eq-inicio" value="${esc(eq.inicio)}"></label>
    </div>
    <p class="veredicto${cal.llega ? '' : ' no'}">${esc(veredictoCalendario(cal, eq.personas))}</p>
    ${gantt(cal)}
    <p class="nota">Barra oscura: final optimista (esfuerzo mínimo). Rayada: pesimista (máximo). Días laborables de lunes a viernes, sin festivos ni vacaciones; fases una detrás de otra. El mantenimiento estándar de ECC 6.0 (paquetes de mejora 6 a 8) termina a finales de 2027; después hay mantenimiento ampliado opcional, con coste adicional.</p>
  </div>
  <div class="fases">${a.resumen.porFase.map((f) => {
    const objs = a.resultados.filter((r) => r.fase === f.fase).sort((x, y) => y.esfuerzo.max - x.esfuerzo.max);
    const porPaquete = new Map<string, number>();
    for (const o of objs) porPaquete.set(o.objeto.paquete, (porPaquete.get(o.objeto.paquete) || 0) + 1);
    return `<div class="fase tarjeta">
      <p class="antetitulo">Fase ${f.fase}</p><h2>${esc(f.nombre)}</h2>
      <p class="fase-cifras"><b>${num(f.objetos)}</b> objetos · <b>${rango(f.min, f.max)}</b> jornadas</p>
      <p class="tenue">${[...porPaquete].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([p, n]) => `${esc(p)} ${num(n)}`).join(' · ')}</p>
      <ol class="lista-fase">${objs.slice(0, 12).map((o) => `<li><button class="enlace" data-id="${esc(o.objeto.id)}" type="button">${esc(o.objeto.nombre)}</button> <span class="tenue">${dec(o.esfuerzo.max)} h</span></li>`).join('')}</ol>
      ${objs.length > 12 ? `<p class="tenue">y ${num(objs.length - 12)} más en el CSV del plan.</p>` : ''}
    </div>`;
  }).join('')}</div>
  <p class="nota">Orden recomendado: retirar antes de convertir (cada objeto que no se migra es trabajo y pruebas que se ahorran), después lo de riesgo bajo y, en paralelo, el diseño de lo que hay que rehacer con clean core. El CSV del plan se importa en Excel o en Jira.</p>
  <div id="detalle" class="detalle" hidden></div>`;
  $$('[data-id]', c).forEach((b) => b.addEventListener('click', () => detalle(estado, b.dataset.id!)));
  const cambiarEquipo = () => {
    eq.personas = Math.max(1, Math.min(200, Math.round(Number(($('#eq-personas') as HTMLInputElement).value) || 1)));
    eq.dedicacion = Number(($('#eq-dedicacion') as HTMLSelectElement).value) || 1;
    eq.inicio = ($('#eq-inicio') as HTMLInputElement).value || eq.inicio;
    guardarOpciones();
    recalcular('plan');
  };
  ['#eq-personas', '#eq-dedicacion', '#eq-inicio'].forEach((s) => $(s, c).addEventListener('change', cambiarEquipo));
}

// ------------------------------------------------------------------ Duplicados
function duplicados(estado: Estado, c: HTMLElement) {
  const a = estado.analisis!;
  const porId = new Map(a.resultados.map((r) => [r.objeto.id, r]));
  const d = a.resumen.duplicados;
  c.innerHTML = `
  <div class="tarjeta">
    <h2>Código casi duplicado</h2>
    <p class="tenue">Objetos con al menos un 70 % de su lógica igual (secuencias de sentencias, sin comentarios ni textos). Unificarlos antes de migrar ahorra adaptar y probar cada copia. Revisa siempre las diferencias: una copia puede tener un cambio a propósito.</p>
    ${a.duplicados.length ? `<p class="veredicto">${num(a.duplicados.length)} grupo(s) con ${num(d.objetos)} objetos. Unificar las copias que se migran ahorraría entre ${rango(d.min, d.max)} jornadas.</p>
    ${a.duplicados.map((g) => `<div class="grupo-dup">
      <b>${num(g.miembros.length)} objetos · ${Math.round(g.similitud * 100)} % iguales</b>${g.ahorro.max ? ` <span class="tenue">· ahorro ${dec(g.ahorro.min)}–${dec(g.ahorro.max)} h</span>` : ''}
      <ul>${g.miembros.map((id) => {
        const r = porId.get(id);
        if (!r) return '';
        return `<li><button class="enlace" data-id="${esc(id)}" type="button">${esc(r.objeto.nombre)}</button>${id === g.principal ? '<span class="etiqueta">conservar</span>' : ''} <span class="tenue">${esc(tipo(r.objeto.tipo))} · ${num(r.lineasCodigo)} líneas · ${r.ejecuciones !== null ? `${num(r.ejecuciones)} ejecuciones` : USOS[r.uso]} · ${DECISIONES[r.decision].nombre}</span></li>`;
      }).join('')}</ul></div>`).join('')}` : '<p>No se han encontrado objetos casi iguales.</p>'}
  </div>
  <div id="detalle" class="detalle" hidden></div>`;
  $$('[data-id]', c).forEach((b) => b.addEventListener('click', () => detalle(estado, b.dataset.id!)));
}

// ------------------------------------------------------------------ Objetos de SAP
function sap(estado: Estado, c: HTMLElement) {
  const a = estado.analisis!;
  const mapaSap = new Map<string, { nombre: string; tipo: string; nivel: Nivel; motivo: string; sucesores: string[]; objetos: string[] }>();
  for (const r of a.resultados) {
    if (r.decision === 'retirar') continue;
    for (const s of r.sap) {
      const k = `${s.tipo}:${s.nombre}`;
      const e = mapaSap.get(k) || { nombre: s.nombre, tipo: s.tipo, nivel: s.nivel, motivo: s.motivo.replace(/^[^.]+\.\s*/, ''), sucesores: s.sucesores, objetos: [] };
      e.objetos.push(r.objeto.id);
      mapaSap.set(k, e);
    }
  }
  const lista = [...mapaSap.values()].sort((x, y) => (y.nivel > x.nivel ? 1 : y.nivel < x.nivel ? -1 : 0) || y.objetos.length - x.objetos.length);
  c.innerHTML = `
  <div class="tarjeta">
    <h2>Objetos de SAP que usa el código que se migra</h2>
    <p class="tenue">${num(lista.length)} objetos estándar distintos, cruzados con el Cloudification Repository (${esc(a.resumen.datosSap.commit)}). El sucesor es el que indica SAP en esa lista.</p>
    <div class="tabla-envoltorio"><table class="tabla"><thead><tr><th>Nivel</th><th>Objeto de SAP</th><th>Uso</th><th class="num">Objetos Z</th><th>Sucesor indicado por SAP</th></tr></thead>
    <tbody>${lista.slice(0, 400).map((s) => `<tr><td><span class="nivel" style="--c:${NIVELES[s.nivel].color}">${s.nivel}</span></td><td><b>${esc(s.nombre)}</b><br><span class="tenue">${esc(s.motivo)}</span></td><td>${esc(s.tipo)}</td><td class="num"><button class="enlace" data-buscar="${esc(s.nombre)}" type="button">${num(s.objetos.length)}</button></td><td>${s.sucesores.length ? esc(s.sucesores.slice(0, 4).join(', ')) : '<span class="tenue">—</span>'}</td></tr>`).join('')}</tbody></table></div>
  </div>`;
  $$('[data-buscar]', c).forEach((b) => b.addEventListener('click', () => {
    Object.assign(filtros, { texto: b.dataset.buscar!, decision: '', nivel: '', tipo: '', paquete: '' });
    ($('.pestanas [data-p="objetos"]') as HTMLButtonElement).click();
  }));
}

// ------------------------------------------------------------------ Supuestos y reglas
function supuestos(estado: Estado, c: HTMLElement) {
  const o = estado.opciones;
  const regla = (id: keyof typeof o.reglas, texto: string, nota: string) => `<label class="regla"><input type="checkbox" data-regla="${id}" ${o.reglas[id] ? 'checked' : ''}><span><b>${texto}</b><small>${nota}</small></span></label>`;
  c.innerHTML = `
  <div class="dos">
    <div class="tarjeta">
      <h2>Supuestos de esfuerzo</h2>
      <p class="tenue">Horas por cada caso. Por defecto son estimaciones del autor: ajústalas a tu equipo y el informe se recalcula al momento.</p>
      <table class="tabla supuestos"><thead><tr><th>Supuesto</th><th class="num">Mín. h</th><th class="num">Máx. h</th></tr></thead><tbody>
      ${o.supuestos.map((s, i) => `<tr><td><b>${esc(s.nombre)}</b><br><span class="tenue">${esc(s.descripcion)}</span></td><td class="num"><input type="number" min="0" step="0.25" value="${s.min}" data-i="${i}" data-campo="min"></td><td class="num"><input type="number" min="0" step="0.25" value="${s.max}" data-i="${i}" data-campo="max"></td></tr>`).join('')}
      </tbody></table>
      <p><label>Horas por jornada <input type="number" id="horas" min="1" max="12" step="0.5" value="${o.horasPorJornada}"></label> <button class="enlace" id="restaurar" type="button">Restaurar valores por defecto</button></p>
    </div>
    <div class="tarjeta">
      <h2>Reglas de decisión</h2>
      ${regla('ausenteEsSinUso', 'Lo que no aparece en el CSV de uso, sin uso', 'SUSG y SCMON solo registran lo que se ejecuta. Desactívalo si tu exportación es parcial.')}
      ${regla('retirarEnCadena', 'Retirar en cadena', 'Un objeto sin uso que solo usan otros objetos que también se retiran, se retira.')}
      ${regla('nivelDEsRehacer', 'El nivel D obliga a rehacer', 'Escrituras en tablas de SAP, objetos "noAPI" y ampliaciones implícitas se rehacen con APIs.')}
      ${regla('nivelCEsAdaptar', 'Clean core estricto en Private Edition', 'Los objetos internos de SAP (nivel C) y las reglas de ABAP Cloud cuentan como cambios obligatorios.')}
      <h3>Uso real</h3>
      <p class="tenue">${estado.uso ? `${esc(estado.usoNombre)} · ${num(estado.uso.filas)} filas${estado.uso.desde ? ` · ${esc(estado.uso.desde)} a ${esc(estado.uso.hasta)}` : ''}` : 'No se ha cargado. Vuelve al inicio para añadir un CSV de SUSG o SCMON.'}</p>
    </div>
  </div>`;
  $$('input[data-i]', c).forEach((inp) => inp.addEventListener('change', () => {
    const s = o.supuestos[Number(inp.dataset.i)];
    const v = Math.max(0, Number((inp as HTMLInputElement).value) || 0);
    if (inp.dataset.campo === 'min') s.min = v; else s.max = v;
    if (s.min > s.max) [s.min, s.max] = [s.max, s.min];
    s.fuente = 'Ajustado por el usuario';
    guardarOpciones();
    recalcular('supuestos');
  }));
  $('#horas').addEventListener('change', (e) => { o.horasPorJornada = Math.max(1, Number((e.target as HTMLInputElement).value) || 8); guardarOpciones(); recalcular('supuestos'); });
  $$('input[data-regla]', c).forEach((inp) => inp.addEventListener('change', () => {
    o.reglas[inp.dataset.regla as keyof typeof o.reglas] = (inp as HTMLInputElement).checked;
    guardarOpciones();
    recalcular('supuestos');
  }));
  $('#restaurar').addEventListener('click', () => {
    o.supuestos = SUPUESTOS_POR_DEFECTO.map((s) => ({ ...s }));
    o.reglas = { ...REGLAS_POR_DEFECTO };
    o.horasPorJornada = 8;
    guardarOpciones();
    recalcular('supuestos');
  });
}
