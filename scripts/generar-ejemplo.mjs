// Genera el SISTEMA DE EJEMPLO: una empresa FICTICIA con código Z de varias épocas (2006 a 2025) en formato abapGit
// y un CSV de uso INVENTADO, para probar Radar S/4 con un clic. Se indica como ficticio en la web y en el informe.
// Los objetos de SAP que usa (VBUK, KONV, BAPI_PO_CREATE1, I_PRODUCT...) son reales: así el análisis es representativo.
// Determinista (semilla fija). Salida: public/ejemplo/radar-s4-ejemplo.zip y public/ejemplo/uso-susg-ejemplo.csv
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let semilla = 20261029;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const elegir = (l) => l[Math.floor(azar() * l.length)];
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));

const archivos = {};
const objetos = []; // { tipo, nombre, paquete, ejecutable }
const poner = (ruta, texto) => { archivos[ruta] = strToU8(texto.replace(/\r?\n/g, '\r\n')); };
const carpeta = { ZRADAR: '', ZRADAR_SD: 'sd/', ZRADAR_MM: 'mm/', ZRADAR_FI: 'fi/', ZRADAR_PP: 'pp/', ZRADAR_INT: 'int/', ZRADAR_COMUN: 'comun/', ZRADAR_RAP: 'rap/' };
const ruta = (paq, fichero) => `src/${carpeta[paq]}${fichero}`;

poner('README.md', `# Sistema de ejemplo de Radar S/4

Código Z FICTICIO de una empresa inventada, generado para probar Radar S/4. No pertenece a ninguna empresa real.
Los objetos estándar de SAP que usa sí son reales. El CSV de uso también es inventado.
`);
poner('.abapgit.xml', `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA>
   <MASTER_LANGUAGE>S</MASTER_LANGUAGE>
   <STARTING_FOLDER>/src/</STARTING_FOLDER>
   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>
  </DATA>
 </asx:values>
</asx:abap>
`);

const xmlObjeto = (tipo, campos) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_${tipo}" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
${campos}
  </asx:values>
 </asx:abap>
