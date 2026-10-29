import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { leerRepositorio, partesDeRuta } from '../src/entrada/abapgit';
import { leerUso, normalizarFecha } from '../src/entrada/uso';
import { parsearUrlGitHub } from '../src/entrada/cargar';
import { referenciasAbap, referenciasCds } from '../src/analisis/referencias';
import { BaseSap, evaluarUsosSap, type DatosSap } from '../src/analisis/sap';
import { analizarBase, evaluar } from '../src/analisis/analizar';
import { REGLAS_POR_DEFECTO, SUPUESTOS_POR_DEFECTO } from '../src/esfuerzo/supuestos';
import type { Archivo, Opciones } from '../src/tipos';

const datos = JSON.parse(fs.readFileSync(new URL('../public/datos/sap-apis.json', import.meta.url), 'utf8')) as DatosSap;
const base = new BaseSap(datos);
const opciones = (destino: Opciones['destino'] = 's4op'): Opciones => ({ destino, reglas: { ...REGLAS_POR_DEFECTO }, supuestos: SUPUESTOS_POR_DEFECTO, horasPorJornada: 8, equipo: { personas: 2, dedicacion: 1, inicio: '2026-11-02' } });

describe('lectura de abapGit', () => {
  it('reconoce nombre, tipo y parte, con espacios de nombres', () => {
    expect(partesDeRuta('src/zcl_x.clas.locals_imp.abap')).toEqual({ nombre: 'ZCL_X', tipo: 'clas', parte: 'locals_imp', extension: 'abap' });
    expect(partesDeRuta('src/#abc#zr_y.prog.abap')?.nombre).toBe('/ABC/ZR_Y');
  });

  it('separa módulos de función, une clases, deduce paquetes y quita la carpeta del ZIP', () => {
    const archivos: Archivo[] = [
      { ruta: 'repo-main/.abapgit.xml', contenido: '<STARTING_FOLDER>/src/</STARTING_FOLDER><FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>' },
      { ruta: 'repo-main/src/sd/zfg.fugr.xml', contenido: '<FUNCNAME>Z_UNO</FUNCNAME><FUNCNAME>Z_DOS</FUNCNAME>' },
      { ruta: 'repo-main/src/sd/zfg.fugr.z_uno.abap', contenido: 'FUNCTION z_uno.\nENDFUNCTION.' },
      { ruta: 'repo-main/src/sd/zfg.fugr.lzfgtop.abap', contenido: 'FUNCTION-POOL zfg.' },
      { ruta: 'repo-main/src/zcl_a.clas.abap', contenido: 'CLASS zcl_a DEFINITION.\nENDCLASS.' },
      { ruta: 'repo-main/src/zcl_a.clas.locals_imp.abap', contenido: '* local' },
      { ruta: 'repo-main/src/zcl_a.clas.testclasses.abap', contenido: '* tests' },
      { ruta: 'repo-main/src/zinc.prog.xml', contenido: '<SUBC>I</SUBC>' },
      { ruta: 'repo-main/src/zinc.prog.abap', contenido: 'DATA x TYPE i.' },
    ];
    const { objetos } = leerRepositorio(archivos, 'ZVENTAS');
    const ids = objetos.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(['FUNC:Z_UNO', 'FUGR:ZFG', 'CLAS:ZCL_A', 'PROG:ZINC']));
    expect(objetos.find((o) => o.id === 'FUNC:Z_UNO')!.paquete).toBe('ZVENTAS_SD');
    expect(objetos.find((o) => o.id === 'CLAS:ZCL_A')!.fuente).not.toContain('tests');
    expect(objetos.find((o) => o.id === 'PROG:ZINC')!.esInclude).toBe(true);
  });
});

