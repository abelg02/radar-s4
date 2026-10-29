// Pantalla de inicio: entrada del código, del uso y del destino, y explicación de la metodología.
import type { Destino } from '../tipos';
import type { Estado } from '../main';
import { analizarArchivos, cargarDatosSap, cargarUsoTexto, estado as estadoApp, guardarOpciones, progresoCarga, quitarUso } from '../main';
import { leerFicheros, leerGitHub, leerZip } from '../entrada/cargar';
import { PLANTILLA_USO } from '../entrada/uso';
import { $, $$, DECISIONES, DESTINOS, NIVELES, ORDEN_DECISION, descargar, esc, num } from './util';

const base = import.meta.env.BASE_URL;
const REPOS_REALES = [
  { url: 'https://github.com/abelg02/ABAP_Cloud_AE', nombre: 'ABAP Cloud de avanzado a experto', nota: 'Código real del autor: clases y una app de incidencias con RAP' },
  { url: 'https://github.com/abelg02/ABAP_Cloud_CA', nombre: 'ABAP Cloud de cero a avanzado', nota: 'Código real del autor: fundamentos, SQL y órdenes de trabajo' },
];

export function pintarInicio(estado: Estado, error?: string) {
  const o = estado.opciones;
  document.title = 'Radar S/4 · Informe de migración del código Z';
  $('#app').innerHTML = `
  <section class="inicio">
    <div class="hero">
      <p class="antetitulo">Herramienta gratuita · Fin del mantenimiento estándar de SAP ECC 6.0: finales de 2027</p>
      <h1>El informe de migración a S/4HANA de tu código Z</h1>
      <p class="entradilla">Sube el código exportado con abapGit y, si lo tienes, el uso real de SUSG o SCMON. Sabrás qué retirar, qué adaptar y qué rehacer con clean core, cuánto esfuerzo supone y en qué orden, con todos los supuestos a la vista.</p>
      <ul class="sellos"><li>El código no sale de tu navegador</li><li>Lista oficial de objetos liberados de SAP</li><li>Sin registro</li></ul>
    </div>

    ${error ? `<div class="aviso error" role="alert">${esc(error)}</div>` : ''}

    <div class="pasos-entrada">
      <div class="tarjeta">
        <h2><span class="paso">1</span>Código Z</h2>
        <div class="pestanas-entrada" role="tablist">
          <button role="tab" class="activa" data-entrada="zip">ZIP de abapGit</button>
          <button role="tab" data-entrada="carpeta">Carpeta</button>
          <button role="tab" data-entrada="github">Repositorio de GitHub</button>
        </div>
        <div class="entrada" data-panel="zip">
          <label class="soltar" id="soltar">
            <input type="file" id="f-zip" accept=".zip" hidden>
            <b>Arrastra aquí el ZIP</b> o haz clic para elegirlo
            <small>En abapGit: repositorio offline con tus paquetes → Exportar ZIP. También vale el ZIP de un repositorio de GitHub.</small>
          </label>
        </div>
        <div class="entrada" data-panel="carpeta" hidden>
          <label class="soltar">
            <input type="file" id="f-carpeta" webkitdirectory multiple hidden>
            <b>Elige la carpeta</b> del repositorio abapGit
            <small>Se leen solo los archivos .abap, .asddls, .asbdef y .xml.</small>
          </label>
        </div>
        <div class="entrada" data-panel="github" hidden>
          <form id="f-github" class="fila-url">
            <input type="url" id="url-github" placeholder="https://github.com/usuario/repositorio" required>
            <button class="boton">Analizar</button>
          </form>
          <small class="tenue">Solo repositorios públicos. El código se descarga de GitHub a tu navegador; no pasa por ningún otro servidor.</small>
        </div>
        <p id="archivo-elegido" class="elegido" hidden></p>
      </div>

      <div class="tarjeta">
        <h2><span class="paso">2</span>Uso real <span class="opcional">opcional, pero clave</span></h2>
        <p>Exportación en CSV de <b>SUSG</b> o <b>SCMON</b>: qué objetos se han ejecutado en producción y cuántas veces. SAP recomienda medir entre 6 y 18 meses, con al menos un cierre de año.</p>
        <div class="fila-botones">
          <label class="boton secundario"><input type="file" id="f-uso" accept=".csv,.txt,.tsv" hidden>Cargar CSV de uso</label>
          <button class="enlace" id="plantilla-uso" type="button">Descargar plantilla</button>
        </div>
        <p id="uso-elegido" class="elegido" ${estado.uso ? '' : 'hidden'}>${estado.uso ? `${esc(estado.usoNombre)} · ${num(estado.uso.filas)} filas <button class="enlace" id="quitar-uso" type="button">Quitar</button>` : ''}</p>
        <p id="uso-avisos" class="tenue"></p>
      </div>

      <div class="tarjeta">
        <h2><span class="paso">3</span>Destino</h2>
        <div class="destinos">
          ${(Object.keys(DESTINOS) as Destino[]).map((d) => `<label class="destino"><input type="radio" name="destino" value="${d}" ${o.destino === d ? 'checked' : ''}><span><b>${DESTINOS[d].nombre}</b><small>${DESTINOS[d].nota}</small></span></label>`).join('')}
        </div>
      </div>
    </div>

    <div class="probar">
      <div>
        <h2>¿Sin código a mano? Pruébalo</h2>
        <p class="tenue">Con un sistema de ejemplo o con código ABAP real del autor, publicado en GitHub.</p>
      </div>
      <div class="opciones-probar">
        <button class="opcion" id="probar-ejemplo" type="button"><b>Sistema de ejemplo</b><small>Empresa ficticia con unos 200 objetos Z de 2006 a 2025 y un CSV de uso inventado. Los objetos de SAP que usa son reales.</small></button>
        ${REPOS_REALES.map((r) => `<button class="opcion" data-repo="${esc(r.url)}" type="button"><b>${esc(r.nombre)}</b><small>${esc(r.nota)}. Sin datos de uso.</small></button>`).join('')}
      </div>
    </div>

    <p class="datos-sap" id="datos-sap">Cargando la lista oficial de SAP…</p>

    <section class="explicacion" id="como-funciona">
      <h2>Qué decide para cada objeto</h2>
      <div class="cuatro">
        ${ORDEN_DECISION.map((d) => `<div class="decision-caja" style="--c:${DECISIONES[d].color}"><b>${DECISIONES[d].nombre}</b><p>${DECISIONES[d].texto}</p></div>`).join('')}
      </div>
      <h2>Nivel de clean core de cada objeto</h2>
      <p>Según el modelo de niveles de SAP y el <a href="https://github.com/SAP/abap-atc-cr-cv-s4hc" rel="noopener">Cloudification Repository</a>, la misma lista que usa el ATC de SAP: el nivel de un objeto Z es el peor de los objetos de SAP que usa.</p>
      <div class="cuatro">
        ${(['A', 'B', 'C', 'D'] as const).map((n) => `<div class="decision-caja" style="--c:${NIVELES[n].color}"><b>${NIVELES[n].nombre}</b><p>${NIVELES[n].texto}</p></div>`).join('')}
      </div>
    </section>

    <section class="explicacion" id="metodologia">
      <h2>Metodología</h2>
      <ol class="metodo-pasos">
        <li><b>Inventario.</b> Lee el formato de abapGit: programas, includes, clases, interfaces, grupos y módulos de función, CDS, comportamiento RAP, tablas y ampliaciones, con su paquete.</li>
        <li><b>Reglas.</b> Pasa a cada objeto las 72 reglas de <a href="https://abelg02.github.io/Proyecto-SAP-ABAP/herramientas/cleancore-check.html" rel="noopener">CleanCore Check</a> para el destino elegido: tablas sustituidas en S/4HANA (VBUK, KONV, BSID…), material de 40 caracteres, Business Partner, SELECT sin ORDER BY, tecnología que no existe en ABAP Cloud.</li>
        <li><b>Objetos de SAP.</b> Extrae las tablas, funciones, clases, transacciones y autorizaciones de SAP que usa cada objeto y las cruza con la lista oficial: liberado, classic API, interno o "noAPI", y su sucesor.</li>
        <li><b>Dependencias y uso.</b> Construye el grafo de qué objeto usa a cuál y lo cruza con el uso real. Nada se propone para retirar si otro objeto que se queda lo necesita.</li>
        <li><b>Esfuerzo.</b> Suma horas por decisión y por cada cambio, con supuestos que puedes cambiar. Da un rango, nunca una cifra única, y dice qué supuestos pesan más.</li>
      </ol>
      <p class="nota">Es una primera foto para decidir cómo empezar, a partir del código exportado: no accede al sistema. Complementa, no sustituye, a SAP Readiness Check, al ATC y a la app Custom Code Migration. Las horas por defecto son estimaciones del autor y se pueden ajustar.</p>
    </section>
  </section>`;

  // Pestañas de entrada
  $$('.pestanas-entrada button').forEach((b) => b.addEventListener('click', () => {
    $$('.pestanas-entrada button').forEach((x) => x.classList.toggle('activa', x === b));
    $$('.entrada').forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.entrada));
  }));

  // Destino
  $$('input[name="destino"]').forEach((r) => r.addEventListener('change', () => {
    estado.opciones.destino = (r as HTMLInputElement).value as Destino;
    guardarOpciones();
  }));

  // ZIP: clic o arrastrar
  const zona = $('#soltar');
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('encima'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
  zona.addEventListener('drop', (e) => {
    e.preventDefault();
    zona.classList.remove('encima');
    if (e.dataTransfer?.files.length) desdeFicheros(e.dataTransfer.files);
  });
  ($('#f-zip') as HTMLInputElement).addEventListener('change', (e) => desdeFicheros((e.target as HTMLInputElement).files!));
  ($('#f-carpeta') as HTMLInputElement).addEventListener('change', (e) => desdeFicheros((e.target as HTMLInputElement).files!));

  $('#f-github').addEventListener('submit', (e) => {
    e.preventDefault();
    desdeGitHub(($('#url-github') as HTMLInputElement).value);
  });
  $$('[data-repo]').forEach((b) => b.addEventListener('click', () => desdeGitHub(b.dataset.repo!)));

  // Uso
  ($('#f-uso') as HTMLInputElement).addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const avisos = cargarUsoTexto(await f.text(), f.name);
    pintarUso(estado, avisos);
  });
  $('#plantilla-uso').addEventListener('click', () => descargar('plantilla-uso-radar-s4.csv', PLANTILLA_USO));
  $('#quitar-uso')?.addEventListener('click', () => { quitarUso(); pintarUso(estado, []); });

  $('#probar-ejemplo').addEventListener('click', probarEjemplo);

  cargarDatosSap().then((d) => {
    const el = document.getElementById('datos-sap');
    if (el) el.innerHTML = `Lista oficial de SAP: <a href="${esc(d.meta.fuente)}" rel="noopener">Cloudification Repository</a> · ${num(d.meta.objetos)} objetos de SAP · versión ${esc(d.meta.commit || d.meta.generado)}. Se actualiza cada semana.`;
  }).catch(() => {
    const el = document.getElementById('datos-sap');
    if (el) el.textContent = 'No se ha podido cargar la lista oficial de SAP. Comprueba la conexión y recarga la página.';
  });
  if (location.hash === '#metodologia') document.getElementById('metodologia')?.scrollIntoView();
}

