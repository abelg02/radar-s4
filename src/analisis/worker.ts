// Web Worker: lee el repositorio y hace la parte costosa del análisis sin bloquear la página.
import { leerRepositorio } from '../entrada/abapgit';
import { analizarBase, type ObjetoBase } from './analizar';
import { BaseSap, type DatosSap } from './sap';
import type { Archivo, Destino } from '../tipos';

export type Peticion =
  | { tipo: 'analizar'; archivos: Archivo[]; nombre: string; raiz?: string; destino: Destino; datosSap: DatosSap }
  | { tipo: 'destino'; destino: Destino };

export type Respuesta =
  | { tipo: 'progreso'; hechos: number; total: number }
  | { tipo: 'base'; bases: ObjetoBase[]; avisos: string[] }
  | { tipo: 'error'; mensaje: string };

let ultimo: { objetos: ReturnType<typeof leerRepositorio>['objetos']; avisos: string[]; base: BaseSap } | null = null;

const enviar = (r: Respuesta) => (self as unknown as Worker).postMessage(r);

self.onmessage = (e: MessageEvent<Peticion>) => {
  try {
    const p = e.data;
    if (p.tipo === 'analizar') {
      const { objetos, avisos } = leerRepositorio(p.archivos, p.raiz || p.nombre);
      ultimo = { objetos, avisos, base: new BaseSap(p.datosSap) };
    }
    if (!ultimo) throw new Error('No hay ningún repositorio cargado.');
    let paso = 0;
    const bases = analizarBase(ultimo.objetos, ultimo.base, p.destino, (hechos, total) => {
      if (hechos - paso >= 25 || hechos === total) { paso = hechos; enviar({ tipo: 'progreso', hechos, total }); }
    });
    enviar({ tipo: 'base', bases, avisos: ultimo.avisos });
  } catch (err) {
    enviar({ tipo: 'error', mensaje: (err as Error).message });
  }
};