</abapGit>
`;
for (const [paq, c] of Object.entries(carpeta)) poner(`src/${c}package.devc.xml`, xmlObjeto('DEVC', `   <DEVC>\n    <CTEXT>${paq}</CTEXT>\n   </DEVC>`));

const cab = (nombre, anio, texto) => `*&---------------------------------------------------------------------*
*& ${nombre}
*& ${texto}
*& Creado en ${anio}. Ejemplo ficticio generado para Radar S/4.
*&---------------------------------------------------------------------*`;

// ------------------------------------------------------------------ bloques de código por época
const LEGADO_SD = [
  () => `  SELECT * FROM vbuk INTO TABLE lt_vbuk WHERE vbeln IN s_vbeln.
  LOOP AT lt_vbuk INTO ls_vbuk WHERE gbstk <> 'C'.
    APPEND ls_vbuk-vbeln TO lt_abiertos.
  ENDLOOP.`,
  () => `  SELECT knumv kposn kschl kbetr FROM konv INTO TABLE lt_konv
    FOR ALL ENTRIES IN lt_pedidos WHERE knumv = lt_pedidos-knumv.`,
  () => `  SELECT SINGLE * FROM kna1 INTO ls_kna1 WHERE kunnr = lv_kunnr.
  SELECT * FROM knvv INTO TABLE lt_knvv WHERE kunnr = lv_kunnr.`,
  () => `  SELECT vbeln erdat netwr FROM vbak INTO TABLE lt_vbak WHERE erdat IN s_erdat.
  LOOP AT lt_vbak INTO ls_vbak.
    SELECT SINGLE name1 FROM kna1 INTO lv_nombre WHERE kunnr = ls_vbak-kunnr.
  ENDLOOP.`,
  () => `  SELECT * FROM vbup INTO TABLE lt_vbup WHERE vbeln = lv_vbeln.
  READ TABLE lt_vbup INTO ls_vbup INDEX 1.`,
];
const LEGADO_MM = [
  () => `  SELECT * FROM mkpf INTO TABLE lt_mkpf WHERE budat IN s_budat.
  SELECT * FROM mseg INTO TABLE lt_mseg FOR ALL ENTRIES IN lt_mkpf WHERE mblnr = lt_mkpf-mblnr.`,
  () => `  DATA lv_matnr(18) TYPE c.
  SELECT SINGLE * FROM mara INTO ls_mara WHERE matnr = lv_matnr.`,
  () => `  SELECT * FROM lfa1 INTO TABLE lt_lfa1 WHERE ktokk = 'ZNAC'.
  SELECT * FROM eban INTO TABLE lt_eban WHERE banfn IN s_banfn.`,
  () => `  CALL TRANSACTION 'MB1A' USING lt_bdc MODE 'N' MESSAGES INTO lt_msg.`,
  () => `  SELECT ebeln ebelp matnr menge FROM ekpo INTO TABLE lt_ekpo WHERE ebeln IN s_ebeln.`,
];
const LEGADO_FI = [
  () => `  SELECT * FROM bsid INTO TABLE lt_bsid WHERE bukrs = p_bukrs AND kunnr IN s_kunnr.
  SELECT * FROM bsad INTO TABLE lt_bsad WHERE bukrs = p_bukrs AND kunnr IN s_kunnr.`,
  () => `  SELECT * FROM bseg INTO TABLE lt_bseg WHERE bukrs = p_bukrs AND gjahr = p_gjahr.`,
  () => `  SELECT * FROM bsik INTO TABLE lt_bsik WHERE bukrs = p_bukrs.`,
  () => `  SELECT SINGLE * FROM bkpf INTO ls_bkpf WHERE bukrs = p_bukrs AND belnr = lv_belnr AND gjahr = p_gjahr.`,
];
const ESCRITURA_D = [
  () => `  UPDATE vbak SET zzestado = 'B' WHERE vbeln = lv_vbeln.`,
  () => `  MODIFY mara FROM ls_mara.`,
  () => `  UPDATE ekko SET zzaprobado = abap_true WHERE ebeln = lv_ebeln.`,
  () => `  UPDATE bkpf SET xblnr = lv_ref WHERE bukrs = p_bukrs AND belnr = lv_belnr AND gjahr = p_gjahr.`,
];
const SALIDA_GUI = [
  () => `  CALL FUNCTION 'REUSE_ALV_GRID_DISPLAY'
    EXPORTING
      i_callback_program = sy-repid
      it_fieldcat        = lt_fieldcat
    TABLES
      t_outtab           = lt_salida.`,
  () => `  LOOP AT lt_salida INTO ls_salida.
    WRITE: / ls_salida.
  ENDLOOP.`,
  () => `  CALL FUNCTION 'GUI_DOWNLOAD'
    EXPORTING
      filename = lv_fichero
    TABLES
      data_tab = lt_salida.`,
];
const BAPIS = [
  () => `  CALL FUNCTION 'BAPI_PO_CREATE1'
    EXPORTING
      poheader = ls_cabecera
    TABLES
      return   = lt_return
      poitem   = lt_posiciones.
  CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'.`,
  () => `  CALL FUNCTION 'BAPI_SALESORDER_CREATEFROMDAT2'
    EXPORTING
      order_header_in = ls_cabecera
    TABLES
      return          = lt_return.`,
  () => `  CALL FUNCTION 'BAPI_GOODSMVT_CREATE'
    EXPORTING
      goodsmvt_header = ls_cabecera
      goodsmvt_code   = ls_codigo
    TABLES
      goodsmvt_item   = lt_items
      return          = lt_return.`,
  () => `  CALL FUNCTION 'NUMBER_GET_NEXT'
    EXPORTING
      nr_range_nr = '01'
      object      = 'ZRADAR_DOC'
    IMPORTING
      number      = lv_numero.`,
  () => `  CALL FUNCTION 'READ_TEXT'
    EXPORTING
      id       = '0001'
      language = sy-langu
      name     = lv_nombre_texto
      object   = 'VBBK'
    TABLES
      lines    = lt_lineas.`,
];
const MODERNO = [
  () => `    SELECT FROM i_salesdocument
      FIELDS salesdocument, soldtoparty, totalnetamount
      WHERE salesdocumenttype = 'TA'
      INTO TABLE @DATA(lt_pedidos).`,
  () => `    SELECT FROM i_product
      FIELDS product, producttype
      WHERE producttype = 'FERT'
      INTO TABLE @DATA(lt_productos).`,
  () => `    DATA(lv_hoy) = cl_abap_context_info=>get_system_date( ).`,
  () => `    SELECT FROM i_journalentryitem
      FIELDS companycode, accountingdocument, amountincompanycodecurrency
      WHERE companycode = '1000'
      INTO TABLE @DATA(lt_apuntes).`,
  () => `    DATA(lo_log) = cl_bali_log=>create( ).`,
];

