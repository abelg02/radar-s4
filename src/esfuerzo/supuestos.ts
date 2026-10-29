// Supuestos de esfuerzo por defecto. Son estimaciones del autor, no datos de SAP: el usuario los ve y los cambia.
import type { ReglasDecision, Supuesto } from '../tipos';

const AUTOR = 'Estimación del autor (editable)';

export const SUPUESTOS_POR_DEFECTO: Supuesto[] = [
  { id: 's4-error', grupo: 'hallazgo', nombre: 'Simplificación de S/4HANA obligatoria', descripcion: 'Tabla eliminada o sustituida, clientes y proveedores fuera de Business Partner, transacción obsoleta. Por aparición.', min: 2, max: 6, fuente: AUTOR },
  { id: 's4-aviso', grupo: 'hallazgo', nombre: 'Revisión por simplificación de S/4HANA', descripcion: 'SELECT sin ORDER BY con orden asumido, material de 18 caracteres, batch input. Por aparición.', min: 0.5, max: 2, fuente: AUTOR },
  { id: 'cloud-error', grupo: 'hallazgo', nombre: 'Tecnología no disponible en ABAP Cloud', descripcion: 'SAP GUI, ficheros, CALL TRANSACTION, memoria ABAP. Solo cuenta en Public Edition y en clean core estricto. Por aparición.', min: 1, max: 4, fuente: AUTOR },
  { id: 'cloud-aviso', grupo: 'hallazgo', nombre: 'Ajuste para ABAP Cloud', descripcion: 'Campos de sistema, COMMIT directo, mensajes de diálogo. Por aparición.', min: 0.25, max: 1, fuente: AUTOR },
  { id: 'sap-sucesor', grupo: 'sap', nombre: 'Sustituir un objeto de SAP por su sucesor', descripcion: 'El objeto no está liberado y SAP indica el sucesor en el Cloudification Repository. Por objeto de SAP distinto.', min: 1, max: 4, fuente: AUTOR },
  { id: 'sap-sin-sucesor', grupo: 'sap', nombre: 'Sustituir un objeto de SAP sin sucesor indicado', descripcion: 'Hay que buscar una API liberada o rediseñar esa parte. Por objeto de SAP distinto.', min: 4, max: 16, fuente: AUTOR },
  { id: 'sap-nivel-d', grupo: 'sap', nombre: 'Eliminar un uso de nivel D', descripcion: 'Escritura directa en tablas de SAP u objeto "noAPI": se rehace con una API (BAPI, BO RAP, EML). Por objeto de SAP distinto.', min: 8, max: 24, fuente: AUTOR },
  { id: 'base-retirar', grupo: 'decision', nombre: 'Retirar un objeto', descripcion: 'Confirmarlo con negocio, borrarlo y transportarlo.', min: 0.5, max: 1, fuente: AUTOR },
  { id: 'base-mantener', grupo: 'decision', nombre: 'Mantener un objeto', descripcion: 'Prueba de regresión tras la conversión.', min: 0.5, max: 1.5, fuente: AUTOR },
  { id: 'base-adaptar', grupo: 'decision', nombre: 'Adaptar un objeto', descripcion: 'Pruebas y transporte, además de cada corrección.', min: 1, max: 3, fuente: AUTOR },
  { id: 'base-rehacer', grupo: 'decision', nombre: 'Rehacer con clean core', descripcion: 'Diseño de la extensión (ABAP Cloud, BO RAP o BTP), pruebas y transporte.', min: 8, max: 24, fuente: AUTOR },
  { id: 'rehacer-100', grupo: 'decision', nombre: 'Rehacer: por cada 100 líneas de código', descripcion: 'Se suma al anterior según el tamaño del objeto, con un tope de 2.000 líneas.', min: 2, max: 6, fuente: AUTOR },
];

export const REGLAS_POR_DEFECTO: ReglasDecision = {
  ausenteEsSinUso: true,
  retirarEnCadena: true,
  nivelDEsRehacer: true,
  nivelCEsAdaptar: false,
};

export const HORAS_POR_JORNADA = 8;

/** Equipo por defecto del calendario: dos personas a tiempo completo desde hoy. */
export const EQUIPO_POR_DEFECTO = { personas: 2, dedicacion: 1, inicio: '' };
export const hoy = () => new Date().toISOString().slice(0, 10);
