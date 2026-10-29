// Convierte los ficheros de un repositorio abapGit en objetos Z.
//
// Formato de abapGit: <nombre>.<tipo>[.<parte>].<extensión>, con "#" en lugar de "/" en los espacios de nombres.
//   zr_pedidos.prog.abap · zcl_x.clas.abap · zcl_x.clas.locals_imp.abap · zfg.fugr.z_mi_funcion.abap
//   zi_vista.ddls.asddls · zi_vista.bdef.asbdef · ztabla.tabl.xml · package.devc.xml
// Paquetes: cada carpeta es un paquete. Con FOLDER_LOGIC = PREFIX (lo normal) la carpeta "sd" dentro del
// paquete ZVENTAS es ZVENTAS_SD; con FULL, el nombre de la carpeta es el nombre del paquete.
import type { Archivo, ObjetoZ } from '../tipos';

const TIPOS_FUENTE = new Set(['abap', 'asddls', 'asbdef', 'acds', 'asdcls']);
// Tipos que no aportan a la decisión de migración (textos, iconos, metadatos)
const IGNORAR = new Set(['devc', 'msag', 'w3mi', 'sicf', 'sush', 'susc', 'sxci_meta', 'doma', 'dtel', 'ttyp', 'shlp', 'tobj', 'tabu', 'nrob', 'para', 'pinf', 'sots', 'otgr', 'smim', 'iarp', 'iasp', 'iatu', 'auth', 'acid', 'dial', 'cmod']);

interface Partes {
  nombre: string;
  tipo: string;
  parte: string;
  extension: string;
}