// ------------------------------------------------------------------ constructores de objetos
function programa(paq, nombre, anio, cuerpo) {
  const n = nombre.toLowerCase();
  poner(ruta(paq, `${n}.prog.abap`), `${cab(nombre, anio, 'Informe del área ' + paq.split('_')[1])}\nREPORT ${n}.\n\n${cuerpo}\n`);
  poner(ruta(paq, `${n}.prog.xml`), xmlObjeto('PROG', `   <PROGDIR>\n    <NAME>${nombre}</NAME>\n    <SUBC>1</SUBC>\n   </PROGDIR>`));
  objetos.push({ tipo: 'PROG', nombre, paquete: paq, ejecutable: true });
}
function include(paq, nombre, cuerpo) {
  const n = nombre.toLowerCase();
  poner(ruta(paq, `${n}.prog.abap`), `*&---------------------------------------------------------------------*\n*& Include ${nombre} (ejemplo ficticio)\n*&---------------------------------------------------------------------*\n${cuerpo}\n`);
  poner(ruta(paq, `${n}.prog.xml`), xmlObjeto('PROG', `   <PROGDIR>\n    <NAME>${nombre}</NAME>\n    <SUBC>I</SUBC>\n   </PROGDIR>`));
  objetos.push({ tipo: 'PROG', nombre, paquete: paq, ejecutable: false });
}
function clase(paq, nombre, anio, metodos) {
  const n = nombre.toLowerCase();
  const defs = metodos.map((m) => `    METHODS ${m.nombre}.`).join('\n');
  const impls = metodos.map((m) => `  METHOD ${m.nombre}.\n${m.cuerpo}\n  ENDMETHOD.`).join('\n\n');
  poner(ruta(paq, `${n}.clas.abap`), `"! Ejemplo ficticio generado para Radar S/4 (${anio})\nCLASS ${n} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n${defs}\nENDCLASS.\n\nCLASS ${n} IMPLEMENTATION.\n${impls}\nENDCLASS.\n`);
  poner(ruta(paq, `${n}.clas.xml`), xmlObjeto('CLAS', `   <VSEOCLASS>\n    <CLSNAME>${nombre}</CLSNAME>\n    <LANGU>S</LANGU>\n    <DESCRIPT>${nombre}</DESCRIPT>\n    <STATE>1</STATE>\n   </VSEOCLASS>`));
  objetos.push({ tipo: 'CLAS', nombre, paquete: paq, ejecutable: true });
}
function grupoFunciones(paq, grupo, funcs) {
  const g = grupo.toLowerCase();
  poner(ruta(paq, `${g}.fugr.l${g}top.abap`), `FUNCTION-POOL ${g}.\nDATA gt_cache TYPE STANDARD TABLE OF string WITH EMPTY KEY.\n`);
  poner(ruta(paq, `${g}.fugr.sapl${g}.abap`), `INCLUDE l${g}top.\nINCLUDE l${g}uxx.\n`);
  const items = funcs.map((f) => `     <item>\n      <FUNCNAME>${f.nombre}</FUNCNAME>\n      <SHORT_TEXT>${f.nombre}</SHORT_TEXT>\n     </item>`).join('\n');
  poner(ruta(paq, `${g}.fugr.xml`), xmlObjeto('FUGR', `   <AREAT>${grupo}</AREAT>\n   <INCLUDES>\n    <SOBJ_NAME>L${grupo}TOP</SOBJ_NAME>\n    <SOBJ_NAME>SAPL${grupo}</SOBJ_NAME>\n   </INCLUDES>\n   <FUNCTIONS>\n${items}\n   </FUNCTIONS>`));
  objetos.push({ tipo: 'FUGR', nombre: grupo, paquete: paq, ejecutable: true });
  for (const f of funcs) {
    poner(ruta(paq, `${g}.fugr.${f.nombre.toLowerCase()}.abap`), `FUNCTION ${f.nombre.toLowerCase()}.\n*"  Ejemplo ficticio generado para Radar S/4\n${f.cuerpo}\nENDFUNCTION.\n`);
    objetos.push({ tipo: 'FUNC', nombre: f.nombre, paquete: paq, ejecutable: true });
  }
}
function tabla(paq, nombre, campos) {
  poner(ruta(paq, `${nombre.toLowerCase()}.tabl.xml`), xmlObjeto('TABL', `   <DD02V>\n    <TABNAME>${nombre}</TABNAME>\n    <DDLANGUAGE>S</DDLANGUAGE>\n    <TABCLASS>TRANSP</TABCLASS>\n    <DDTEXT>${nombre}</DDTEXT>\n   </DD02V>\n   <DD03P_TABLE>\n${campos.map((c) => `    <DD03P>\n     <FIELDNAME>${c}</FIELDNAME>\n    </DD03P>`).join('\n')}\n   </DD03P_TABLE>`));
  objetos.push({ tipo: 'TABL', nombre, paquete: paq, ejecutable: false });
}
function cds(paq, nombre, fuente) {
  poner(ruta(paq, `${nombre.toLowerCase()}.ddls.asddls`), fuente);
  poner(ruta(paq, `${nombre.toLowerCase()}.ddls.xml`), xmlObjeto('DDLS', `   <DDLS>\n    <DDLNAME>${nombre}</DDLNAME>\n    <DDLANGUAGE>S</DDLANGUAGE>\n    <DDTEXT>${nombre}</DDTEXT>\n   </DDLS>`));
  objetos.push({ tipo: 'DDLS', nombre, paquete: paq, ejecutable: false });
}