describe('uso real', () => {
  it('lee SUSG con columnas en inglés, separador ";" y fechas AAAAMMDD', () => {
    const u = leerUso('OBJ_TYPE;OBJ_NAME;COUNTER;LAST_USED\nPROG;ZR_A;1.240;20260930\nCLAS;ZCL_B;0;\n');
    expect(u.filas).toBe(2);
    expect(u.porClave.get('PROG:ZR_A')).toEqual({ ejecuciones: 1240, ultima: '2026-09-30' });
    expect(u.porClave.get('CLAS:ZCL_B')!.ejecuciones).toBe(0);
  });

  it('pasa el uso de un grupo de funciones al módulo de función', () => {
    const u = leerUso('OBJ_TYPE,OBJ_NAME,PROC_TYPE,PROC_NAME,COUNTER\nPROG,SAPLZFG,FUNC,Z_UNO,7\n');
    expect(u.porClave.get('FUNC:Z_UNO')!.ejecuciones).toBe(7);
    expect(u.porClave.get('FUGR:ZFG')!.ejecuciones).toBe(7);
  });

  it('normaliza fechas', () => {
    expect(normalizarFecha('30.09.2026')).toBe('2026-09-30');
    expect(normalizarFecha('00000000')).toBeUndefined();
  });
});

describe('referencias', () => {
  it('extrae tablas, escrituras, funciones, clases y transacciones; ignora comentarios, literales y clases locales', () => {
    const refs = referenciasAbap(`REPORT z.
* SELECT * FROM comentada.
CLASS lcl_x DEFINITION.
ENDCLASS.
SELECT * FROM vbak INNER JOIN vbap ON vbak~vbeln = vbap~vbeln INTO TABLE @lt.
UPDATE mara SET mstae = 'X' WHERE matnr = lv.
CALL FUNCTION 'BAPI_PO_CREATE1'.
DATA(lo) = NEW cl_http_client( ).
lcl_x=>run( ).
CALL TRANSACTION 'VA01'.
WRITE 'FROM falsa'.`);
    const n = refs.map((r) => `${r.tipo}:${r.nombre}`);
    expect(n).toEqual(expect.arrayContaining(['tabla:VBAK', 'tabla:VBAP', 'escritura:MARA', 'funcion:BAPI_PO_CREATE1', 'clase:CL_HTTP_CLIENT', 'transaccion:VA01']));
    expect(n.join()).not.toMatch(/COMENTADA|FALSA|LCL_X/);
  });

  it('lee FROM, asociaciones y proyecciones en CDS', () => {
    const n = referenciasCds('define view entity ZI as select from I_SalesDocument\n association [0..1] to I_Customer as _C on 1 = 1\n{ key a }').map((r) => r.nombre);
    expect(n).toEqual(['I_SALESDOCUMENT', 'I_CUSTOMER']);
  });
});

describe('niveles de clean core con la lista oficial de SAP', () => {
  it('A liberado, B classic API, C interno con sucesor, D escritura', () => {
    const usos = evaluarUsosSap([
      { nombre: 'I_PRODUCT', tipo: 'tabla', linea: 1 },
      { nombre: 'CL_GUI_ALV_GRID', tipo: 'clase', linea: 2 },
      { nombre: 'VBAK', tipo: 'tabla', linea: 3 },
      { nombre: 'MARA', tipo: 'escritura', linea: 4 },
      { nombre: 'LT_INTERNA', tipo: 'escritura', linea: 5 },
    ], base, 's4pce');
    const nivel = Object.fromEntries(usos.map((u) => [u.nombre + ':' + u.tipo, u.nivel]));
    expect(nivel['I_PRODUCT:tabla']).toBe('A');
    expect(nivel['CL_GUI_ALV_GRID:clase']).toBe('B');
    expect(nivel['VBAK:tabla']).toBe('C');
    expect(nivel['MARA:escritura']).toBe('D');
    expect(nivel['LT_INTERNA:escritura']).toBeUndefined();
    expect(usos.find((u) => u.nombre === 'VBAK')!.sucesores).toContain('I_SALESDOCUMENT');
  });
});