function pintarUso(estado: Estado, avisos: string[]) {
  const el = $('#uso-elegido');
  el.hidden = !estado.uso;
  el.innerHTML = estado.uso ? `${esc(estado.usoNombre)} · ${num(estado.uso.filas)} filas${estado.uso.desde ? ` · ${esc(estado.uso.desde)} a ${esc(estado.uso.hasta)}` : ''} <button class="enlace" id="quitar-uso" type="button">Quitar</button>` : '';
  $('#uso-avisos').textContent = avisos.join(' ');
  $('#quitar-uso')?.addEventListener('click', () => { quitarUso(); pintarUso(estado, []); });
}

async function desdeFicheros(lista: FileList) {
  try {
    const { archivos, nombre } = await leerFicheros(lista);
    if (!archivos.length) throw new Error('No hay archivos de abapGit (.abap, .xml…) en lo que has elegido.');
    await analizarArchivos(archivos, nombre);
  } catch (err) {
    const el = $('#archivo-elegido');
    if (el) { el.hidden = false; el.textContent = (err as Error).message; el.classList.add('error'); }
  }
}

async function desdeGitHub(url: string) {
  const app = $('#app');
  app.innerHTML = `<section class="cargando"><div class="radar-anim" aria-hidden="true"></div><p id="carga-texto">Leyendo el repositorio de GitHub…</p><div class="progreso"><span id="carga-barra"></span></div></section>`;
  try {
    const { archivos, nombre } = await leerGitHub(url, (h, t) => progresoCarga(`Descargando archivos de GitHub: ${h} de ${t}`, h, t));
    await analizarArchivos(archivos, nombre);
  } catch (err) {
    pintarInicio(estadoApp, (err as Error).message);
  }
}

async function probarEjemplo() {
  try {
    const [zip, csv] = await Promise.all([
      fetch(`${base}ejemplo/radar-s4-ejemplo.zip`).then((r) => r.arrayBuffer()),
      fetch(`${base}ejemplo/uso-susg-ejemplo.csv`).then((r) => r.text()),
    ]);
    cargarUsoTexto(csv, 'uso-susg-ejemplo.csv (inventado)');
    await analizarArchivos(leerZip(new Uint8Array(zip)), 'Sistema de ejemplo (ficticio)', true, 'ZRADAR');
  } catch (err) {
    pintarInicio(estadoApp, `No se ha podido cargar el ejemplo: ${(err as Error).message}`);
  }
}