// ------------------------------------------------------------------ la empresa ficticia
tabla('ZRADAR_COMUN', 'ZRADAR_PARAM', ['MANDT', 'CLAVE', 'VALOR']);
tabla('ZRADAR_COMUN', 'ZRADAR_LOG', ['MANDT', 'ID', 'FECHA', 'TEXTO']);
tabla('ZRADAR_SD', 'ZRADAR_COMIS', ['MANDT', 'VBELN', 'IMPORTE']);
tabla('ZRADAR_MM', 'ZRADAR_LOTES', ['MANDT', 'MATNR', 'CHARG', 'CADUCIDAD']);
tabla('ZRADAR_FI', 'ZRADAR_SII', ['MANDT', 'BUKRS', 'BELNR', 'ESTADO']);
tabla('ZRADAR_INT', 'ZRADAR_COLA', ['MANDT', 'ID', 'ESTADO', 'PAYLOAD']);
tabla('ZRADAR_PP', 'ZRADAR_PARADAS', ['MANDT', 'AUFNR', 'MINUTOS']);

include('ZRADAR_COMUN', 'ZRADAR_TOP_COMUN', `TABLES: t001.\nDATA: gt_param TYPE STANDARD TABLE OF zradar_param WITH HEADER LINE.\nSELECT * FROM zradar_param INTO TABLE gt_param.`);
include('ZRADAR_COMUN', 'ZRADAR_ALV_COMUN', `FORM mostrar_alv TABLES pt_datos.\n${SALIDA_GUI[0]()}\nENDFORM.`);
grupoFunciones('ZRADAR_COMUN', 'ZRADAR_UTIL', [
  { nombre: 'Z_RADAR_LEER_PARAM', cuerpo: `  SELECT SINGLE valor FROM zradar_param INTO ev_valor WHERE clave = iv_clave.` },
  { nombre: 'Z_RADAR_ENVIAR_MAIL', cuerpo: `  CALL FUNCTION 'SO_NEW_DOCUMENT_ATT_SEND_API1'\n    EXPORTING\n      document_data = ls_doc\n    TABLES\n      receivers     = lt_dest.` },
  { nombre: 'Z_RADAR_LOG', cuerpo: `  INSERT zradar_log FROM ls_log.` },
  { nombre: 'Z_RADAR_FECHA_LABORAL', cuerpo: `  CALL FUNCTION 'DATE_CONVERT_TO_FACTORYDATE'\n    EXPORTING\n      date                = iv_fecha\n      factory_calendar_id = 'ES'\n    IMPORTING\n      factorydate         = ev_dia.` },
  { nombre: 'Z_RADAR_OBSOLETA_2009', cuerpo: `  CALL FUNCTION 'WS_DOWNLOAD'\n    EXPORTING\n      filename = iv_fichero\n    TABLES\n      data_tab = it_datos.` },
]);
clase('ZRADAR_COMUN', 'ZCL_RADAR_LOG', 2023, [{ nombre: 'add', cuerpo: `${MODERNO[4]()}\n    INSERT zradar_log FROM @ls_log.` }]);
clase('ZRADAR_COMUN', 'ZCL_RADAR_PARAM', 2021, [{ nombre: 'get', cuerpo: `    SELECT SINGLE FROM zradar_param FIELDS valor WHERE clave = 'X' INTO @DATA(lv_valor).` }]);

