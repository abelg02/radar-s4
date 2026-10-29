// Formas de entrada: ZIP, carpeta o repositorio público de GitHub. Todo se lee en el navegador.
import { unzipSync, strFromU8 } from 'fflate';
import type { Archivo } from '../tipos';

const UTIL = /\.(abap|asddls|asbdef|acds|asdcls|xml)$/i;
const MAX_BYTES = 200 * 1024 * 1024;

export function leerZip(datos: Uint8Array): Archivo[] {
  if (datos.byteLength > MAX_BYTES) throw new Error('El ZIP supera 200 MB. Exporta solo los paquetes que quieras analizar.');
  const entradas = unzipSync(datos, { filter: (f) => UTIL.test(f.name) && f.originalSize < 5 * 1024 * 1024 });
  return Object.entries(entradas).map(([ruta, bytes]) => ({ ruta: ruta.replace(/\\/g, '/'), contenido: strFromU8(bytes) }));
}

export async function leerFicheros(lista: FileList | File[]): Promise<{ archivos: Archivo[]; nombre: string }> {
  const ficheros = Array.from(lista);
  if (ficheros.length === 1 && /\.zip$/i.test(ficheros[0].name)) {
    const archivos = leerZip(new Uint8Array(await ficheros[0].arrayBuffer()));
    return { archivos, nombre: ficheros[0].name.replace(/\.zip$/i, '').replace(/-(main|master)$/i, '') };
  }
  const utiles = ficheros.filter((f) => UTIL.test(f.name));
  const archivos = await Promise.all(
    utiles.map(async (f) => ({ ruta: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, contenido: await f.text() }))
  );
  const primera = archivos[0]?.ruta.split('/')[0];
  return { archivos, nombre: primera && archivos.every((a) => a.ruta.startsWith(primera + '/')) ? primera : 'repositorio' };
}

/** Acepta https://github.com/usuario/repo, con /tree/rama opcional. */
export function parsearUrlGitHub(url: string): { usuario: string; repo: string; rama?: string } | null {
  const m = url.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/?#]+))?\/?(?:[?#].*)?$/i);
  return m ? { usuario: m[1], repo: m[2], rama: m[3] } : null;
}

const MAX_ARCHIVOS = 4000;

/**
 * Repositorio público de GitHub: el árbol de archivos con la API (2 consultas) y cada archivo desde
 * raw.githubusercontent.com. El ZIP de codeload no se puede descargar desde otra web (CORS).
 */
export async function leerGitHub(url: string, progreso?: (hechos: number, total: number) => void): Promise<{ archivos: Archivo[]; nombre: string }> {
  const p = parsearUrlGitHub(url);
  if (!p) throw new Error('La dirección no parece un repositorio de GitHub (https://github.com/usuario/repositorio).');
  const api = `https://api.github.com/repos/${p.usuario}/${p.repo}`;
  const json = async (u: string) => {
    const r = await fetch(u, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 403 || r.status === 429) throw new Error('GitHub limita a 60 consultas por hora sin iniciar sesión. Espera unos minutos o descarga el ZIP del repositorio y súbelo.');
    if (r.status === 404) throw new Error('No encuentro el repositorio. Comprueba la dirección y que sea público.');
    if (!r.ok) throw new Error(`GitHub respondió ${r.status}.`);
    return r.json();
  };
  const rama: string = p.rama || (await json(api)).default_branch;
  const arbol = await json(`${api}/git/trees/${encodeURIComponent(rama)}?recursive=1`);
  const rutas: string[] = (arbol.tree as { path: string; type: string; size?: number }[])
    .filter((e) => e.type === 'blob' && UTIL.test(e.path) && (e.size ?? 0) < 5 * 1024 * 1024)
    .map((e) => e.path);
  if (!rutas.length) throw new Error('El repositorio no tiene archivos ABAP en formato abapGit.');
  if (rutas.length > MAX_ARCHIVOS) throw new Error(`El repositorio tiene ${rutas.length} archivos. Para más de ${MAX_ARCHIVOS}, descarga el ZIP y súbelo.`);

  const archivos: Archivo[] = [];
  let hechos = 0;
  const cola = [...rutas];
  const trabajador = async () => {
    while (cola.length) {
      const ruta = cola.shift()!;
      const r = await fetch(`https://raw.githubusercontent.com/${p.usuario}/${p.repo}/${encodeURIComponent(rama)}/${ruta.split('/').map(encodeURIComponent).join('/')}`);
      if (r.ok) archivos.push({ ruta, contenido: await r.text() });
      progreso?.(++hechos, rutas.length);
    }
  };
  await Promise.all(Array.from({ length: 12 }, trabajador));
  return { archivos, nombre: p.repo };
}