describe('decisiones y esfuerzo', () => {
  const archivos: Archivo[] = [
    { ruta: 'src/zr_viejo.prog.abap', contenido: "REPORT zr_viejo.\nSELECT * FROM vbuk INTO TABLE lt WHERE vbeln = lv.\nCALL FUNCTION 'Z_UTIL'." },
    { ruta: 'src/zr_usado.prog.abap', contenido: "REPORT zr_usado.\nSELECT * FROM vbuk INTO TABLE lt WHERE vbeln = lv.\nCALL FUNCTION 'Z_UTIL'." },
    { ruta: 'src/zr_escribe.prog.abap', contenido: "REPORT zr_escribe.\nUPDATE mara SET mstae = 'X' WHERE matnr = lv." },
    { ruta: 'src/zr_limpio.prog.abap', contenido: 'REPORT zr_limpio.\nSELECT FROM i_product FIELDS product INTO TABLE @DATA(lt).' },
    { ruta: 'src/zfg.fugr.xml', contenido: '<FUNCNAME>Z_UTIL</FUNCNAME>' },
    { ruta: 'src/zfg.fugr.z_util.abap', contenido: 'FUNCTION z_util.\nENDFUNCTION.' },
  ];
  const { objetos } = leerRepositorio(archivos, 'Z');
  const uso = leerUso('OBJ_TYPE;OBJ_NAME;COUNTER\nPROG;ZR_USADO;10\nPROG;ZR_ESCRIBE;5\nPROG;ZR_LIMPIO;3\nPROG;ZR_VIEJO;0\n');

  it('retira lo que no se usa, pero no lo que necesita algo que se queda', () => {
    const a = evaluar('t', analizarBase(objetos, base, 's4op'), uso, opciones(), datos.meta);
    const d = Object.fromEntries(a.resultados.map((r) => [r.objeto.id, r.decision]));
    expect(d['PROG:ZR_VIEJO']).toBe('retirar');
    expect(d['PROG:ZR_USADO']).toBe('adaptar');
    expect(d['PROG:ZR_ESCRIBE']).toBe('rehacer');
    expect(d['PROG:ZR_LIMPIO']).toBe('mantener');
    // Z_UTIL no aparece en el CSV, pero lo usa ZR_USADO, que se queda
    expect(d['FUNC:Z_UTIL']).not.toBe('retirar');
  });

  it('da un rango de esfuerzo coherente y lo recalcula al cambiar un supuesto', () => {
    const bases = analizarBase(objetos, base, 's4op');
    const a = evaluar('t', bases, uso, opciones(), datos.meta);
    expect(a.resumen.esfuerzo.min).toBeGreaterThan(0);
    expect(a.resumen.esfuerzo.max).toBeGreaterThan(a.resumen.esfuerzo.min);
    const o = opciones();
    o.supuestos = o.supuestos.map((s) => (s.id === 'base-rehacer' ? { ...s, min: 80, max: 160 } : s));
    expect(evaluar('t', bases, uso, o, datos.meta).resumen.esfuerzo.max).toBeGreaterThan(a.resumen.esfuerzo.max);
  });

  it('sin uso, no retira nada', () => {
    const a = evaluar('t', analizarBase(objetos, base, 's4op'), null, opciones(), datos.meta);
    expect(a.resumen.porDecision.retirar).toBe(0);
  });
});

describe('GitHub', () => {
  it('acepta direcciones de repositorio con o sin rama', () => {
    expect(parsearUrlGitHub('https://github.com/abap2xlsx/abap2xlsx')).toEqual({ usuario: 'abap2xlsx', repo: 'abap2xlsx', rama: undefined });
    expect(parsearUrlGitHub('github.com/a/b/tree/dev')?.rama).toBe('dev');
    expect(parsearUrlGitHub('https://gitlab.com/a/b')).toBeNull();
  });
});