const TEMAS = {
  ZRADAR_SD: { legado: LEGADO_SD, nombres: ['PEDIDOS_ABIERTOS', 'ENTREGAS_PEND', 'FACT_MENSUAL', 'COMISIONES', 'RAPPEL_CLIENTES', 'PRECIOS_ESPECIALES', 'BLOQUEOS_CREDITO', 'CARTERA_PEDIDOS', 'DEVOLUCIONES', 'PORTES', 'RUTAS_REPARTO', 'TARIFAS', 'PROMOCIONES', 'MUESTRAS', 'CONSIGNA'] },
  ZRADAR_MM: { legado: LEGADO_MM, nombres: ['STOCK_ALMACEN', 'MOVIMIENTOS', 'PEDIDOS_COMPRA', 'SOLPEDS', 'PROVEEDORES', 'INVENTARIO', 'CADUCIDADES', 'LOTES', 'TRASPASOS', 'ROTURAS', 'VALORACION', 'ETIQUETAS', 'RECEPCIONES', 'CONSUMOS', 'REAPROVISION'] },
  ZRADAR_FI: { legado: LEGADO_FI, nombres: ['PARTIDAS_ABIERTAS', 'CONCILIACION', 'CIERRE_MES', 'MODELO_347', 'SII_ENVIO', 'REMESAS', 'CONFIRMING', 'ANTIGUEDAD_DEUDA', 'PROVISIONES', 'ASIENTOS_MASIVOS', 'IVA_DEDUCIBLE', 'CENTROS_COSTE'] },
  ZRADAR_PP: { legado: [LEGADO_MM[0], LEGADO_MM[1], LEGADO_SD[2]], nombres: ['ORDENES_FAB', 'NOTIF_PLANTA', 'CAPACIDADES', 'LISTAS_MAT', 'MERMAS', 'TURNOS', 'OEE', 'PARADAS'] },
};
for (const [paq, tema] of Object.entries(TEMAS)) {
  for (const base of tema.nombres) {
    const variantes = entre(2, 4);
    for (let v = 1; v <= variantes; v++) {
      const nombre = `ZR${paq.split('_')[1]}_${base}${v > 1 ? '_' + v : ''}`.slice(0, 30);
      const anio = elegir([2006, 2008, 2009, 2011, 2012, 2014, 2016, 2018, 2019, 2021]);
      const partes = [`INCLUDE zradar_top_comun.`, `DATA: lt_salida TYPE STANDARD TABLE OF string, ls_salida TYPE string.`, `START-OF-SELECTION.`];
      partes.push(elegir(tema.legado)());
      if (azar() < 0.5) partes.push(elegir(tema.legado)());
      if (azar() < 0.35) partes.push(elegir(BAPIS)());
      if (azar() < 0.10) partes.push(elegir(ESCRITURA_D)());
      if (azar() < 0.4) partes.push(`  CALL FUNCTION 'Z_RADAR_LEER_PARAM'\n    EXPORTING\n      iv_clave = '${base}'\n    IMPORTING\n      ev_valor = lv_valor.`);
      if (azar() < 0.15) partes.push(`  CALL FUNCTION 'Z_RADAR_OBSOLETA_2009'\n    EXPORTING\n      iv_fichero = lv_fichero\n    TABLES\n      it_datos   = lt_salida.`);
      if (azar() < 0.4) partes.push(`  PERFORM mostrar_alv TABLES lt_salida.\n\nINCLUDE zradar_alv_comun.`);
      else partes.push(elegir(SALIDA_GUI)());
      if (azar() < 0.2) partes.push(`  MOVE lv_valor TO ls_salida.\n  ADD 1 TO lv_contador.\n  REFRESH lt_salida.`);
      programa(paq, nombre, anio, partes.join('\n\n'));
    }
  }
}

