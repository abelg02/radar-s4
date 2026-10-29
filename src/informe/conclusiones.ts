// Conclusiones y datos que faltan, redactados a partir de los resultados. Sin cifras que no salgan del análisis.
import type { Analisis } from '../tipos';
import { DESTINOS, num, pct, rango } from '../ui/util';
import { calendario, FIN_ECC } from '../esfuerzo/calendario';
import { fechaCorta } from '../ui/graficos';

export function conclusiones(a: Analisis): string[] {
  const r = a.resumen;
  const out: string[] = [];
  const total = r.objetos;
  const migrar = total - r.porDecision.retirar;

  if (r.tieneUso && r.porDecision.retirar) {
    out.push(`${num(r.porDecision.retirar)} de ${num(total)} objetos Z (${pct(r.porDecision.retirar, total)}) no se han ejecutado en el periodo medido y nada que se quede los necesita: se pueden retirar antes de migrar.`);
  } else if (!r.tieneUso) {
    out.push(`Sin datos de uso, ningún objeto se propone para retirar. Con un CSV de SUSG o SCMON el análisis separa lo que se usa de lo que no.`);
  }
  const cambiar = r.porDecision.adaptar + r.porDecision.rehacer;
  out.push(`De los ${num(migrar)} objetos que se migran, ${num(cambiar)} necesitan cambios para ${DESTINOS[a.opciones.destino].nombre}: ${num(r.porDecision.adaptar)} se adaptan y ${num(r.porDecision.rehacer)} se rehacen con clean core.`);
  out.push(`El esfuerzo estimado es de ${rango(r.esfuerzo.min, r.esfuerzo.max)} jornadas, con los supuestos de la página de metodología.${r.sensibilidad[0] ? ` El que más pesa es "${r.sensibilidad[0].supuesto}" (${Math.round(r.sensibilidad[0].peso * 100)} % del máximo).` : ''}`);
  const nd = r.porNivel.D;
  if (nd) out.push(`${num(nd)} objetos están en nivel D de clean core (escriben en tablas de SAP, usan objetos "noAPI" o amplían código estándar): son el principal riesgo en cada actualización.`);
  const top = r.topSap.find((s) => s.nivel !== 'A');
  if (top) out.push(`El objeto de SAP no liberado más usado es ${top.nombre}, en ${num(top.objetos)} objetos Z${top.sucesores.length ? `; SAP indica como sucesor ${top.sucesores.slice(0, 2).join(' o ')}` : ''}.`);
  const d = r.duplicados;
  if (d.grupos) out.push(`${num(d.objetos)} objetos forman ${num(a.duplicados.length)} grupo(s) de código casi duplicado: unificar las copias antes de migrar ahorraría entre ${rango(d.min, d.max)} jornadas.`);
  out.push(veredictoCalendario(calendario(r, a.opciones.equipo), a.opciones.equipo.personas));
  return out;
}

export function datosQueFaltan(a: Analisis): string[] {
  const r = a.resumen;
  const out: string[] = [];
  if (!r.tieneUso) out.push('Uso real (SUSG o SCMON): sin él no se puede saber qué código sobra.');
  else if (r.uso.desconocido) out.push(`${num(r.uso.desconocido)} objetos sin uso medido (includes, tablas, CDS sin consumidores en el repositorio...).`);
  out.push('Código que no está en el repositorio: si otros paquetes usan estos objetos, retirarlos puede romperlos.');
  out.push('Modificaciones del estándar (SPAU/SPDD) y personalización: no forman parte del código exportado con abapGit.');
  return out;
}

/** Frase con el resultado del calendario, sin cifras que no salgan del cálculo. */
export function veredictoCalendario(cal: ReturnType<typeof calendario>, personas: number): string {
  if (!cal.fases.length) return 'No hay trabajo que planificar.';
  const fin = `Con ${personas} persona${personas === 1 ? '' : 's'}, el trabajo termina entre el ${fechaCorta(cal.finMin)} y el ${fechaCorta(cal.finMax)}.`;
  if (cal.llega) return `${fin} Llega antes del fin del mantenimiento estándar de ECC (${fechaCorta(FIN_ECC)}).`;
  const necesarias = cal.personasNecesarias ? ` Para llegar también en el caso pesimista harían falta unas ${cal.personasNecesarias} personas con la misma dedicación.` : '';
  if (cal.llegaJusto) return `${fin} Solo llega a tiempo en el caso optimista.${necesarias}`;
  return `${fin} No llega antes del fin del mantenimiento estándar de ECC (${fechaCorta(FIN_ECC)}).${necesarias}`;
}