describe('duplicados, calendario y propuesta', async () => {
  const { buscarDuplicados } = await import('../src/analisis/duplicados');
  const { calendario, diasLaborables } = await import('../src/esfuerzo/calendario');
  const { propuestaObjeto } = await import('../src/analisis/propuesta');
  const cuerpo = Array.from({ length: 12 }, (_, i) => `SELECT SINGLE * FROM t00${i} INTO @DATA(ls_${i}).`).join('\n');

  it('agrupa copias casi iguales y no las que son distintas', () => {
    const { objetos } = leerRepositorio([
      { ruta: 'src/zr_a.prog.abap', contenido: `REPORT zr_a.\n${cuerpo}` },
      { ruta: 'src/zr_a_2.prog.abap', contenido: `REPORT zr_a_2.\n* copia\n${cuerpo}\nCLEAR lv.` },
      { ruta: 'src/zr_b.prog.abap', contenido: `REPORT zr_b.\n${Array.from({ length: 12 }, (_, i) => `lv_${i} = ${i}.`).join('\n')}` },
    ], 'Z');
    const g = buscarDuplicados(objetos);
    expect(g).toHaveLength(1);
    expect(g[0].miembros).toEqual(['PROG:ZR_A', 'PROG:ZR_A_2']);
  });

  it('cuenta días laborables y calcula el calendario por fases', () => {
    expect(diasLaborables('2026-11-02', '2026-11-08')).toBe(5);
    const r = { porFase: [{ fase: 0, nombre: 'a', objetos: 1, min: 5, max: 10 }, { fase: 1, nombre: 'b', objetos: 1, min: 10, max: 20 }] } as never;
    const c = calendario(r, { personas: 1, dedicacion: 1, inicio: '2026-11-02' });
    expect(c.fases[0].finMin).toBe('2026-11-06');
    expect(c.fases[1].inicioMin).toBe('2026-11-09');
    expect(c.finMax).toBe('2026-12-11');
    expect(c.llega).toBe(true);
  });

  it('propone la corrección automática y lista lo manual con el sucesor de SAP', () => {
    const { objetos } = leerRepositorio([{ ruta: 'src/zr_m.prog.abap', contenido: 'REPORT zr_m.\nMOVE a TO b.\nSELECT * FROM vbak INTO TABLE @DATA(lt).' }], 'Z');
    const a = evaluar('t', analizarBase(objetos, base, 's4pub'), null, opciones('s4pub'), datos.meta);
    const p = propuestaObjeto(a.resultados[0], 's4pub');
    expect(p.cambios[0]).toMatchObject({ linea: 2, a: 'b = a.' });
    expect(p.manuales.some((m) => /VBAK/.test(m.titulo) && /I_SALESDOCUMENT/.test(m.detalle))).toBe(true);
  });
});

describe('informe en inglés, guardar y comparar', async () => {
  const { exportarAnalisis, leerAnalisis, reconstruir, comparar } = await import('../src/informe/guardar');
  const { csvPlan } = await import('../src/informe/exportar');
  const { motivoEn } = await import('../src/informe/en');
  const { objetos } = leerRepositorio([
    { ruta: 'src/zr_x.prog.abap', contenido: "REPORT zr_x.\nSELECT * FROM vbuk INTO TABLE lt WHERE vbeln = lv.\nUPDATE mara SET mstae = 'X' WHERE matnr = lv." },
    { ruta: 'src/zr_y.prog.abap', contenido: 'REPORT zr_y.\nSELECT FROM i_product FIELDS product INTO TABLE @DATA(lt).' },
  ], 'Z');
  const uso = leerUso('OBJ_TYPE;OBJ_NAME;COUNTER\nPROG;ZR_X;10\nPROG;ZR_Y;0\n');
  const a = evaluar('t', analizarBase(objetos, base, 's4op'), uso, opciones(), datos.meta);

  it('guarda sin código, se vuelve a abrir y da el mismo resultado', () => {
    const texto = exportarAnalisis(a);
    expect(texto).not.toContain("mstae = 'X'");
    expect(texto).not.toContain('INTO TABLE lt WHERE vbeln');
    const b = leerAnalisis(texto);
    const r = reconstruir(b);
    const c = evaluar('t', r.bases, r.uso, b.opciones, datos.meta);
    expect(c.resumen.porDecision).toEqual(a.resumen.porDecision);
    expect(() => leerAnalisis('{"formato":"otro"}')).toThrow();
  });

  it('compara dos análisis', () => {
    const pub = evaluar('t', analizarBase(objetos, base, 's4pub'), uso, opciones('s4pub'), datos.meta);
    const cmp = comparar(pub, a);
    expect(cmp.delta.objetos).toBe(0);
    expect(cmp.delta.max).toBeGreaterThanOrEqual(0);
  });

  it('CSV y motivos en inglés', () => {
    const csv = csvPlan(a, 'en');
    expect(csv).toContain('Phase,Package,Type,Object,Decision');
    expect(csv).toMatch(/Rebuild|Retire|Keep|Adapt/);
    expect(motivoEn('3 punto(s) afectados por simplificaciones de S/4HANA.')).toBe('3 point(s) affected by S/4HANA simplifications.');
  });
});