grupoFunciones('ZRADAR_INT', 'ZRADAR_IDOC', [
  { nombre: 'Z_RADAR_IDOC_PEDIDO_IN', cuerpo: `${BAPIS[1]()}\n  INSERT zradar_cola FROM ls_cola.` },
  { nombre: 'Z_RADAR_IDOC_FACTURA_OUT', cuerpo: `  SELECT * FROM vbrk INTO TABLE lt_vbrk WHERE fkdat = sy-datum.\n  SELECT * FROM vbrp INTO TABLE lt_vbrp FOR ALL ENTRIES IN lt_vbrk WHERE vbeln = lt_vbrk-vbeln.\n  CALL FUNCTION 'MASTER_IDOC_DISTRIBUTE'\n    EXPORTING\n      master_idoc_control = ls_control\n    TABLES\n      communication_idoc_control = lt_control\n      master_idoc_data    = lt_data.` },
  { nombre: 'Z_RADAR_RFC_STOCK', cuerpo: `  SELECT matnr werks lgort labst FROM mard INTO TABLE et_stock WHERE werks = iv_centro.` },
  { nombre: 'Z_RADAR_RFC_PRECIO', cuerpo: LEGADO_SD[1]() },
  { nombre: 'Z_RADAR_RFC_CLIENTE_ALTA', cuerpo: `  INSERT kna1 FROM ls_kna1.\n  INSERT knvv FROM ls_knvv.` },
  { nombre: 'Z_RADAR_RFC_ANTIGUA', cuerpo: `  SELECT * FROM bsik INTO TABLE et_partidas WHERE lifnr = iv_lifnr.` },
]);
for (const n of ['SII', 'BANCO', 'TRANSP', 'EDI', 'WEB', 'CRM', 'MES', 'ECOMM']) {
  clase('ZRADAR_INT', `ZCL_RADAR_INT_${n}`, elegir([2017, 2019, 2020, 2022]), [
    { nombre: 'enviar', cuerpo: `    DATA lo_http TYPE REF TO if_http_client.\n    cl_http_client=>create_by_url( EXPORTING url = lv_url IMPORTING client = lo_http ).\n    lo_http->send( ).` },
    { nombre: 'registrar', cuerpo: `    CALL FUNCTION 'Z_RADAR_LOG'\n      EXPORTING\n        is_log = ls_log.` },
  ]);
}

for (const [n, desc] of [['ZRADAR_EI_VA01_PRECIO', 'Precio especial en VA01'], ['ZRADAR_EI_MIGO_LOTE', 'Lote obligatorio en MIGO'], ['ZRADAR_EI_FB60_IVA', 'IVA en FB60']]) {
  poner(ruta('ZRADAR_COMUN', `${n.toLowerCase()}.enho.xml`), xmlObjeto('ENHO', `   <TOOL>HOOK_IMPL</TOOL>\n   <SHORTTEXT>${desc}</SHORTTEXT>`));
  poner(ruta('ZRADAR_COMUN', `${n.toLowerCase()}.enho.00000001.abap`), `" Ampliación implícita (ejemplo ficticio)\n  IF sy-tcode = 'VA01'.\n    SELECT SINGLE kbetr FROM konv INTO lv_kbetr WHERE knumv = vbak-knumv.\n  ENDIF.`);
  objetos.push({ tipo: 'ENHO', nombre: n, paquete: 'ZRADAR_COMUN', ejecutable: false });
}

