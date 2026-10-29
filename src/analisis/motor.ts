// Puente con el motor de CleanCore Check (JavaScript clásico que se registra en globalThis.CleanCore).
import '../engine/cleancore-engine.js';

export interface Sentencia {
  text: string;
  upper: string;
  start: number;
  end: number;
}

export interface ResultadoMotor {
  score: number;
  codeLines: number;
  lines: number;
  findings: { rule: string; cat: string; catLabel: string; sev: 'error' | 'warning' | 'info'; title: string; line: number; detail: string }[];
}

interface Motor {
  analyze(source: string, opts: { target: string; disabled?: string[] }): ResultadoMotor;
  splitStatements(source: string): { lines: string[]; statements: Sentencia[] };
  RULES: { id: string; cat: string; title: string; sev: string }[];
  CAT: Record<string, string>;
}

export const CleanCore = (globalThis as unknown as { CleanCore: Motor }).CleanCore;