export function partesDeRuta(ruta: string): Partes | null {
  const base = ruta.split('/').pop() || '';
  const trozos = base.split('.');
  if (trozos.length < 3) return null;
  const extension = trozos.pop()!.toLowerCase();
  const nombre = trozos.shift()!.replace(/#/g, '/').toUpperCase();
  const tipo = trozos.shift()!.toLowerCase();
  return { nombre, tipo, parte: trozos.join('.').toLowerCase(), extension };
}

interface ConfigRepo {
  carpetaInicial: string;
  logica: 'PREFIX' | 'FULL' | 'MIXED';
  raiz: string;
}

function leerConfig(archivos: Archivo[], nombreRepo: string): ConfigRepo {
  const xml = archivos.find((a) => /(^|\/)\.abapgit\.xml$/i.test(a.ruta));
  const carpeta = (xml?.contenido.match(/<STARTING_FOLDER>([^<]*)<\/STARTING_FOLDER>/) || [])[1] || '/src/';
  const logica = ((xml?.contenido.match(/<FOLDER_LOGIC>([^<]*)<\/FOLDER_LOGIC>/) || [])[1] || 'PREFIX') as ConfigRepo['logica'];
  const prefijo = xml ? xml.ruta.replace(/\.abapgit\.xml$/i, '') : '';
  // abapGit no guarda el nombre del paquete raíz: se usa el del repositorio
  const raiz = nombreRepo.toUpperCase().replace(/[^A-Z0-9_/]/g, '_').replace(/_+/g, '_');
  return { carpetaInicial: (prefijo + carpeta.replace(/^\//, '')).replace(/\/+/g, '/'), logica, raiz };
}

function paqueteDe(ruta: string, cfg: ConfigRepo): string {
  let rel = ruta;
  if (cfg.carpetaInicial && rel.startsWith(cfg.carpetaInicial)) rel = rel.slice(cfg.carpetaInicial.length);
  const carpetas = rel.split('/').slice(0, -1).filter(Boolean);
  if (!carpetas.length) return cfg.raiz;
  if (cfg.logica === 'FULL') return carpetas[carpetas.length - 1].toUpperCase();
  return [cfg.raiz, ...carpetas.map((c) => c.toUpperCase())].join('_');
}

const etiqueta = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];

/**
 * Lee el repositorio. Quita el prefijo común de las rutas (la carpeta que crea GitHub al descargar un ZIP).
 */
export function leerRepositorio(entrada: Archivo[], nombreRepo = 'REPOSITORIO'): { objetos: ObjetoZ[]; avisos: string[] } {
  const avisos: string[] = [];
  const archivos = quitarPrefijoComun(entrada.filter((a) => !/(^|\/)(\.git|node_modules)\//.test(a.ruta)));
  const cfg = leerConfig(archivos, nombreRepo);
  const objetos = new Map<string, ObjetoZ>();
  const xmls = new Map<string, string>();

  const objeto = (tipo: string, nombre: string, ruta: string, grupo?: string): ObjetoZ => {
    const id = `${tipo}:${nombre}`;
    let o = objetos.get(id);
    if (!o) {
      o = { id, nombre, tipo, paquete: paqueteDe(ruta, cfg), fuente: '', archivos: [], grupo };
      objetos.set(id, o);
    }
    return o;
  };

  // Primero los XML: descripciones, includes y la lista de módulos de función de cada grupo
  const funcionesDeGrupo = new Map<string, Set<string>>();
  for (const a of archivos) {
    const p = partesDeRuta(a.ruta);
    if (!p || p.extension !== 'xml') continue;
    xmls.set(`${p.tipo}:${p.nombre}:${p.parte}`, a.contenido);
    if (p.tipo === 'fugr' && !p.parte) {
      const funcs = [...a.contenido.matchAll(/<FUNCNAME>([^<]+)<\/FUNCNAME>/g)].map((m) => m[1].toUpperCase());
      funcionesDeGrupo.set(p.nombre, new Set(funcs));
    }
  }

  for (const a of archivos) {
    const p = partesDeRuta(a.ruta);
    if (!p || IGNORAR.has(p.tipo)) continue;
    const esFuente = TIPOS_FUENTE.has(p.extension);

    if (p.tipo === 'fugr') {
      if (!esFuente) continue;
      const funcs = funcionesDeGrupo.get(p.nombre);
      const sub = p.parte.toUpperCase().replace(/#/g, '/');
      if (funcs?.has(sub)) {
        const o = objeto('FUNC', sub, a.ruta, p.nombre);
        anadirFuente(o, a);
      } else {
        // Includes del grupo (LZ...TOP, LZ...F01...): pertenecen al grupo de funciones
        const o = objeto('FUGR', p.nombre, a.ruta);
        anadirFuente(o, a);
      }
      continue;
    }

    if (p.extension === 'xml') {
      // Objetos de diccionario y ampliaciones: existen aunque no tengan código
      if (['tabl', 'view', 'enho', 'enhs', 'tran', 'srvd', 'srvb', 'sxci', 'ssfo', 'sfpf', 'xslt', 'prog', 'clas', 'intf', 'ddls', 'bdef'].includes(p.tipo) && !p.parte) {
        const o = objeto(p.tipo.toUpperCase(), p.nombre, a.ruta);
        if (!o.archivos.includes(a.ruta)) o.archivos.push(a.ruta);
        o.descripcion ||= etiqueta(a.contenido, 'DESCRIPT') || etiqueta(a.contenido, 'TEXT') || etiqueta(a.contenido, 'DDTEXT') || etiqueta(a.contenido, 'TTEXT') || etiqueta(a.contenido, 'SHORTTEXT');
        if (p.tipo === 'prog' && etiqueta(a.contenido, 'SUBC') === 'I') o.esInclude = true;
        if (p.tipo === 'enho' && /<TOOL>HOOK_IMPL<\/TOOL>/.test(a.contenido)) o.ampliacionImplicita = true;
        if (p.tipo === 'tabl') o.fuente ||= a.contenido;
      }
      continue;
    }

    if (!esFuente) continue;
    const tipo = p.tipo === 'enho' ? 'ENHO' : p.tipo.toUpperCase();
    const o = objeto(tipo, p.nombre, a.ruta);
    anadirFuente(o, a);
  }

  const lista = [...objetos.values()];
  if (!lista.length) avisos.push('No se ha encontrado ningún objeto con formato abapGit (archivos como zprograma.prog.abap o zcl_clase.clas.abap).');
  if (!archivos.some((a) => /\.abapgit\.xml$/i.test(a.ruta)) && lista.length) avisos.push('No hay .abapgit.xml: los paquetes se deducen de las carpetas.');
  return { objetos: lista.sort((x, y) => x.id.localeCompare(y.id)), avisos };
}

function anadirFuente(o: ObjetoZ, a: Archivo) {
  // En las clases, la parte principal primero y los tests aparte (no cuentan para la migración)
  if (/\.clas\.testclasses\.abap$/i.test(a.ruta)) {
    o.archivos.push(a.ruta);
    return;
  }
  const principal = /\.clas\.abap$/i.test(a.ruta);
  o.fuente = principal ? a.contenido + (o.fuente ? '\n' + o.fuente : '') : (o.fuente ? o.fuente + '\n' : '') + a.contenido;
  o.archivos.push(a.ruta);
}

function quitarPrefijoComun(archivos: Archivo[]): Archivo[] {
  if (archivos.length < 2) return archivos;
  const primeras = archivos.map((a) => a.ruta.split('/')[0]);
  const comun = primeras[0];
  if (!comun || !archivos.every((a) => a.ruta.includes('/')) || !primeras.every((p) => p === comun)) return archivos;
  // Solo si esa carpeta común no es la carpeta de código (src)
  if (comun === 'src') return archivos;
  return quitarPrefijoComun(archivos.map((a) => ({ ...a, ruta: a.ruta.slice(comun.length + 1) })));
}