cds('ZRADAR_RAP', 'ZI_RADAR_PARADA', `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Paradas de planta'
define root view entity ZI_RADAR_PARADA
  as select from zradar_paradas
  association [0..1] to I_Product as _Producto on $projection.Orden = _Producto.Product
{
  key aufnr   as Orden,
      minutos as Minutos,
      _Producto
}
`);
cds('ZRADAR_RAP', 'ZC_RADAR_PARADA', `@EndUserText.label: 'Paradas de planta (proyección)'
define root view entity ZC_RADAR_PARADA
  provider contract transactional_query
  as projection on ZI_RADAR_PARADA
{
  key Orden,
      Minutos
}
`);
cds('ZRADAR_RAP', 'ZI_RADAR_VENTAS_CUBO', `@EndUserText.label: 'Ventas por cliente'
define view entity ZI_RADAR_VENTAS_CUBO
  as select from I_SalesDocument
  association [0..1] to I_Customer as _Cliente on $projection.Cliente = _Cliente.Customer
{
  key SalesDocument  as Pedido,
      SoldToParty    as Cliente,
      TotalNetAmount as Importe,
      _Cliente
}
`);
cds('ZRADAR_SD', 'ZV_RADAR_PEDIDOS_OLD', `@AbapCatalog.sqlViewName: 'ZVRADARPED'
@EndUserText.label: 'Pedidos (vista antigua)'
define view ZV_RADAR_PEDIDOS_OLD as select from vbak
  inner join vbuk on vbak.vbeln = vbuk.vbeln
{
  vbak.vbeln,
  vbak.kunnr,
  vbuk.gbstk
}
`);
poner(ruta('ZRADAR_RAP', 'zi_radar_parada.bdef.asbdef'), `managed implementation in class zbp_radar_parada unique;
strict ( 2 );

define behavior for ZI_RADAR_PARADA alias Parada
persistent table zradar_paradas
lock master
authorization master ( instance )
{
  create;
  update;
  delete;
  field ( readonly ) Orden;
}
`);
objetos.push({ tipo: 'BDEF', nombre: 'ZI_RADAR_PARADA', paquete: 'ZRADAR_RAP', ejecutable: false });
clase('ZRADAR_RAP', 'ZBP_RADAR_PARADA', 2024, [{ nombre: 'validar', cuerpo: MODERNO[2]() }]);
for (const n of ['VENTAS', 'PRODUCTOS', 'APUNTES', 'KPI', 'CIERRE', 'ALERTAS', 'PREVISION', 'MARGEN', 'SERVICIO', 'EXPORT']) {
  clase('ZRADAR_RAP', `ZCL_RADAR_${n}`, elegir([2022, 2023, 2024, 2025]), [
    { nombre: 'leer', cuerpo: elegir(MODERNO.slice(0, 4))() },
    { nombre: 'procesar', cuerpo: elegir(MODERNO)() },
  ]);
}

// ------------------------------------------------------------------ uso INVENTADO (formato SUSG)
const filas = ['OBJ_TYPE;OBJ_NAME;COUNTER;LAST_USED'];
for (const o of objetos) {
  if (!o.ejecutable || /OBSOLETA|ANTIGUA/.test(o.nombre)) continue; // los que no aparecen: sin uso
  const moderno = /^Z(CL|BP)_RADAR_/.test(o.nombre);
  const usado = azar() < (moderno ? 0.98 : o.tipo === 'FUNC' ? 0.8 : 0.55);
  if (!usado && azar() < 0.5) continue;
  const n = usado ? Math.floor(Math.pow(10, 1 + azar() * 4)) : 0;
  const fecha = usado ? `2026${String(entre(7, 10)).padStart(2, '0')}${String(entre(1, 28)).padStart(2, '0')}` : '';
  filas.push(`${o.tipo};${o.nombre};${n};${fecha}`);
}

const destino = path.join(raiz, 'public', 'ejemplo');
fs.mkdirSync(destino, { recursive: true });
const zip = zipSync(Object.fromEntries(Object.entries(archivos).map(([r, b]) => [`radar-s4-ejemplo/${r}`, b])), { level: 9 });
fs.writeFileSync(path.join(destino, 'radar-s4-ejemplo.zip'), zip);
fs.writeFileSync(path.join(destino, 'uso-susg-ejemplo.csv'), filas.join('\r\n') + '\r\n');
const porTipo = objetos.reduce((a, o) => ((a[o.tipo] = (a[o.tipo] || 0) + 1), a), {});
console.log(`ejemplo ficticio: ${objetos.length} objetos ${JSON.stringify(porTipo)} · ${(zip.length / 1024).toFixed(0)} KB · ${filas.length - 1} filas de uso`);
