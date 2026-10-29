/*
 * CleanCore Check - motor de análisis de código ABAP.
 * Funciona en el navegador (window.CleanCore) y en Node (globalThis.CleanCore) para los tests.
 * Todo se ejecuta en local: el código nunca sale del ordenador del usuario.
 *
 * No es un parser completo de ABAP: trabaja por sentencias con expresiones regulares,
 * eliminando antes comentarios y literales para no dar falsos positivos.
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* 1. Preparación: quitar comentarios, enmascarar literales, sentencias */
  /* ---------------------------------------------------------------- */

  // Devuelve la línea con literales sustituidos por '_' (misma longitud) y sin comentarios
  function maskLine(line) {
    if (/^\*/.test(line)) return { code: ' '.repeat(line.length), comment: line };
    let out = '';
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === quote) {
          // comilla doble dentro del literal ('' o ``) = escape
          if (line[i + 1] === quote && quote !== '|') { out += '__'; i++; continue; }
          quote = null; out += ch; continue;
        }
        if (quote === '|' && ch === '\\') { out += '__'; i++; continue; }
        out += '_';
        continue;
      }
      if (ch === "'" || ch === '`' || ch === '|') { quote = ch; out += ch; continue; }
      if (ch === '"') return { code: out + ' '.repeat(line.length - i), comment: line.slice(i) };
      out += ch;
    }
    return { code: out, comment: '' };
  }

  function splitStatements(source) {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const masked = lines.map(maskLine);
    const statements = [];
    let buf = '';
    let start = -1;

    for (let ln = 0; ln < lines.length; ln++) {
      const code = masked[ln].code;
      for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if (ch === '.') {
          const text = buf.replace(/\s+/g, ' ').trim();
          if (text) statements.push({ text, upper: text.toUpperCase(), start: start, end: ln });
          buf = ''; start = -1;
          continue;
        }
        if (start === -1 && ch.trim()) start = ln;
        buf += ch;
      }
      buf += ' ';
    }
    const rest = buf.replace(/\s+/g, ' ').trim();
    if (rest) statements.push({ text: rest, upper: rest.toUpperCase(), start: start, end: lines.length - 1, unterminated: true });

    // Sentencias encadenadas "DATA: a, b." -> se mantienen como una; añadimos la palabra clave
    statements.forEach((s, idx) => {
      s.index = idx;
      s.keyword = (s.upper.match(/^[A-Z][A-Z0-9_-]*(?:\s+[A-Z]+)?/) || [''])[0];
    });
    return { lines, masked, statements };
  }

  /* ---------------------------------------------------------------- */
  /* 2. Contexto: bucles, procedimientos, SORT previos                  */
  /* ---------------------------------------------------------------- */

  function buildContext(parsed) {
    const st = parsed.statements;
    const hasEndselect = st.some(s => /^ENDSELECT\b/.test(s.upper));
    const stack = [];
    const procs = [];
    let proc = null;

    st.forEach(s => {
      const u = s.upper;
      s.loopDepth = stack.length;
      s.loopKinds = stack.slice();

      if (/^(METHOD|FORM|FUNCTION|MODULE)\s/.test(u)) { proc = { name: s.text.split(' ')[1], start: s.start, kind: u.split(' ')[0] }; stack.length = 0; }
      if (/^(ENDMETHOD|ENDFORM|ENDFUNCTION|ENDMODULE)\b/.test(u) && proc) { proc.end = s.end; procs.push(proc); proc = null; }

      if (/^LOOP\b/.test(u)) stack.push('LOOP');
      else if (/^DO\b/.test(u)) stack.push('DO');
      else if (/^WHILE\b/.test(u)) stack.push('WHILE');
      else if (/^SELECT\b/.test(u) && hasEndselect && isSelectLoop(u)) { s.isSelectLoop = true; stack.push('SELECT'); }
      else if (/^(ENDLOOP|ENDDO|ENDWHILE|ENDSELECT)\b/.test(u)) stack.pop();
    });

    return { procs };
  }

  function isSelectLoop(u) {
    if (/^SELECT\s+SINGLE\b/.test(u)) return false;
    if (/\b(INTO|APPENDING)\s+(CORRESPONDING\s+FIELDS\s+OF\s+)?TABLE\b/.test(u)) return false;
    if (/^SELECT\s+COUNT\s*\(\s*\*\s*\)/.test(u) && !/\bINTO\b/.test(u)) return false;
    return true;
  }

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tableName = s => s.replace(/^@/, '').replace(/\[\]$/, '');
  function before(parsed, s, re, maxBack) {
    const from = Math.max(0, s.index - (maxBack || 100000));
    for (let i = s.index - 1; i >= from; i--) if (re.test(parsed.statements[i].upper)) return true;
    return false;
  }
  const isSql = u => /^(SELECT|WITH|OPEN\s+CURSOR|FETCH)\b/.test(u) || /^(INSERT|UPDATE|MODIFY|DELETE)\b.*@/.test(u) || /^UPDATE\b.*\bSET\b/.test(u);

  /* ---------------------------------------------------------------- */
  /* 3. Catálogo de reglas                                              */
  /* ---------------------------------------------------------------- */

  // Tablas estándar de SAP y su vista CDS liberada (cuando la sustitución es directa)
  const RELEASED = {
    MARA: 'I_Product', MAKT: 'I_ProductDescription', MARC: 'I_ProductPlantBasic', MARD: 'I_StockQuantityCurrentValue_2',
    VBAK: 'I_SalesDocument', VBAP: 'I_SalesDocumentItem', VBRK: 'I_BillingDocument', VBRP: 'I_BillingDocumentItem',
    LIKP: 'I_DeliveryDocument', LIPS: 'I_DeliveryDocumentItem',
    EKKO: 'I_PurchaseOrderAPI01', EKPO: 'I_PurchaseOrderItemAPI01',
    BKPF: 'I_JournalEntry', BSEG: 'I_JournalEntryItem', ACDOCA: 'I_JournalEntryItem',
    KNA1: 'I_Customer', LFA1: 'I_Supplier', BUT000: 'I_BusinessPartner',
    T001: 'I_CompanyCode', T001W: 'I_Plant', CSKS: 'I_CostCenter', T005: 'I_Country', T006: 'I_UnitOfMeasure',
    MSEG: 'I_MaterialDocumentItem_2', MATDOC: 'I_MaterialDocumentItem_2', MKPF: 'I_MaterialDocumentHeader_2',
    TCURR: 'I_ExchangeRateRawData', TCURC: 'I_Currency'
  };
  const OTHER_SAP_TABLES = ['EBAN', 'KNVV', 'KNB1', 'LFB1', 'LFM1', 'AUFK', 'AFKO', 'PRPS', 'PROJ', 'USR02', 'USR21', 'ADRC', 'STXH', 'TVARVC', 'T100', 'DD03L', 'DD02L', 'TADIR', 'MVKE', 'MBEW', 'KONV', 'PRCD_ELEMENTS', 'VBFA', 'VBUK', 'VBUP', 'BSID', 'BSIK', 'BSAD', 'BSAK', 'BSIS', 'BSAS', 'COEP', 'ANLA', 'EQUI', 'IFLOT', 'QMEL', 'JEST', 'CDHDR', 'CDPOS', 'NAST'];

  // Módulos de función con alternativa conocida
  const FM_ALT = {
    BAPI_TRANSACTION_COMMIT: 'En RAP: COMMIT ENTITIES. Fuera de RAP, el framework hace el commit.',
    BAPI_TRANSACTION_ROLLBACK: 'En RAP: ROLLBACK ENTITIES.',
    BAPI_PO_CREATE1: 'EML sobre el BO liberado I_PurchaseOrderTP_2 (MODIFY ENTITIES ... CREATE).',
    BAPI_PO_CHANGE: 'EML sobre el BO liberado I_PurchaseOrderTP_2 (MODIFY ENTITIES ... UPDATE).',
    BAPI_SALESORDER_CREATEFROMDAT2: 'EML sobre el BO liberado I_SalesOrderTP.',
    BAPI_USER_GET_DETAIL: 'cl_abap_context_info=>get_user_formatted_name( ) / get_user_technical_name( ).',
    CONVERSION_EXIT_ALPHA_INPUT: 'String template: |{ lv_value ALPHA = IN }|.',
    CONVERSION_EXIT_ALPHA_OUTPUT: 'String template: |{ lv_value ALPHA = OUT }|.',
    SO_NEW_DOCUMENT_ATT_SEND_API1: 'cl_bcs_mail_message (ver ZCL_ABK_MAIL).',
    SO_DOCUMENT_SEND_API1: 'cl_bcs_mail_message (ver ZCL_ABK_MAIL).',
    JOB_OPEN: 'Application Jobs: catálogo y plantilla de job + cl_apj_rt_api.',
    JOB_SUBMIT: 'Application Jobs: catálogo y plantilla de job + cl_apj_rt_api.',
    JOB_CLOSE: 'Application Jobs: catálogo y plantilla de job + cl_apj_rt_api.',
    NUMBER_GET_NEXT: 'cl_numberrange_runtime=>number_get( ) (ver ZCL_ABK_NUMBER_RANGE).',
    BAL_LOG_CREATE: 'cl_bali_log=>create_with_header( ) (ver ZCL_ABK_LOG).',
    BAL_LOG_MSG_ADD: 'if_bali_log->add_item( ) (ver ZCL_ABK_LOG).',
    BAL_DB_SAVE: 'cl_bali_log_db=>get_instance( )->save_log( ).',
    REUSE_ALV_GRID_DISPLAY: 'App Fiori Elements sobre una vista CDS de consumo.',
    REUSE_ALV_LIST_DISPLAY: 'App Fiori Elements sobre una vista CDS de consumo.',
    GUI_UPLOAD: 'Subida de ficheros en Fiori (RAP con large objects) o XCO para parsear XLSX.',
    GUI_DOWNLOAD: 'Descarga desde Fiori (RAP con large objects / stream).',
    POPUP_TO_CONFIRM: 'Diálogos en la capa UI (Fiori). En backend: acciones RAP con parámetros.',
    READ_TEXT: 'Textos largos: API/BO liberado del objeto correspondiente.',
    RP_CALC_DATE_IN_INTERVAL: 'Aritmética de fechas directa o cl_abap_datfm / XCO (xco_cp=>sy->date( )).',
    DATE_CONVERT_TO_FACTORYDATE: 'cl_scal_api (calendario de fábrica, liberada).',
    HR_READ_INFOTYPE: 'No disponible en ABAP Cloud: usar APIs de SuccessFactors / S/4 liberadas.'
  };

  const CLASS_ALT = {
    CL_HTTP_CLIENT: 'usa cl_web_http_client_manager con cl_http_destination_provider.',
    CL_REST_HTTP_CLIENT: 'usa cl_web_http_client_manager.',
    CL_BCS: 'usa cl_bcs_mail_message.',
    CL_DOCUMENT_BCS: 'usa cl_bcs_mail_textpart / cl_bcs_mail_binarypart.',
    CL_SAPUSER_BCS: 'el remitente se indica con cl_bcs_mail_message->set_sender( ).',
    CL_CAM_ADDRESS_BCS: 'usa cl_bcs_mail_message->add_recipient( ).',
    CL_FDT_XL_SPREADSHEET: 'usa xco_cp_xlsx para leer y escribir Excel.',
    CL_RECA_RS_SERVICES: 'no hay sustituto directo; resuelve la lógica sin ella.'
  };

  /*
   * Lista oficial de SAP (Cloudification Repository, github.com/SAP/abap-atc-cr-cv-s4hc), opcional.
   * La web la carga con CleanCore.setSapList(datos). Sin ella, las reglas usan las listas de arriba.
   * Formato compacto por nombre: "tipo|PCE|Public|BTP|clasificación|sucesores", varios tipos separados por ";".
   */
  let SAP_LIST = null;
  let SAP_META = null;
  // null: lista no cargada · undefined: lista cargada y el objeto no está (no liberado)
  function sapInfo(name, kinds) {
    if (!SAP_LIST) return null;
    const raw = SAP_LIST[name];
    if (!raw) return undefined;
    for (const e of raw.split(';')) {
      const [tipo, pce, pub, btp, cls, suc] = e.split('|');
      if (kinds.includes(tipo)) return { tipo, pce, pub, btp, cls, suc: suc ? suc.split(',') : [] };
    }
    return undefined;
  }
  const releasedFor = (info, target) => !!info && (target === 'btp' ? info.btp : target === 's4pub' ? info.pub : info.pce) === 'R';
  const successorText = info => (info && info.suc.length ? ` Sucesor que indica SAP: ${info.suc.slice(0, 3).join(', ')}.` : '');
  const OFFICIAL = 'no está liberado para ABAP Cloud según la lista oficial de SAP.';

  const S = { error: 'error', warning: 'warning', info: 'info' };
  const CAT = {
    cloud: 'Preparado para Cloud',
    s4: 'Migración a S/4HANA',
    release: 'Compatibilidad de versión',
    obsolete: 'Sintaxis obsoleta',
    perf: 'Rendimiento',
    security: 'Seguridad',
    quality: 'Buenas prácticas'
  };

  /*
   * Sistemas destino. Cada uno activa unas reglas u otras:
   *  - cloud: reglas de ABAP Cloud (en Private Edition se rebajan un nivel: allí son recomendación clean core)
   *  - s4:    reglas de simplificación de S/4HANA
   *  - release: versión de ABAP (para no proponer sintaxis que no compila)
   */
  const TARGETS = {
    ecc700: { label: 'ECC 6.0 · ABAP 7.00 a 7.31', release: 700, cloud: false, s4: false,
              note: 'Sistemas ECC sin los Enhancement Packages recientes. Se marca la sintaxis que no compilaría y no se proponen correcciones que la usen.' },
    ecc740: { label: 'ECC 6.0 · ABAP 7.40 / 7.50 (EhP7-8)', release: 740, cloud: false, s4: false,
              note: 'La mayoría de ECC actuales. Sintaxis moderna disponible salvo los operadores += (7.54).' },
    s4op:   { label: 'S/4HANA on-premise', release: 757, cloud: false, s4: true,
              note: 'Añade las reglas de simplificación de S/4HANA: tablas sustituidas, orden de SELECT en HANA, MATNR de 40, Business Partner.' },
    s4pce:  { label: 'S/4HANA Cloud Private Edition (clean core)', release: 757, cloud: 'soft', s4: true,
              note: 'Como on-premise, más las reglas de ABAP Cloud como recomendación (nivel A de clean core).' },
    s4pub:  { label: 'S/4HANA Cloud Public Edition', release: 999, cloud: true, s4: true,
              note: 'Solo ABAP Cloud: objetos liberados, sin SAP GUI, sin acceso a tablas de SAP.' },
    btp:    { label: 'SAP BTP ABAP Environment', release: 999, cloud: true, s4: true,
              note: 'ABAP Cloud en BTP (Steampunk): mismas restricciones que Public Edition.' }
  };
  // Nombres antiguos de destino (compatibilidad con versiones anteriores de la herramienta)
  const ALIAS = { cloud: 'btp', onprem: 's4op' };
  const resolveTarget = t => TARGETS[t] ? t : (ALIAS[t] || 'btp');

  // Reglas cuya corrección propuesta necesita ABAP 7.40
  const NEEDS_740 = new Set(['OBS-002', 'OBS-011', 'OBS-015', 'OBS-017']);

  const LOWER = { error: S.warning, warning: S.info, info: S.info };
  function ruleSeverity(rule, target) {
    const t = TARGETS[target];
    if (rule.targets && !rule.targets.includes(target)) return null;
    if (rule.cloud && !t.cloud) return null;
    if (rule.s4 && !t.s4) return null;
    if (NEEDS_740.has(rule.id) && t.release < 740) return null;
    if (rule.cloud && t.cloud === 'soft') return LOWER[rule.sev];
    return rule.sev;
  }

  const RULES = [
    /* ------------------------- Sintaxis obsoleta ------------------------- */
    { id: 'OBS-001', cat: 'obsolete', sev: S.warning, title: 'MOVE ... TO',
      why: 'MOVE es sintaxis obsoleta desde 7.40. La asignación con = es más corta y es la que espera cualquier revisor.',
      before: 'MOVE lv_matnr TO ls_item-matnr.', after: 'ls_item-matnr = lv_matnr.',
      test: s => /^MOVE\s/.test(s.upper) },
    { id: 'OBS-002', cat: 'obsolete', sev: S.info, title: 'MOVE-CORRESPONDING',
      why: 'El operador CORRESPONDING #( ) permite mapear campos con nombres distintos (MAPPING), excluir campos (EXCEPT) y trabajar con tablas en una sola expresión.',
      before: 'MOVE-CORRESPONDING ls_vbak TO ls_order.', after: 'ls_order = CORRESPONDING #( BASE ( ls_order ) ls_vbak ).',
      test: s => /^MOVE-CORRESPONDING\b/.test(s.upper) },
    { id: 'OBS-003', cat: 'obsolete', sev: S.warning, title: 'COMPUTE',
      why: 'COMPUTE no aporta nada: la expresión aritmética funciona igual sin la palabra clave.',
      before: 'COMPUTE lv_total = lv_qty * lv_price.', after: 'lv_total = lv_qty * lv_price.',
      test: s => /^COMPUTE\b/.test(s.upper) },
    { id: 'OBS-004', cat: 'obsolete', sev: S.warning, title: 'ADD / SUBTRACT / MULTIPLY / DIVIDE',
      why: 'Las sentencias aritméticas con palabra clave son obsoletas. Los operadores +=, -=, *= y /= existen desde 7.54 (o x = x + y en releases anteriores).',
      before: 'ADD 1 TO lv_count.', after: 'lv_count += 1.',
      test: s => /^(ADD|SUBTRACT|MULTIPLY|DIVIDE)\s+(?!-CORRESPONDING)/.test(s.upper) && !/^(ADD|SUBTRACT)-CORRESPONDING/.test(s.upper) },
    { id: 'OBS-005', cat: 'obsolete', sev: S.error, title: 'Tabla con cabecera (WITH HEADER LINE / OCCURS)',
      why: 'Las tablas con cabecera tienen dos objetos con el mismo nombre (tabla y área de trabajo). Producen errores difíciles de ver y están prohibidas en clases y en ABAP Cloud.',
      before: 'DATA lt_mara TYPE TABLE OF mara WITH HEADER LINE.', after: 'DATA lt_mara TYPE STANDARD TABLE OF mara WITH EMPTY KEY.\nDATA ls_mara LIKE LINE OF lt_mara.',
      test: s => /\bWITH\s+HEADER\s+LINE\b/.test(s.upper) || /\bOCCURS\s+\d+/.test(s.upper) },
    { id: 'OBS-006', cat: 'obsolete', sev: S.warning, title: 'Sentencia TABLES',
      why: 'TABLES crea un área de trabajo global con el nombre de la tabla. Solo se justifica en dynpros clásicos; en el resto, declara una estructura con DATA.',
      before: 'TABLES: mara.', after: 'DATA ls_mara TYPE mara.   " o mejor, solo los campos que necesitas',
      test: s => /^TABLES\s*:?\s*[A-Z]/.test(s.upper) && s.loopDepth === 0 && !/^TABLES\s+[A-Z0-9_]+\s+(STRUCTURE|LIKE|TYPE)\b/.test(s.upper) },
    { id: 'OBS-007', cat: 'obsolete', sev: S.warning, title: 'FORM / PERFORM',
      why: 'Las subrutinas están obsoletas desde hace años. Una clase local con métodos permite tipado estricto, tests unitarios y reutilización.',
      before: 'PERFORM get_data USING p_bukrs CHANGING gt_data.', after: 'gt_data = lcl_report=>get_data( p_bukrs ).',
      test: s => /^(FORM|PERFORM)\s/.test(s.upper) },
    { id: 'OBS-008', cat: 'obsolete', sev: S.warning, title: 'RANGES',
      why: 'RANGES crea una tabla con cabecera. Declara el rango con TYPE RANGE OF.',
      before: 'RANGES r_matnr FOR mara-matnr.', after: 'DATA lt_matnr_range TYPE RANGE OF matnr.',
      test: s => /^RANGES\b/.test(s.upper) },
    { id: 'OBS-009', cat: 'obsolete', sev: S.warning, title: 'REFRESH',
      why: 'REFRESH es obsoleto. CLEAR vacía la tabla igual; FREE además libera la memoria.',
      before: 'REFRESH lt_items.', after: 'CLEAR lt_items.',
      test: s => /^REFRESH\b/.test(s.upper) },
    { id: 'OBS-010', cat: 'obsolete', sev: S.info, title: 'DESCRIBE TABLE ... LINES',
      why: 'La función lines( ) devuelve lo mismo y se puede usar directamente en expresiones.',
      before: 'DESCRIBE TABLE lt_items LINES lv_count.', after: 'lv_count = lines( lt_items ).',
      test: s => /^DESCRIBE\s+TABLE\s+\S+\s+LINES\s+\S+$/.test(s.upper) },
    { id: 'OBS-011', cat: 'obsolete', sev: S.info, title: 'CREATE OBJECT',
      why: 'El operador NEW crea la instancia en una expresión y permite declarar la variable en línea.',
      before: 'DATA lo_app TYPE REF TO lcl_app.\nCREATE OBJECT lo_app.', after: 'DATA(lo_app) = NEW lcl_app( ).',
      test: s => /^CREATE\s+OBJECT\b/.test(s.upper) },
    { id: 'OBS-012', cat: 'obsolete', sev: S.info, title: 'CALL METHOD',
      why: 'La llamada funcional obj->metodo( ) es la forma estándar. CALL METHOD solo tiene sentido en llamadas dinámicas.',
      before: 'CALL METHOD lo_app->run EXPORTING iv_mode = 1.', after: 'lo_app->run( iv_mode = 1 ).',
      test: s => /^CALL\s+METHOD\s+(?!\()[A-Z0-9_]+(->|=>)[A-Z0-9_]+(?!\))/.test(s.upper) && !/\(\s*[A-Z0-9_]+\s*\)/.test(s.upper.split(/\s+/)[2] || '') },
    { id: 'OBS-013', cat: 'obsolete', sev: S.error, title: 'ON CHANGE OF',
      why: 'ON CHANGE OF está prohibido en clases y su comportamiento con valores iniciales es confuso. Usa AT NEW / AT END OF, LOOP AT ... GROUP BY o compara con una variable.',
      before: 'ON CHANGE OF ls_item-vbeln.\n  ...\nENDON.', after: 'LOOP AT lt_items INTO DATA(ls_item) GROUP BY ls_item-vbeln INTO DATA(lv_vbeln).\n  ...\nENDLOOP.',
      test: s => /^ON\s+CHANGE\s+OF\b/.test(s.upper) },
    { id: 'OBS-014', cat: 'obsolete', sev: S.error, title: 'LOOP sin área de trabajo',
      why: 'LOOP AT sin INTO / ASSIGNING / REFERENCE INTO usa la cabecera de la tabla. No compila en clases ni en ABAP Cloud.',
      before: 'LOOP AT lt_items.\n  WRITE lt_items-matnr.\nENDLOOP.', after: 'LOOP AT lt_items ASSIGNING FIELD-SYMBOL(<ls_item>).\n  ...\nENDLOOP.',
      test: s => /^LOOP\s+AT\s+(?!GROUP\b)(?!SCREEN\b)\S+/.test(s.upper) && !/\b(INTO|ASSIGNING|REFERENCE\s+INTO|TRANSPORTING\s+NO\s+FIELDS)\b/.test(s.upper) },
    { id: 'OBS-015', cat: 'obsolete', sev: S.info, title: 'READ TABLE en lugar de expresión de tabla',
      why: 'Para comprobar si existe una línea, line_exists( ) es más claro. Para leerla, la expresión de tabla itab[ ... ] (con VALUE #( ... OPTIONAL ) o TRY/CATCH) evita depender de sy-subrc.',
      before: "READ TABLE lt_items WITH KEY matnr = lv_matnr TRANSPORTING NO FIELDS.\nIF sy-subrc = 0.", after: "IF line_exists( lt_items[ matnr = lv_matnr ] ).",
      test: s => /^READ\s+TABLE\s+\S+\s+WITH\s+(TABLE\s+)?KEY\b/.test(s.upper) && !/\bBINARY\s+SEARCH\b/.test(s.upper) },
    { id: 'OBS-016', cat: 'obsolete', sev: S.info, title: 'CONCATENATE',
      why: 'Las string templates |...| y el operador && son más legibles y permiten formatear (fechas, ALPHA, decimales) en la misma expresión.',
      before: "CONCATENATE 'Pedido' lv_ebeln 'creado' INTO lv_text SEPARATED BY space.", after: 'lv_text = |Pedido { lv_ebeln } creado|.',
      test: s => /^CONCATENATE\b/.test(s.upper) && !/\bLINES\s+OF\b/.test(s.upper) },
    { id: 'OBS-017', cat: 'obsolete', sev: S.info, title: 'Open SQL sin host variables (@)',
      why: 'Sin @ en las variables ABAP la SELECT usa la sintaxis antigua. La sintaxis estricta (comas entre campos y @) es obligatoria para usar expresiones SQL, CASE, CAST, declaraciones en línea y para ABAP Cloud.',
      before: 'SELECT matnr mtart FROM mara INTO TABLE lt_mara WHERE mtart = p_mtart.', after: 'SELECT FROM mara\n  FIELDS matnr, mtart\n  WHERE mtart = @p_mtart\n  INTO TABLE @DATA(lt_mara).',
      test: s => /^SELECT\b/.test(s.upper) && /\bINTO\b/.test(s.upper) && !s.upper.includes('@') },

    /* ----------------------------- Rendimiento ---------------------------- */
    { id: 'PERF-001', cat: 'perf', sev: S.error, title: 'SELECT dentro de un bucle',
      why: 'Cada vuelta del bucle es un viaje a la base de datos. Con 10.000 líneas son 10.000 consultas. Lee todo antes del bucle (JOIN, FOR ALL ENTRIES o una vista CDS) y busca en una tabla interna SORTED o HASHED.',
      before: "LOOP AT lt_items INTO DATA(ls_item).\n  SELECT SINGLE maktx FROM makt INTO @DATA(lv_text)\n    WHERE matnr = @ls_item-matnr AND spras = @sy-langu.\nENDLOOP.",
      after: "SELECT FROM makt FIELDS matnr, maktx\n  FOR ALL ENTRIES IN @lt_items\n  WHERE matnr = @lt_items-matnr AND spras = @sy-langu\n  INTO TABLE @DATA(lt_texts).\n\" lt_texts declarada como HASHED TABLE ... WITH UNIQUE KEY matnr",
      test: s => (/^SELECT\b/.test(s.upper) || /^UPDATE\s+\S+\s+SET\b/.test(s.upper)) && s.loopDepth > 0 },
    { id: 'PERF-002', cat: 'perf', sev: S.warning, title: 'SELECT *',
      why: 'Leer todas las columnas multiplica el volumen transferido, sobre todo en tablas anchas (MARA tiene más de 200 campos). Selecciona solo los campos que usas.',
      before: 'SELECT * FROM mara INTO TABLE @DATA(lt_mara) WHERE mtart = @p_mtart.', after: 'SELECT FROM mara FIELDS matnr, mtart, matkl\n  WHERE mtart = @p_mtart INTO TABLE @DATA(lt_mara).',
      test: s => /^SELECT\s+(SINGLE\s+)?(FOR\s+UPDATE\s+)?\*/.test(s.upper) || /^SELECT\b.*\bFIELDS\s+\*/.test(s.upper) },
    { id: 'PERF-003', cat: 'perf', sev: S.error, title: 'FOR ALL ENTRIES sin comprobar que la tabla tenga datos',
      why: 'Si la tabla de FOR ALL ENTRIES está vacía, la condición se ignora y la SELECT lee la tabla entera. Es uno de los errores más caros que hay en productivo.',
      before: "SELECT FROM ekpo FIELDS ebeln, ebelp\n  FOR ALL ENTRIES IN @lt_ekko WHERE ebeln = @lt_ekko-ebeln\n  INTO TABLE @DATA(lt_ekpo).",
      after: "IF lt_ekko IS NOT INITIAL.\n  SELECT FROM ekpo FIELDS ebeln, ebelp\n    FOR ALL ENTRIES IN @lt_ekko WHERE ebeln = @lt_ekko-ebeln\n    INTO TABLE @DATA(lt_ekpo).\nENDIF.",
      test: (s, p) => {
        const m = s.upper.match(/FOR\s+ALL\s+ENTRIES\s+IN\s+(\S+)/);
        if (!m) return false;
        const t = esc(tableName(m[1]));
        return !before(p, s, new RegExp(`\\b${t}(\\[\\])?\\s+IS\\s+(NOT\\s+)?INITIAL|LINES\\(\\s*${t}\\s*\\)`), 15);
      } },
    { id: 'PERF-004', cat: 'perf', sev: S.error, title: 'BINARY SEARCH sin SORT previo',
      why: 'BINARY SEARCH solo funciona si la tabla está ordenada por la clave de búsqueda. Si no lo está, devuelve resultados incorrectos sin dar error. Mejor aún: declara la tabla SORTED o HASHED.',
      before: 'READ TABLE lt_mara INTO ls_mara WITH KEY matnr = lv_matnr BINARY SEARCH.', after: 'SORT lt_mara BY matnr.\n...\nREAD TABLE lt_mara INTO ls_mara WITH KEY matnr = lv_matnr BINARY SEARCH.',
      test: (s, p) => {
        const m = s.upper.match(/^READ\s+TABLE\s+(\S+).*\bBINARY\s+SEARCH\b/);
        if (!m) return false;
        return !before(p, s, new RegExp(`^SORT\\s+${esc(tableName(m[1]))}\\b`));
      } },
    { id: 'PERF-005', cat: 'perf', sev: S.warning, title: 'DELETE ADJACENT DUPLICATES sin SORT previo',
      why: 'Solo elimina duplicados consecutivos. Sin ordenar antes por los mismos campos, quedan duplicados.',
      before: 'DELETE ADJACENT DUPLICATES FROM lt_matnr COMPARING matnr.', after: 'SORT lt_matnr BY matnr.\nDELETE ADJACENT DUPLICATES FROM lt_matnr COMPARING matnr.',
      test: (s, p) => {
        const m = s.upper.match(/^DELETE\s+ADJACENT\s+DUPLICATES\s+FROM\s+(\S+)/);
        if (!m) return false;
        return !before(p, s, new RegExp(`^SORT\\s+${esc(tableName(m[1]))}\\b`));
      } },
    { id: 'PERF-006', cat: 'perf', sev: S.warning, title: 'LOOP ... WHERE anidado',
      why: 'Un LOOP con WHERE dentro de otro LOOP recorre la tabla interior entera en cada vuelta si es STANDARD. Con tablas grandes el coste es cuadrático. Usa una tabla SORTED por esos campos, una clave secundaria o LOOP AT ... GROUP BY.',
      before: "LOOP AT lt_header INTO DATA(ls_header).\n  LOOP AT lt_items INTO DATA(ls_item) WHERE vbeln = ls_header-vbeln.",
      after: "DATA lt_items TYPE SORTED TABLE OF ty_item WITH NON-UNIQUE KEY vbeln.\n\" el LOOP ... WHERE vbeln = ... usa entonces búsqueda binaria",
      test: s => /^LOOP\s+AT\b.*\bWHERE\b/.test(s.upper) && s.loopKinds.includes('LOOP') },
    { id: 'PERF-007', cat: 'perf', sev: S.warning, title: 'MODIFY dentro del LOOP con área de trabajo',
      why: 'Copiar cada línea a un área de trabajo y volver a escribirla con MODIFY es doble trabajo. Con ASSIGNING FIELD-SYMBOL modificas la línea directamente.',
      before: "LOOP AT lt_items INTO ls_item.\n  ls_item-status = 'X'.\n  MODIFY lt_items FROM ls_item.\nENDLOOP.",
      after: "LOOP AT lt_items ASSIGNING FIELD-SYMBOL(<ls_item>).\n  <ls_item>-status = 'X'.\nENDLOOP.",
      test: s => /^MODIFY\s+(?!ENTITIES)\S+\s+FROM\s+\S+(\s+INDEX\s+\S+)?(\s+TRANSPORTING\b.*)?$/.test(s.upper) && s.loopKinds.includes('LOOP') && !/^MODIFY\s+\S+\s+FROM\s+(TABLE\s+)?@/.test(s.upper) },
    { id: 'PERF-008', cat: 'perf', sev: S.warning, title: 'BYPASSING BUFFER',
      why: 'Salta el buffer de tabla, que existe precisamente para no ir a base de datos en tablas de configuración. Justifícalo con un comentario o quítalo.',
      before: 'SELECT SINGLE ... FROM t001 BYPASSING BUFFER ...', after: 'SELECT SINGLE ... FROM t001 ...',
      test: s => /\bBYPASSING\s+BUFFER\b/.test(s.upper) },
    { id: 'PERF-009', cat: 'perf', sev: S.warning, title: 'COMMIT WORK dentro de un bucle',
      why: 'Un COMMIT por línea es lento y deja datos a medias si falla a mitad. Agrupa en paquetes (por ejemplo, cada 1.000 registros) o haz un único COMMIT al final.',
      before: "LOOP AT lt_data INTO DATA(ls_data).\n  ...\n  COMMIT WORK.\nENDLOOP.", after: "LOOP AT lt_data INTO DATA(ls_data).\n  ...\nENDLOOP.\nCOMMIT WORK.",
      test: s => /^COMMIT\s+WORK\b/.test(s.upper) && s.loopDepth > 0 },
    { id: 'PERF-010', cat: 'perf', sev: S.warning, title: 'SELECT ... ENDSELECT',
      why: 'SELECT/ENDSELECT procesa fila a fila con un cursor abierto. Leer en bloque con INTO TABLE es más rápido y permite procesar con expresiones de tabla.',
      before: "SELECT matnr FROM mara INTO lv_matnr WHERE mtart = 'FERT'.\n  APPEND lv_matnr TO lt_matnr.\nENDSELECT.", after: "SELECT FROM mara FIELDS matnr\n  WHERE mtart = 'FERT'\n  INTO TABLE @DATA(lt_matnr).",
      test: s => !!s.isSelectLoop && !/\bUP\s+TO\s+1\s+ROWS\b/.test(s.upper) },

    /* ------------------------ Preparado para Cloud ------------------------ */
    { id: 'CLD-001', cat: 'cloud', sev: S.warning, cloud: true, title: 'Campos de sistema sy-datum / sy-uzeit / sy-uname',
      why: 'En ABAP Cloud la fecha, la hora y el usuario se obtienen con la API liberada CL_ABAP_CONTEXT_INFO. Los campos sy- no respetan la zona horaria del usuario ni el usuario técnico de BTP.',
      before: 'ls_log-created_on = sy-datum.\nls_log-created_by = sy-uname.', after: 'ls_log-created_on = cl_abap_context_info=>get_system_date( ).\nls_log-created_by = cl_abap_context_info=>get_user_technical_name( ).',
      test: s => /\bSY-(DATUM|UZEIT|UNAME|DATLO|TIMLO)\b/.test(s.upper) },
    { id: 'CLD-002', cat: 'cloud', sev: S.error, cloud: true, title: 'Acceso directo a tabla estándar de SAP',
      why: 'En ABAP Cloud (y en el modelo clean core) no se leen tablas de SAP directamente: se usan vistas CDS liberadas (released, contrato C1). Así el código sobrevive a las actualizaciones.',
      before: 'SELECT FROM mara FIELDS matnr, mtart ...', after: 'SELECT FROM I_Product FIELDS Product, ProductType ...',
      test: (s, parsed) => {
        if (!/^(SELECT|OPEN\s+CURSOR|WITH)\b/.test(s.upper) && !/\bJOIN\b/.test(s.upper)) return false;
        const found = [];
        const re = /\b(?:FROM|JOIN)\s+([A-Z0-9_\/]+)/g;
        let m;
        while ((m = re.exec(s.upper))) {
          const t = m[1];
          if (/^[ZY]/.test(t) || t.startsWith('/')) continue;
          const info = sapInfo(t, ['TABL', 'DDLS']);
          // Con la lista oficial: todo lo que no esté liberado para el destino (lo que no aparece, tampoco lo está)
          if (info === null ? (RELEASED[t] || OTHER_SAP_TABLES.includes(t)) : !releasedFor(info, parsed.target)) found.push({ t, info });
        }
        if (!found.length) return false;
        const { t, info } = found[0];
        const fallback = RELEASED[t] ? ` Usa la vista liberada ${RELEASED[t]}.` : ' Busca su vista CDS liberada en el SAP Business Accelerator Hub.';
        if (info !== null) return { detail: `${t} ${OFFICIAL}${successorText(info) || fallback}` };
        return { detail: RELEASED[t] ? `${t}: usa la vista liberada ${RELEASED[t]}.` : `${t}: busca su vista CDS liberada en el SAP Business Accelerator Hub o en el Cloudification Repository.` };
      } },
    { id: 'CLD-003', cat: 'cloud', sev: S.error, cloud: true, title: 'Interfaz SAP GUI (WRITE, dynpros, ALV clásico, pantallas de selección)',
      why: 'ABAP Cloud no tiene SAP GUI. La interfaz se hace con Fiori Elements sobre un servicio OData (RAP); para pruebas se usa IF_OO_ADT_CLASSRUN.',
      before: "WRITE: / 'Total:', lv_total.", after: "out->write( |Total: { lv_total }| ).   \" en una clase con IF_OO_ADT_CLASSRUN",
      test: s => /^(WRITE|ULINE|SKIP|NEW-LINE|NEW-PAGE|FORMAT|CALL\s+SCREEN|CALL\s+SELECTION-SCREEN|SET\s+SCREEN|LEAVE\s+(TO\s+)?SCREEN|LEAVE\s+LIST-PROCESSING|SET\s+PF-STATUS|SET\s+TITLEBAR|MODULE\s|PARAMETERS?\b|SELECT-OPTIONS\b|SELECTION-SCREEN\b|AT\s+SELECTION-SCREEN|AT\s+LINE-SELECTION|AT\s+USER-COMMAND|TOP-OF-PAGE|END-OF-PAGE)\b/.test(s.upper) || /\bCL_GUI_(?!FRONTEND_SERVICES)[A-Z_]+|\bCL_SALV_[A-Z_]+/.test(s.upper) },
    { id: 'CLD-004', cat: 'cloud', sev: S.error, cloud: true, title: 'Ficheros de PC o del servidor',
      why: 'En ABAP Cloud no hay acceso al PC del usuario ni al sistema de ficheros del servidor. Los ficheros entran por Fiori (RAP con large objects) o por integración (APIs, SFTP vía Integration Suite).',
      before: "CALL FUNCTION 'GUI_UPLOAD' ...\nOPEN DATASET lv_path FOR INPUT IN TEXT MODE ...", after: "\" Campo de tipo RAWSTRING con @Semantics.largeObject en la entidad RAP\n\" y XCO (xco_cp_xlsx) para leer Excel",
      test: s => /^OPEN\s+DATASET\b/.test(s.upper) || /\bCL_GUI_FRONTEND_SERVICES\b/.test(s.upper) },
    { id: 'CLD-005', cat: 'cloud', sev: S.error, cloud: true, title: 'CALL TRANSACTION / SUBMIT / LEAVE TO TRANSACTION',
      why: 'No hay transacciones ni reports en ABAP Cloud. La navegación entre apps se hace en Fiori (intent-based navigation) y los procesos en fondo con Application Jobs.',
      before: "CALL TRANSACTION 'VA03' AND SKIP FIRST SCREEN.\nSUBMIT zr_report AND RETURN.", after: "\" Navegación: anotación @UI.lineItem con type: #FOR_INTENT_BASED_NAVIGATION\n\" Fondo: Application Job (cl_apj_rt_api)",
      test: s => /^(CALL\s+TRANSACTION|SUBMIT|LEAVE\s+TO\s+TRANSACTION)\b/.test(s.upper) },
    { id: 'CLD-006', cat: 'cloud', sev: S.warning, cloud: true, title: 'Módulo de función no liberado',
      why: 'La mayoría de módulos de función, incluidas las BAPIs, no están liberados para ABAP Cloud. Comprueba su estado en el Cloudification Repository y usa el BO RAP o la clase liberada equivalente.',
      before: "CALL FUNCTION 'BAPI_PO_CREATE1' ...", after: "MODIFY ENTITIES OF i_purchaseordertp_2\n  ENTITY purchaseorder CREATE FIELDS ( ... ) WITH ...",
      test: (s, parsed) => {
        const m = s.upper.match(/^CALL\s+FUNCTION\s+'(_+)'/);
        if (!m) return false;
        const name = (s.rawText.match(/CALL\s+FUNCTION\s+'([^']+)'/i) || [])[1];
        if (!name) return true;
        const u = name.toUpperCase();
        if (/^Z|^Y/.test(u)) return false;
        const info = sapInfo(u, ['FUNC']);
        if (info !== null) {
          if (releasedFor(info, parsed.target)) return false;
          return { detail: `${u} ${OFFICIAL}${successorText(info)}${FM_ALT[u] ? ' ' + FM_ALT[u] : ''}` };
        }
        return { detail: FM_ALT[u] ? `${u}: ${FM_ALT[u]}` : `${u}: comprueba si está liberado; si no, busca la API sustituta.` };
      } },
    { id: 'CLD-007', cat: 'cloud', sev: S.error, cloud: true, title: 'EXPORT/IMPORT MEMORY, SET/GET PARAMETER',
      why: 'La memoria ABAP y SAP (SPA/GPA) no existen en ABAP Cloud. Pasa los datos como parámetros, o usa un buffer en una clase (atributos estáticos) dentro de la misma LUW.',
      before: "EXPORT lt_data TO MEMORY ID 'ZDATA'.", after: "zcl_buffer=>set_data( lt_data ).",
      test: s => /^(EXPORT|IMPORT)\b.*\b(TO|FROM)\s+(MEMORY|SHARED\s+(MEMORY|BUFFER)|DATABASE)\b/.test(s.upper) || /^(SET|GET)\s+PARAMETER\s+ID\b/.test(s.upper) || /^FREE\s+MEMORY\b/.test(s.upper) },
    { id: 'CLD-008', cat: 'cloud', sev: S.warning, cloud: true, title: 'COMMIT WORK / ROLLBACK WORK directo',
      why: 'En RAP el framework controla la LUW: dentro de un behavior pool no se hace COMMIT. Desde fuera de RAP se usa COMMIT ENTITIES tras un MODIFY ENTITIES.',
      before: "MODIFY ENTITIES OF zr_order ... .\nCOMMIT WORK.", after: "MODIFY ENTITIES OF zr_order ... .\nCOMMIT ENTITIES RESPONSE OF zr_order FAILED DATA(ls_failed) REPORTED DATA(ls_reported).",
      test: s => /^(COMMIT|ROLLBACK)\s+WORK\b/.test(s.upper) },
    { id: 'CLD-010', cat: 'cloud', sev: S.error, cloud: true, title: 'Clase de SAP no liberada',
      why: 'En ABAP Cloud solo se pueden usar clases e interfaces liberadas por SAP. Con la lista oficial cargada se comprueba cada una; sin ella, solo las que tienen sustituta directa conocida.',
      before: "cl_http_client=>create_by_url( EXPORTING url = lv_url IMPORTING client = lo_client ).", after: "DATA(lo_client) = cl_web_http_client_manager=>create_by_http_destination(\n  cl_http_destination_provider=>create_by_url( lv_url ) ).",
      test: (s, parsed) => {
        if (SAP_LIST) {
          // Clases e interfaces de SAP usadas en la sentencia. SAP GUI y ficheros ya los marcan CLD-003 y CLD-004.
          const re = /\b((?:CL|CX|IF)_[A-Z0-9_]+)\s*(?:=>|\()|\bTYPE\s+REF\s+TO\s+((?:CL|CX|IF)_[A-Z0-9_]+)|\b(?:NEW|CAST|INHERITING\s+FROM|INTERFACES)\s+((?:CL|CX|IF)_[A-Z0-9_]+)/g;
          let m;
          while ((m = re.exec(s.upper))) {
            const n = m[1] || m[2] || m[3];
            if (/^CL_(GUI|SALV)_/.test(n)) continue;
            const info = sapInfo(n, ['CLAS', 'INTF']);
            if (!releasedFor(info, parsed.target)) return { detail: `${n} ${OFFICIAL}${CLASS_ALT[n] ? ' Alternativa: ' + CLASS_ALT[n] : successorText(info)}` };
          }
          return false;
        }
        const m = s.upper.match(/\b(CL_HTTP_CLIENT|CL_REST_HTTP_CLIENT|CL_BCS|CL_DOCUMENT_BCS|CL_SAPUSER_BCS|CL_CAM_ADDRESS_BCS|CL_FDT_XL_SPREADSHEET|CL_RECA_RS_SERVICES)\b/);
        return m ? { detail: `${m[1]}: ${CLASS_ALT[m[1]]}` } : false;
      } },
    { id: 'CLD-009', cat: 'cloud', sev: S.warning, cloud: true, title: 'MESSAGE con tipo (diálogo)',
      why: 'MESSAGE ... TYPE muestra mensajes en SAP GUI. En ABAP Cloud los mensajes se devuelven en REPORTED (RAP), en un log de aplicación o lanzando una excepción.',
      before: "MESSAGE 'Material no encontrado' TYPE 'E'.", after: "RAISE EXCEPTION NEW zcx_material( textid = zcx_material=>not_found ).",
      test: s => /^MESSAGE\b.*\bTYPE\b/.test(s.upper) && !/\bINTO\b/.test(s.upper) },

    /* ------------------------------- Seguridad ----------------------------- */
    { id: 'SEC-001', cat: 'security', sev: S.error, title: 'Cláusula WHERE dinámica',
      why: 'Una condición WHERE construida concatenando texto es una puerta a inyección SQL si alguna parte viene del usuario. Valida con cl_abap_dyn_prg (quote, check_whitelist) o usa rangos / parámetros.',
      before: "lv_where = |kunnr = '{ p_kunnr }'|.\nSELECT ... WHERE (lv_where) ...", after: "lv_where = |kunnr = { cl_abap_dyn_prg=>quote( p_kunnr ) }|.\n\" o mejor: WHERE kunnr IN @lt_kunnr_range",
      test: s => /^(SELECT|UPDATE|DELETE|OPEN\s+CURSOR)\b.*\bWHERE\s*\(\s*[A-Z0-9_@<>-]+\s*\)/.test(s.upper) },
    { id: 'SEC-002', cat: 'security', sev: S.warning, title: 'Tabla o campos dinámicos en SQL',
      why: 'FROM (variable) o SELECT (variable) permiten leer cualquier tabla si el nombre viene de fuera. Valida el nombre con cl_abap_dyn_prg=>check_table_name_str o una lista blanca.',
      before: 'SELECT * FROM (lv_table) INTO TABLE @<lt_data>.', after: "lv_table = cl_abap_dyn_prg=>check_whitelist_str( val = lv_table whitelist = `ZT_A,ZT_B` ).",
      test: s => /^(SELECT|UPDATE|DELETE|INSERT|MODIFY|OPEN\s+CURSOR)\b/.test(s.upper) && (
        /\b(FROM|JOIN)\s*\(\s*[A-Z0-9_@-]+\s*\)/.test(s.upper) ||
        /^(UPDATE|INSERT|MODIFY|DELETE)\s*\(\s*[A-Z0-9_@-]+\s*\)/.test(s.upper) ||
        /^SELECT\s+(SINGLE\s+)?\(\s*[A-Z0-9_@-]+\s*\)/.test(s.upper) ||
        /\bFIELDS\s*\(\s*[A-Z0-9_@-]+\s*\)/.test(s.upper)) },
    { id: 'SEC-003', cat: 'security', sev: S.error, title: 'Credenciales en el código',
      why: 'Contraseñas, tokens o claves de API escritos en el código quedan visibles para cualquiera con acceso de lectura y viajan en transportes. Usa destinos HTTP, communication arrangements o el almacén seguro (SSF / Credential Store en BTP).',
      before: "lv_password = 'Secreto2026'.", after: "\" Credenciales en el destino o communication arrangement\nDATA(lo_http) = zcl_abk_http=>for_comm_arrangement( ... ).",
      test: s => /(^|[^A-Z0-9_])[A-Z0-9_]*(PASSWORD|PASSWD|PASS|PWD|SECRET|APIKEY|API_KEY|TOKEN)[A-Z0-9_]*\s*(=|\s+TYPE\s+\S+\s+VALUE)\s*['`]_+['`]/.test(s.upper) },
    { id: 'SEC-004', cat: 'security', sev: S.error, title: 'Usuario escrito en el código',
      why: 'Comparar sy-uname con un usuario concreto es una puerta trasera clásica y uno de los primeros hallazgos en una auditoría. Usa un objeto de autorización.',
      before: "IF sy-uname = 'JPEREZ'.\n  \" saltar validación\nENDIF.", after: "AUTHORITY-CHECK OBJECT 'Z_APROBAR' ID 'ACTVT' FIELD '16'.\nIF sy-subrc = 0.",
      test: s => /\bSY-UNAME\s*(=|EQ|<>|NE)\s*['`]/.test(s.upper) || /['`]_+['`]\s*(=|EQ)\s*SY-UNAME\b/.test(s.upper) },
    { id: 'SEC-005', cat: 'security', sev: S.warning, title: 'CLIENT SPECIFIED / USING CLIENT',
      why: 'Leer o escribir datos de otro mandante rompe la separación entre mandantes. Solo debería existir en herramientas técnicas muy concretas.',
      before: 'SELECT ... FROM zt_data CLIENT SPECIFIED WHERE mandt = lv_mandt ...', after: 'SELECT ... FROM zt_data WHERE ...',
      test: s => /\bCLIENT\s+SPECIFIED\b|\bUSING\s+(ALL\s+)?CLIENTS?\b/.test(s.upper) },
    { id: 'SEC-006', cat: 'security', sev: S.error, title: 'CALL TRANSACTION sin comprobar autorización',
      why: 'Desde 7.40 SP02 hay que indicar WITH o WITHOUT AUTHORITY-CHECK. Sin comprobación, el usuario puede ejecutar una transacción para la que no tiene permiso.',
      before: "CALL TRANSACTION 'SU01'.", after: "CALL TRANSACTION 'SU01' WITH AUTHORITY-CHECK.",
      test: s => /^CALL\s+TRANSACTION\b/.test(s.upper) && !/\bWITH\s+AUTHORITY-CHECK\b/.test(s.upper) },
    { id: 'SEC-007', cat: 'security', sev: S.error, title: 'Generación de código o SQL nativo',
      why: 'GENERATE SUBROUTINE POOL, INSERT REPORT, EXEC SQL o llamadas al kernel ejecutan código que no pasa por el control de calidad ni por las comprobaciones de seguridad.',
      before: 'GENERATE SUBROUTINE POOL lt_code NAME lv_prog.', after: '" Lógica estática, o patrones de diseño (estrategia, fábrica) con clases',
      test: s => /^(GENERATE\s+SUBROUTINE\s+POOL|INSERT\s+REPORT|DELETE\s+REPORT|EXEC\s+SQL|EDITOR-CALL|CALL\s+'_+')/.test(s.upper) || /\bCL_SQL_STATEMENT\b|\bSXPG_COMMAND_EXECUTE\b/.test(s.upper + (s.rawText || '').toUpperCase()) },

    /* ---------------------------- Buenas prácticas ------------------------- */
    { id: 'QA-001', cat: 'quality', sev: S.error, title: 'BREAK-POINT en el código',
      why: 'Un punto de parada fijo en el código se queda en productivo. Usa puntos de parada externos (de sesión o de usuario) desde ADT.',
      before: 'BREAK-POINT.', after: '" Punto de parada externo en ADT (doble clic en el margen)',
      test: s => /^(BREAK-POINT|BREAK\s+[A-Z0-9_]+)\b/.test(s.upper) },
    { id: 'QA-002', cat: 'quality', sev: S.warning, title: 'CATCH vacío',
      why: 'Capturar una excepción y no hacer nada oculta el error: el proceso sigue con datos incorrectos y nadie se entera. Como mínimo, regístrala en el log.',
      before: 'TRY.\n    ...\n  CATCH cx_root.\nENDTRY.', after: 'TRY.\n    ...\n  CATCH cx_sy_conversion_error INTO DATA(lx_error).\n    lo_log->exception( lx_error ).\nENDTRY.',
      test: (s, p) => {
        if (!/^CATCH\b(?!\s+SYSTEM-EXCEPTIONS)/.test(s.upper)) return false;
        const next = p.statements[s.index + 1];
        if (!next || !/^(ENDTRY|CATCH|CLEANUP)\b/.test(next.upper)) return false;
        // Un comentario que explica por qué se ignora cuenta como decisión consciente
        for (let l = s.end; l < next.start; l++) if (p.masked[l].comment.trim()) return false;
        return true;
      } },
    { id: 'QA-003', cat: 'quality', sev: S.warning, title: 'CATCH cx_root',
      why: 'cx_root captura cualquier error, incluidos los que deberían parar el programa. Captura la excepción concreta que esperas.',
      before: 'CATCH cx_root.', after: 'CATCH cx_sy_zerodivide cx_sy_conversion_no_number INTO DATA(lx_error).',
      test: s => /^CATCH\s+(BEFORE\s+UNWIND\s+)?CX_ROOT\b/.test(s.upper) },
    { id: 'QA-004', cat: 'quality', sev: S.warning, title: 'WAIT UP TO',
      why: 'WAIT UP TO bloquea un proceso de trabajo y suele usarse para esquivar problemas de bloqueos o de actualización asíncrona. Usa COMMIT AND WAIT, ENQUEUE con _WAIT o un diseño sin esperas.',
      before: 'WAIT UP TO 2 SECONDS.', after: "CALL FUNCTION 'BAPI_TRANSACTION_COMMIT' EXPORTING wait = abap_true.",
      test: s => /^WAIT\s+UP\s+TO\b/.test(s.upper) },
    { id: 'QA-005', cat: 'quality', sev: S.info, title: 'Pseudocomentario "#EC',
      why: 'Los pseudocomentarios "#EC están obsoletos para la comprobación ampliada. Usa pragmas (##NEEDED, ##NO_TEXT...).',
      before: 'DATA lv_x TYPE i.            "#EC NEEDED', after: 'DATA lv_x TYPE i ##NEEDED.',
      lineTest: (raw) => /"#EC\s+\w+/i.test(raw) },
    { id: 'QA-006', cat: 'quality', sev: S.info, title: 'Procedimiento muy largo',
      why: 'Un método de más de 100 líneas suele hacer varias cosas. Dividirlo en métodos pequeños facilita leerlo, probarlo con ABAP Unit y reutilizarlo.',
      before: 'METHOD process.   " 250 líneas', after: 'METHOD process.\n  read_data( ).\n  validate( ).\n  save( ).\nENDMETHOD.',
      procTest: proc => proc.end - proc.start > 100 },
    { id: 'QA-007', cat: 'quality', sev: S.info, title: 'Texto literal en un mensaje',
      why: 'Los textos escritos en el código no se pueden traducir. Usa una clase de mensajes o text symbols (TEXT-001).',
      before: "MESSAGE 'Pedido creado' TYPE 'S'.", after: "MESSAGE s001(zmm) WITH lv_ebeln.",
      test: s => /^MESSAGE\s+'_+'/.test(s.upper) && !/\bINTO\b/.test(s.upper) },
    { id: 'QA-008', cat: 'quality', sev: S.warning, title: 'Valor organizativo fijo en el código',
      why: 'Sociedades, centros u organizaciones escritos en el código (BUKRS = \'1000\') obligan a transportar un cambio cada vez que el negocio crece. Lleva esos valores a una tabla de parametrización Z, a TVARVC (on-premise) o a un parámetro de selección.',
      before: "SELECT ... WHERE bukrs = '1000' AND werks = '1100'.", after: "SELECT ... WHERE bukrs IN @lt_bukrs_param AND werks IN @lt_werks_param.\n\" lt_*_param leídos de ZPARAM_* o de TVARVC",
      test: s => /\b(BUKRS|WERKS|VKORG|EKORG|LGORT|KOKRS|VTWEG|SPART|BWKEY|PRCTR)\s*(=|EQ|<>|NE)\s*'_+'/.test(s.upper) },
    { id: 'QA-009', cat: 'quality', sev: S.warning, title: 'MESSAGE de tipo A o X',
      why: 'Un mensaje de tipo A (cancelación) o X (dump) termina el programa sin dar opción al llamador. En clases y procesos en fondo es mejor lanzar una excepción, que se puede capturar y registrar.',
      before: "MESSAGE e001(zmm) TYPE 'X'.", after: "RAISE EXCEPTION NEW zcx_mm_error( textid = zcx_mm_error=>material_missing ).",
      test: s => /^MESSAGE\b.*\bTYPE\s+'_'/.test(s.upper) && /\bTYPE\s+'[AX]'/i.test(s.rawText || '') },
    { id: 'QA-010', cat: 'quality', sev: S.info, title: 'Bloque de código comentado',
      why: 'El código comentado se queda para siempre y confunde a quien lee. El historial de versiones (SE38 > Utilidades > Versiones, o git con abapGit) ya guarda lo anterior: bórralo.',
      before: '* SELECT * FROM mara INTO TABLE lt_mara.\n* LOOP AT lt_mara INTO ls_mara.\n* ...', after: '" (eliminado: está en el historial de versiones)',
      blockTest: true },

    /* ---------------------------- Rendimiento (2) --------------------------- */
    { id: 'PERF-011', cat: 'perf', sev: S.info, title: 'SELECT COUNT(*) para comprobar si existe',
      why: 'Contar todas las filas solo para saber si hay alguna obliga a la base de datos a recorrerlas. Basta con leer una.',
      before: 'SELECT COUNT(*) FROM vbak WHERE kunnr = @lv_kunnr INTO @DATA(lv_n).\nIF lv_n > 0.', after: 'SELECT SINGLE @abap_true FROM vbak\n  WHERE kunnr = @lv_kunnr INTO @DATA(lv_exists).\nIF lv_exists = abap_true.',
      test: (s, p) => {
        if (!/^SELECT\s+COUNT\s*\(\s*\*\s*\)/.test(s.upper)) return false;
        const next = p.statements[s.index + 1];
        return !!next && /^IF\b.*(>\s*0|<>\s*0|IS\s+NOT\s+INITIAL|SY-SUBRC\s*(=|EQ)\s*0|SY-DBCNT\s*>\s*0)/.test(next.upper);
      } },
    { id: 'PERF-012', cat: 'perf', sev: S.warning, title: 'SORT dentro de un bucle',
      why: 'Ordenar una tabla en cada vuelta del bucle multiplica el coste por el número de vueltas. Ordena una vez antes del bucle, o usa una tabla SORTED que se mantiene ordenada sola.',
      before: "LOOP AT lt_head INTO DATA(ls_head).\n  SORT lt_items BY posnr.", after: "SORT lt_items BY vbeln posnr.\nLOOP AT lt_head INTO DATA(ls_head).",
      test: s => /^SORT\s/.test(s.upper) && s.loopDepth > 0 },
    { id: 'PERF-013', cat: 'perf', sev: S.info, title: 'COLLECT para sumar',
      why: 'COLLECT funciona, pero si los datos vienen de la base de datos es más eficiente que la suma la haga HANA con SUM y GROUP BY. Para tablas internas, LOOP AT ... GROUP BY con REDUCE es más claro.',
      before: 'LOOP AT lt_items INTO ls_item.\n  COLLECT ls_item INTO lt_totals.\nENDLOOP.', after: 'SELECT FROM vbap FIELDS matnr, SUM( kwmeng ) AS qty\n  WHERE vbeln IN @s_vbeln\n  GROUP BY matnr INTO TABLE @DATA(lt_totals).',
      test: s => /^COLLECT\s/.test(s.upper) },

    /* ------------------------------ Seguridad (2) ---------------------------- */
    { id: 'SEC-008', cat: 'security', sev: S.error, title: 'Escritura directa en tablas estándar de SAP',
      why: 'INSERT, UPDATE, MODIFY o DELETE sobre una tabla de SAP se salta todas las validaciones, los documentos de modificación y la lógica de actualización. Puede dejar datos inconsistentes que nadie sabe explicar. Usa la BAPI, el BO de RAP o la transacción correspondiente.',
      before: "UPDATE mara SET mtart = 'FERT' WHERE matnr = @lv_matnr.", after: "CALL FUNCTION 'BAPI_MATERIAL_SAVEDATA' ...\n\" o EML sobre I_ProductTP_2 en ABAP Cloud",
      test: s => {
        const m = s.upper.match(/^(?:INSERT\s+INTO|INSERT|UPDATE|MODIFY|DELETE\s+FROM|DELETE)\s+([A-Z0-9_\/]+)\b/);
        if (!m) return false;
        const t = m[1];
        if (/^(Z|Y|\/)/.test(t) || /^(TABLE|ADJACENT|LINES|INITIAL|DATASET|REPORT|ENTITIES|TEXTPOOL|DYNPRO)$/.test(t)) return false;
        // solo sentencias de base de datos: con SET, con FROM @ / FROM TABLE o con WHERE sin tabla interna conocida
        const isDb = /^UPDATE\s+\S+\s+SET\b/.test(s.upper) || /\bFROM\s+(TABLE\s+)?@/.test(s.upper) || /^DELETE\s+FROM\s+\S+\s+WHERE\b/.test(s.upper) || /^INSERT\s+INTO\s+\S+\s+VALUES\b/.test(s.upper);
        const knownSap = RELEASED[t] || OTHER_SAP_TABLES.includes(t) || S4_TABLES[t];
        const looksLikeVariable = /^(L[TSV]_|G[TSV]_|I[TS]_|C[TS]_|E[TS]_|R[TS]_|M[TS]_|IT_|WA_|<)/.test(t);
        if ((isDb && !looksLikeVariable) || (knownSap && /\b(FROM|SET)\b/.test(s.upper))) return { detail: `Tabla ${t}.` };
        return false;
      } },
    { id: 'SEC-009', cat: 'security', sev: S.warning, title: 'Ruta de fichero sin validar',
      why: 'Si la ruta de OPEN DATASET viene de un parámetro de pantalla, un usuario puede leer o escribir cualquier fichero del servidor al que tenga acceso el sistema (directory traversal). Valida la ruta con FILE_VALIDATE_NAME o usa nombres de fichero lógicos (FILE).',
      before: 'OPEN DATASET p_file FOR INPUT IN TEXT MODE ENCODING UTF-8.', after: "CALL FUNCTION 'FILE_VALIDATE_NAME'\n  EXPORTING logical_filename = 'Z_INTERFACES'\n  CHANGING  physical_filename = p_file\n  EXCEPTIONS OTHERS = 1.\nIF sy-subrc = 0.\n  OPEN DATASET p_file FOR INPUT IN TEXT MODE ENCODING UTF-8.",
      test: (s, p) => {
        const m = s.upper.match(/^OPEN\s+DATASET\s+((P|PA|IV|I)_[A-Z0-9_]+)\b/);
        if (!m) return false;
        return !p.statements.some(x => /FILE_VALIDATE_NAME|FILE_GET_NAME/.test((x.rawText || '').toUpperCase()));
      } },
    { id: 'SEC-010', cat: 'security', sev: S.warning, title: 'Transacción o programa dinámico',
      why: 'CALL TRANSACTION o SUBMIT con un nombre en una variable permite ejecutar cualquier transacción o report si el valor viene de fuera. Comprueba el valor contra una lista cerrada antes de llamar.',
      before: 'CALL TRANSACTION lv_tcode WITH AUTHORITY-CHECK.', after: "CASE lv_tcode.\n  WHEN 'VA03' OR 'ME23N'.\n    CALL TRANSACTION lv_tcode WITH AUTHORITY-CHECK.\nENDCASE.",
      test: s => /^CALL\s+TRANSACTION\s+(?!'_)[A-Z<]/.test(s.upper) || /^SUBMIT\s+\(/.test(s.upper) },

    /* --------------------- Compatibilidad con la versión ---------------------- */
    { id: 'REL-001', cat: 'release', sev: S.error, targets: ['ecc700'], title: 'Declaración en línea (requiere 7.40)',
      why: 'DATA(...) y FIELD-SYMBOL(...) en mitad de una sentencia existen desde ABAP 7.40. En un ECC con 7.0x o 7.31 el programa no compila.',
      before: 'LOOP AT lt_items INTO DATA(ls_item).', after: 'DATA ls_item LIKE LINE OF lt_items.\nLOOP AT lt_items INTO ls_item.',
      test: s => /(^|[^A-Z0-9_-])(DATA|FIELD-SYMBOL|FINAL)\(\s*[A-Z<]/.test(s.upper) },
    { id: 'REL-002', cat: 'release', sev: S.error, targets: ['ecc700'], title: 'Expresión de constructor (requiere 7.40)',
      why: 'NEW, VALUE, CONV, CORRESPONDING, COND, SWITCH, REF, CAST, EXACT, REDUCE y FILTER como expresiones aparecen en 7.40. En releases anteriores hay que usar CREATE OBJECT, APPEND, MOVE-CORRESPONDING e IF.',
      before: "lt_range = VALUE #( ( sign = 'I' option = 'EQ' low = 'A' ) ).", after: "ls_range-sign = 'I'. ls_range-option = 'EQ'. ls_range-low = 'A'.\nAPPEND ls_range TO lt_range.",
      test: s => /\b(NEW|VALUE|CONV|CORRESPONDING|COND|SWITCH|REF|CAST|EXACT|REDUCE|FILTER)\s+(#|[A-Z_][A-Z0-9_\/]*)\(\s/.test(s.upper) && !/^(DATA|CONSTANTS|TYPES|PARAMETERS|STATICS)\b.*\bVALUE\s+'/.test(s.upper) },
    { id: 'REL-003', cat: 'release', sev: S.error, targets: ['ecc700'], title: 'Expresión de tabla o line_exists (requiere 7.40)',
      why: 'itab[ ... ], line_exists( ) y line_index( ) son de 7.40. Antes se usa READ TABLE con sy-subrc.',
      before: 'IF line_exists( lt_mara[ matnr = lv_matnr ] ).', after: 'READ TABLE lt_mara WITH KEY matnr = lv_matnr TRANSPORTING NO FIELDS.\nIF sy-subrc = 0.',
      test: s => /\bLINE_(EXISTS|INDEX)\(/.test(s.upper) || /[A-Z0-9_>]\[\s+[A-Z0-9_]+\s*=/.test(s.upper) },
    { id: 'REL-004', cat: 'release', sev: S.error, targets: ['ecc700'], title: 'SQL con @ y comas (requiere 7.40 SP05)',
      why: 'La sintaxis estricta de Open SQL (variables con @, campos separados por comas, FIELDS, expresiones SQL) llega con 7.40 SP05. En releases anteriores no compila.',
      before: 'SELECT matnr, mtart FROM mara INTO TABLE @lt_mara WHERE mtart = @p_mtart.', after: 'SELECT matnr mtart FROM mara INTO TABLE lt_mara WHERE mtart = p_mtart.',
      test: s => /^(SELECT|INSERT|UPDATE|MODIFY|DELETE|WITH)\b/.test(s.upper) && /@/.test(s.upper) },
    { id: 'REL-005', cat: 'release', sev: S.error, targets: ['ecc700', 'ecc740'], title: 'Operador +=, -=, *= o /= (requiere 7.54)',
      why: 'Los operadores de asignación con cálculo existen desde ABAP 7.54 (S/4HANA 1809 en adelante). En ECC hay que escribir x = x + y.',
      before: 'lv_total += ls_pos-netwr.', after: 'lv_total = lv_total + ls_pos-netwr.',
      test: s => /^[A-Z0-9_<>\-~]+\s*(\+|-|\*|\/)=\s/.test(s.upper) },
    { id: 'REL-006', cat: 'release', sev: S.info, targets: ['ecc700'], title: 'String template (requiere 7.02)',
      why: 'Las string templates |...| y el operador && llegan con 7.02. En un 7.00 sin EhP2 se usa CONCATENATE.',
      before: 'lv_text = |Pedido { lv_ebeln }|.', after: "CONCATENATE 'Pedido' lv_ebeln INTO lv_text SEPARATED BY space.",
      test: s => /\|_*\|/.test(s.upper) || /&&/.test(s.upper) },

    /* ------------------------------ S/4HANA ---------------------------------- */
    { id: 'S4-001', cat: 's4', sev: S.error, s4: true, title: 'Tabla eliminada o sustituida en S/4HANA',
      why: 'S/4HANA simplificó el modelo de datos: tablas de estado, de condiciones, de índice y de totales desaparecieron o pasaron a ser vistas de compatibilidad sobre ACDOCA o MATDOC. Leerlas da resultados vacíos, incompletos o mucho más lentos.',
      before: 'SELECT ... FROM vbuk WHERE vbeln = @lv_vbeln ...', after: '" Los campos de estado están ahora en VBAK / LIKP / VBRK\nSELECT ... FROM vbak WHERE vbeln = @lv_vbeln ...',
      test: s => {
        if (!/^(SELECT|OPEN\s+CURSOR|WITH)\b/.test(s.upper)) return false;
        const re = /\b(?:FROM|JOIN)\s+([A-Z0-9_\/]+)/g;
        let m;
        while ((m = re.exec(s.upper))) if (S4_TABLES[m[1]]) return { detail: `${m[1]}: ${S4_TABLES[m[1]]}` };
        return false;
      } },
    { id: 'S4-002', cat: 's4', sev: S.warning, s4: true, title: 'Se da por hecho el orden de una SELECT sin ORDER BY',
      why: 'En las bases de datos anteriores, una SELECT solía devolver las filas ordenadas por clave aunque no se pidiera. En HANA no: el orden no está garantizado. Si después se usa BINARY SEARCH, DELETE ADJACENT DUPLICATES o AT NEW, el resultado cambia sin dar error. Es uno de los hallazgos más frecuentes al migrar.',
      before: "SELECT * FROM ekpo INTO TABLE lt_ekpo WHERE ebeln IN s_ebeln.\nREAD TABLE lt_ekpo INTO ls_ekpo WITH KEY ebeln = lv_ebeln BINARY SEARCH.", after: "SELECT * FROM ekpo INTO TABLE @lt_ekpo WHERE ebeln IN @s_ebeln\n  ORDER BY PRIMARY KEY.\n\" o SORT lt_ekpo BY ebeln. antes de la lectura",
      test: (s, p) => {
        const m = s.upper.match(/\b(?:INTO|APPENDING)\s+(?:CORRESPONDING\s+FIELDS\s+OF\s+)?TABLE\s+@?(?:DATA\()?([A-Z0-9_]+)/);
        if (!m || !/^SELECT\b/.test(s.upper) || /\bORDER\s+BY\b/.test(s.upper)) return false;
        const t = esc(m[1]);
        for (let i = s.index + 1; i < p.statements.length; i++) {
          const u = p.statements[i].upper;
          if (new RegExp(`^SORT\\s+${t}\\b`).test(u)) return false;
          if (new RegExp(`^READ\\s+TABLE\\s+${t}\\b.*\\bBINARY\\s+SEARCH\\b`).test(u)) return { detail: `${m[1]} se lee con BINARY SEARCH en la línea ${p.statements[i].start + 1} sin ordenar antes.` };
          if (new RegExp(`^DELETE\\s+ADJACENT\\s+DUPLICATES\\s+FROM\\s+${t}\\b`).test(u)) return { detail: `DELETE ADJACENT DUPLICATES sobre ${m[1]} en la línea ${p.statements[i].start + 1}.` };
          if (new RegExp(`^LOOP\\s+AT\\s+${t}\\b`).test(u)) {
            for (let j = i + 1; j < p.statements.length && !/^ENDLOOP\b/.test(p.statements[j].upper); j++) {
              if (/^AT\s+(NEW|END\s+OF|FIRST|LAST)\b/.test(p.statements[j].upper) && !/^AT\s+(FIRST|LAST)/.test(p.statements[j].upper)) return { detail: `AT NEW / AT END OF sobre ${m[1]} en la línea ${p.statements[j].start + 1}.` };
            }
          }
        }
        return false;
      } },
    { id: 'S4-003', cat: 's4', sev: S.warning, s4: true, title: 'Material con longitud fija de 18 caracteres',
      why: 'En S/4HANA el número de material (MATNR) puede tener hasta 40 caracteres. Las variables declaradas con 18 caracteres o los accesos con desplazamiento (matnr+0(18)) cortan el número sin avisar.',
      before: 'DATA lv_material TYPE c LENGTH 18.\nlv_short = ls_mara-matnr+0(18).', after: 'DATA lv_material TYPE matnr.\n" sin desplazamientos fijos sobre MATNR',
      test: s => /\b[A-Z0-9_]*(MATNR|MATERIAL|MATERIA|MAT_NR)[A-Z0-9_]*\s+(TYPE\s+C\s+LENGTH\s+18|TYPE\s+CHAR18|\(18\)\s+TYPE\s+C)\b/.test(s.upper) || /\bMATNR(\+\d+)?\(18\)/.test(s.upper) || /\bMATNR\+\d+\(\d+\)/.test(s.upper) },
    { id: 'S4-004', cat: 's4', sev: S.error, s4: true, title: 'Clientes y proveedores fuera de Business Partner',
      why: 'En S/4HANA los clientes y proveedores se mantienen como Business Partner (transacción BP). Las transacciones XD01/XK01 y sus BAPIs ya no se pueden usar para crear o modificar.',
      before: "CALL TRANSACTION 'XD01' USING lt_bdc.", after: "\" API de Business Partner: cl_md_bp_maintain=>maintain( )\n\" o la API OData API_BUSINESS_PARTNER",
      test: s => /^CALL\s+TRANSACTION\s+'_+'/.test(s.upper) && /CALL\s+TRANSACTION\s+'(XD0[1-6]|XK0[1-6]|FD0[1-6]|FK0[1-6]|MK0[1-6]|VD0[1-6])'/i.test(s.rawText || '') ||
                 /CALL\s+FUNCTION\s+'(BAPI_CUSTOMER_CREATEFROMDATA1|BAPI_CUSTOMER_CHANGEFROMDATA1|VENDOR_INSERT|VENDOR_UPDATE|BAPI_VENDOR_CREATE)'/i.test(s.rawText || '') },
    { id: 'S4-005', cat: 's4', sev: S.error, s4: true, title: 'Transacción de movimientos de stock obsoleta',
      why: 'Las transacciones MB01, MB1A, MB1B, MB1C, MB11, MB31 y similares no existen en S/4HANA. Los movimientos de mercancías se hacen con MIGO o con BAPI_GOODSMVT_CREATE.',
      before: "CALL TRANSACTION 'MB1A' USING lt_bdc MODE 'N'.", after: "CALL FUNCTION 'BAPI_GOODSMVT_CREATE'\n  EXPORTING goodsmvt_header = ls_header\n            goodsmvt_code   = ls_code\n  TABLES    goodsmvt_item   = lt_items\n            return          = lt_return.",
      test: s => /CALL\s+TRANSACTION\s+'(MB01|MB02|MB03|MB04|MB05|MB0A|MB11|MB1A|MB1B|MB1C|MB31|MBNL|MBRL|MBSF|MBSL|MBST|MBSU)'/i.test(s.rawText || '') },
    { id: 'S4-006', cat: 's4', sev: S.warning, s4: true, title: 'Batch input (CALL TRANSACTION ... USING)',
      why: 'Las grabaciones de batch input dependen de la disposición exacta de las pantallas, que cambia en S/4HANA (y muchas transacciones se sustituyen por apps Fiori). Es lo primero que se rompe tras una migración. Usa la BAPI o la API correspondiente.',
      before: "CALL TRANSACTION 'VA02' USING lt_bdcdata MODE 'N'.", after: "CALL FUNCTION 'BAPI_SALESORDER_CHANGE' ...",
      test: s => /^CALL\s+TRANSACTION\b.*\bUSING\b/.test(s.upper) }
  ];

  // Tablas de ECC que desaparecen o cambian de naturaleza en S/4HANA
  const S4_TABLES = {
    VBUK: 'eliminada. Los campos de estado de cabecera están en VBAK, LIKP y VBRK.',
    VBUP: 'eliminada. Los estados de posición están en VBAP, LIPS y VBRP.',
    KONV: 'sustituida por PRCD_ELEMENTS (condiciones de precio de documentos).',
    MKPF: 'vista de compatibilidad sobre MATDOC. Lee MATDOC o I_MaterialDocumentHeader_2.',
    MSEG: 'vista de compatibilidad sobre MATDOC. Lee MATDOC o I_MaterialDocumentItem_2.',
    BSIS: 'vista de compatibilidad sobre ACDOCA. Lee ACDOCA o I_JournalEntryItem.',
    BSAS: 'vista de compatibilidad sobre ACDOCA. Lee ACDOCA o I_JournalEntryItem.',
    BSID: 'vista de compatibilidad (partidas abiertas de deudores). Lee ACDOCA / BSEG o I_OperationalAcctgDocItem.',
    BSAD: 'vista de compatibilidad (partidas compensadas de deudores). Lee ACDOCA / BSEG.',
    BSIK: 'vista de compatibilidad (partidas abiertas de acreedores). Lee ACDOCA / BSEG.',
    BSAK: 'vista de compatibilidad (partidas compensadas de acreedores). Lee ACDOCA / BSEG.',
    GLT0: 'tabla de totales sustituida por ACDOCA (los totales se calculan al vuelo).',
    FAGLFLEXT: 'tabla de totales del nuevo libro mayor sustituida por ACDOCA.',
    FAGLFLEXA: 'sustituida por ACDOCA.',
    COEP: 'las partidas de CO están en ACDOCA (vista de compatibilidad).',
    COSP: 'totales de CO calculados desde ACDOCA (vista de compatibilidad).',
    COSS: 'totales de CO calculados desde ACDOCA (vista de compatibilidad).',
    KNKK: 'la gestión de crédito pasa a SAP Credit Management (UKMBP_CMS_SGM).',
    MSSA: 'tabla de agregados de stock eliminada; el stock se calcula desde MATDOC.',
    MARDH: 'tabla de histórico de stock sustituida; usar MATDOC / I_StockQuantityCurrentValue_2.',
    MCHBH: 'tabla de histórico de stock de lotes sustituida (MATDOC).',
    VAKPA: 'tabla de índice de ventas obsoleta; leer VBAK/VBPA directamente.',
    VAPMA: 'tabla de índice de ventas obsoleta; leer VBAP/VBAK directamente.',
    VLKPA: 'tabla de índice de entregas obsoleta; leer LIKP/VBPA.',
    VRKPA: 'tabla de índice de facturas obsoleta; leer VBRK/VBPA.'
  };

  /* ---------------------------------------------------------------- */
  /* 4. Modernizador: correcciones automáticas seguras (una línea)      */
  /* ---------------------------------------------------------------- */

  const FIXES = [
    // MOVE a TO b.  ->  b = a.
    { rule: 'OBS-001', re: /^(\s*)MOVE\s+(\S+)\s+TO\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[3]} = ${m[2]}.${m[4]}` },
    // COMPUTE x = ...  ->  x = ...
    { rule: 'OBS-003', re: /^(\s*)COMPUTE\s+(.*)$/i, fn: m => `${m[1]}${m[2]}` },
    { rule: 'OBS-004', re: /^(\s*)ADD\s+(\S+)\s+TO\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[3]} += ${m[2]}.${m[4]}` },
    { rule: 'OBS-004', re: /^(\s*)SUBTRACT\s+(\S+)\s+FROM\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[3]} -= ${m[2]}.${m[4]}` },
    { rule: 'OBS-004', re: /^(\s*)MULTIPLY\s+(\S+)\s+BY\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[2]} *= ${m[3]}.${m[4]}` },
    { rule: 'OBS-004', re: /^(\s*)DIVIDE\s+(\S+)\s+BY\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[2]} /= ${m[3]}.${m[4]}` },
    { rule: 'OBS-009', re: /^(\s*)REFRESH\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}CLEAR ${m[2]}.${m[3]}` },
    { rule: 'OBS-010', re: /^(\s*)DESCRIBE\s+TABLE\s+(\S+)\s+LINES\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[3]} = lines( ${m[2]} ).${m[4]}` },
    { rule: 'OBS-011', re: /^(\s*)CREATE\s+OBJECT\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[2]} = NEW #( ).${m[3]}` },
    // CALL METHOD obj->meth.  ->  obj->meth( ).
    { rule: 'OBS-012', re: /^(\s*)CALL\s+METHOD\s+([A-Za-z0-9_]+(?:->|=>)[A-Za-z0-9_]+)\s*\.(.*)$/i, fn: m => `${m[1]}${m[2]}( ).${m[3]}` },
    // CONCATENATE a b c INTO d.  ->  d = a && b && c.   (sin SEPARATED BY)
    { rule: 'OBS-016', re: /^(\s*)CONCATENATE\s+(.+?)\s+INTO\s+(\S+?)\s*\.(.*)$/i,
      fn: m => {
        const parts = tokens(m[2]);
        if (!parts || parts.length < 2) return null;
        return `${m[1]}${m[3]} = ${parts.join(' && ')}.${m[4]}`;
      } },
    // CONCATENATE a b INTO d SEPARATED BY x.  ->  d = |{ a }{ x }{ b }|.   (solo con variables, sin literales)
    { rule: 'OBS-016', re: /^(\s*)CONCATENATE\s+(.+?)\s+INTO\s+(\S+)\s+SEPARATED\s+BY\s+(space|\S+?)\s*\.(.*)$/i,
      fn: m => {
        const parts = tokens(m[2]);
        if (!parts || parts.length < 2 || parts.some(p => /^['`]/.test(p))) return null;
        const sep = /^space$/i.test(m[4]) ? ' ' : (/^'[^']*'$/.test(m[4]) ? m[4].slice(1, -1) : `{ ${m[4]} }`);
        if (/[|{}\\]/.test(sep.replace(/^\{ .* \}$/, ''))) return null;
        return `${m[1]}${m[3]} = |${parts.map(p => `{ ${p} }`).join(sep)}|.${m[5]}`;
      } }
  ];

  // Divide los operandos de CONCATENATE respetando literales con espacios
  function tokens(text) {
    const out = [];
    const re = /'(?:[^']|'')*'|`(?:[^`]|``)*`|\S+/g;
    let m;
    while ((m = re.exec(text))) out.push(m[0]);
    if (out.some(t => /^(SEPARATED|RESPECTING|IN)$/i.test(t))) return null;
    return out;
  }

  const SY_MAP = {
    datum: 'cl_abap_context_info=>get_system_date( )',
    uzeit: 'cl_abap_context_info=>get_system_time( )',
    uname: 'cl_abap_context_info=>get_user_technical_name( )'
  };

  // Variante de las correcciones aritméticas para sistemas anteriores a 7.54 (sin +=)
  const FIXES_OLD_ARITH = [
    { rule: 'OBS-004', re: /^(\s*)ADD\s+(\S+)\s+TO\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[3]} = ${m[3]} + ${m[2]}.${m[4]}` },
    { rule: 'OBS-004', re: /^(\s*)SUBTRACT\s+(\S+)\s+FROM\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[3]} = ${m[3]} - ${m[2]}.${m[4]}` },
    { rule: 'OBS-004', re: /^(\s*)MULTIPLY\s+(\S+)\s+BY\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[2]} = ${m[2]} * ${m[3]}.${m[4]}` },
    { rule: 'OBS-004', re: /^(\s*)DIVIDE\s+(\S+)\s+BY\s+(\S+?)\s*\.(.*)$/i, fn: m => `${m[1]}${m[2]} = ${m[2]} / ${m[3]}.${m[4]}` }
  ];

  function fixesFor(target) {
    const rel = TARGETS[target].release;
    let list = FIXES;
    if (rel < 754) list = FIXES_OLD_ARITH.concat(list.filter(f => f.rule !== 'OBS-004'));
    if (rel < 740) list = list.filter(f => f.rule !== 'OBS-011');   // NEW #( ) no existe
    if (rel < 702) list = list.filter(f => f.rule !== 'OBS-016');   // ni string templates ni &&
    return list;
  }

  function modernize(source, opts) {
    const parsed = splitStatements(source);
    const out = parsed.lines.slice();
    const changes = [];
    const target = resolveTarget(opts && opts.target);
    const cloud = TARGETS[target].cloud === true;
    const fixes = fixesFor(target);

    parsed.statements.forEach(s => {
      if (s.start !== s.end) return;                      // solo sentencias de una línea
      const raw = parsed.lines[s.start];
      const code = parsed.masked[s.start].code;
      if ((code.match(/\./g) || []).length !== 1) return;  // una sentencia por línea

      let line = raw;
      for (const f of fixes) {
        const m = line.match(f.re);
        if (!m) continue;
        const r = f.fn(m);
        if (r && r !== line) { line = r; changes.push({ line: s.start + 1, rule: f.rule, from: raw.trim(), to: r.trim() }); break; }
      }

      // sy-datum & co. fuera de SQL y fuera de comparaciones de seguridad (esas se revisan a mano)
      if (cloud && !isSql(s.upper) && !/\bSY-UNAME\s*(=|EQ|<>|NE)\s*'/i.test(raw) && /\bsy-(datum|uzeit|uname)\b/i.test(code)) {
        const comment = maskLine(line).comment;
        const head = line.slice(0, line.length - comment.length);
        if (maskLine(head).code === head) {               // sin literales en la línea
          const fixed = head.replace(/(\b(?:TYPE|LIKE)\s+)?\bsy-(datum|uzeit|uname)\b(\+|\()?/gi, (all, typ, f, off) => {
            if (typ || off) return all;                   // TYPE sy-datum o sy-datum+0(4): no se toca
            return SY_MAP[f.toLowerCase()];
          });
          if (fixed !== head) {
            line = fixed + comment;
            const last = changes[changes.length - 1];
            if (last && last.line === s.start + 1) { last.to = line.trim(); last.rule += ' + CLD-001'; }
            else changes.push({ line: s.start + 1, rule: 'CLD-001', from: raw.trim(), to: line.trim() });
          }
        }
      }
      out[s.start] = line;
    });

    return { code: out.join('\n'), changes };
  }

  /* ---------------------------------------------------------------- */
  /* 5. Análisis y puntuación                                           */
  /* ---------------------------------------------------------------- */

  const WEIGHT = { error: 8, warning: 4, info: 1 };

  function analyze(source, opts) {
    const target = resolveTarget((opts || {}).target);
    const disabled = new Set((opts || {}).disabled || []);
    const parsed = splitStatements(source);
    parsed.target = target;
    const ctx = buildContext(parsed);
    const findings = [];

    // Texto original de cada sentencia (para reglas que necesitan el literal, como CALL FUNCTION 'X')
    parsed.statements.forEach(s => {
      s.rawText = parsed.lines.slice(s.start, s.end + 1).join(' ');
    });

    const sevOf = {};
    RULES.forEach(r => { sevOf[r.id] = disabled.has(r.id) ? null : ruleSeverity(r, target); });
    const active = RULES.filter(r => sevOf[r.id]);

    active.forEach(rule => {
      const sev = sevOf[rule.id];
      if (rule.test) {
        parsed.statements.forEach(s => {
          // " cleancore:ignorar SEC-010 motivo   -> excepción documentada en la propia línea
          const ign = (s.rawText.match(/cleancore:\s*ignorar\s+([A-Z0-9\-, ]+)/i) || [])[1];
          if (ign && ign.toUpperCase().split(/[\s,]+/).includes(rule.id)) return;
          let res;
          try { res = rule.test(s, parsed); } catch (e) { res = false; }
          if (!res) return;
          findings.push(makeFinding(rule, sev, s.start + 1, parsed.lines[s.start].trim(), res.detail));
        });
      }
      if (rule.lineTest) {
        parsed.lines.forEach((raw, i) => { if (rule.lineTest(raw)) findings.push(makeFinding(rule, sev, i + 1, raw.trim())); });
      }
      if (rule.procTest) {
        ctx.procs.forEach(p => { if (rule.procTest(p)) findings.push(makeFinding(rule, sev, p.start + 1, parsed.lines[p.start].trim(), `${p.end - p.start + 1} líneas`)); });
      }
      if (rule.blockTest) {
        commentedCodeBlocks(parsed).forEach(b => findings.push(makeFinding(rule, sev, b.start + 1, parsed.lines[b.start].trim(), `${b.size} líneas comentadas seguidas`)));
      }
    });

    findings.sort((a, b) => a.line - b.line);

    // Puntuación: cada regla resta su peso; repeticiones de la misma regla restan la mitad, con tope x3
    const byRule = {};
    findings.forEach(f => { byRule[f.rule] = (byRule[f.rule] || 0) + 1; });
    const penalty = (ids) => ids.reduce((sum, id) => {
      const w = WEIGHT[sevOf[id]];
      const n = byRule[id];
      return sum + Math.min(w * (1 + 0.5 * (n - 1)), w * 3);
    }, 0);

    const categories = {};
    Object.keys(CAT).forEach(c => {
      // Solo las categorías que tienen alguna regla activa para este destino
      if (!active.some(r => r.cat === c)) return;
      const ids = Object.keys(byRule).filter(id => RULES.find(r => r.id === id).cat === c);
      categories[c] = {
        label: CAT[c],
        count: findings.filter(f => f.cat === c).length,
        score: Math.round(100 * Math.exp(-penalty(ids) / 40))
      };
    });

    const codeLines = parsed.lines.filter((l, i) => parsed.masked[i].code.trim()).length;
    // Curva exponencial: un error grave resta ~6 puntos; un programa muy antiguo ronda 10-20
    const score = Math.round(100 * Math.exp(-penalty(Object.keys(byRule)) / 120));

    return {
      score,
      grade: score >= 85 ? 'Bueno' : score >= 60 ? 'Mejorable' : 'Necesita trabajo',
      target,
      targetLabel: TARGETS[target].label,
      rulesActive: active.length,
      lines: parsed.lines.length,
      codeLines,
      statements: parsed.statements.length,
      counts: {
        error: findings.filter(f => f.sev === 'error').length,
        warning: findings.filter(f => f.sev === 'warning').length,
        info: findings.filter(f => f.sev === 'info').length
      },
      categories,
      findings
    };
  }

  function makeFinding(rule, sev, line, snippet, detail) {
    return {
      rule: rule.id, cat: rule.cat, catLabel: CAT[rule.cat], sev, title: rule.title,
      why: rule.why, before: rule.before, after: rule.after, line, snippet, detail: detail || ''
    };
  }

  // Bloques de 5 o más líneas de comentario seguidas que contienen código ABAP
  const CODE_LIKE = /^(DATA|TYPES|SELECT|ENDSELECT|LOOP|ENDLOOP|IF|ELSE|ENDIF|CALL|MOVE|APPEND|READ|WRITE|CLEAR|PERFORM|MODIFY|DELETE|INSERT|UPDATE|CONCATENATE|CASE|WHEN|ENDCASE|DO|ENDDO|CHECK|EXIT|SORT|FORM|ENDFORM|METHOD|ENDMETHOD|[A-Z0-9_<>-]+\s*=)\b/i;
  function commentedCodeBlocks(parsed) {
    const blocks = [];
    let start = -1, size = 0, codeLike = 0;
    const flush = () => { if (size >= 5 && codeLike >= 3) blocks.push({ start, size }); start = -1; size = 0; codeLike = 0; };
    parsed.lines.forEach((raw, i) => {
      const isComment = !parsed.masked[i].code.trim() && parsed.masked[i].comment.trim();
      if (!isComment) { flush(); return; }
      const text = raw.trim().replace(/^[*"]+\s*/, '');
      if (start === -1) start = i;
      size++;
      if (CODE_LIKE.test(text) && /[.,:]\s*$/.test(text)) codeLike++;
    });
    flush();
    return blocks;
  }

  /* Informe en Markdown (para la función de exportar) */
  function toMarkdown(result, fileName) {
    const L = [];
    L.push(`# Informe CleanCore Check${fileName ? ' - ' + fileName : ''}`);
    L.push('');
    L.push(`- Sistema destino: ${result.targetLabel}`);
    L.push(`- Puntuación: **${result.score}/100** (${result.grade})`);
    L.push(`- Líneas: ${result.lines} (${result.codeLines} con código)`);
    L.push(`- Hallazgos: ${result.counts.error} errores, ${result.counts.warning} avisos, ${result.counts.info} sugerencias`);
    L.push('');
    L.push('| Categoría | Hallazgos | Puntuación |');
    L.push('|---|---|---|');
    Object.values(result.categories).forEach(c => L.push(`| ${c.label} | ${c.count} | ${c.score} |`));
    L.push('');
    L.push('## Hallazgos');
    result.findings.forEach(f => {
      L.push('');
      L.push(`### Línea ${f.line} · ${f.rule} · ${f.title} (${f.sev})`);
      L.push('```abap');
      L.push(f.snippet);
      L.push('```');
      if (f.detail) L.push(f.detail);
      L.push(f.why);
    });
    return L.join('\n');
  }

  // Carga la lista oficial de SAP (objeto { meta, objetos } de sap-apis.json). null la descarga.
  function setSapList(data) {
    SAP_LIST = data && data.objetos ? data.objetos : null;
    SAP_META = SAP_LIST ? data.meta || {} : null;
  }
  const sapList = () => SAP_META;

  root.CleanCore = { analyze, modernize, toMarkdown, RULES, CAT, TARGETS, ruleSeverity, splitStatements, setSapList, sapList, sapInfo };
})(typeof window !== 'undefined' ? window : globalThis);
