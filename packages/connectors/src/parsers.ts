/** Conversores tolerantes de células de planilha (formato brasileiro). Retornam null quando inválido. */

export function parseCpf(v: string): string | null {
  let d = v.replace(/\D/g, '');
  if (d.length === 0 || d.length > 11) return null;
  d = d.padStart(11, '0'); // o Excel descarta zeros à esquerda; o dígito verificador valida a recomposição
  if (/^(\d)\1{10}$/.test(d)) return null;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : null;
}

function dataValida(a: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Aceita dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa e aaaa-mm-dd. */
export function parseData(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) return dataValida(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  let ano = +m[3]!;
  if (m[3]!.length === 2) ano += ano > 50 ? 1900 : 2000;
  return dataValida(ano, +m[2]!, +m[1]!);
}

/** Dinheiro em centavos. "1.234,56", "R$ 1234,56", "1234.56"; "1.234" é lido como mil duzentos e trinta e quatro. */
export function parseDinheiroCentavos(v: string): number | null {
  let s = v.replace(/R\$|\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Horas semanais: "44", "44,5", "44h", "44:30" (até 60 = horas) ou minutos a partir de 300 (ex.: 2640).
 * Valores entre 61 e 299 são ambíguos e inválidos. Devolve minutos.
 */
export function parseJornadaMin(v: string): number | null {
  const s = v.trim().toLowerCase().replace(/\s/g, '');
  let m = /^(\d{1,3}):(\d{2})$/.exec(s);
  if (m) return +m[2]! < 60 ? +m[1]! * 60 + +m[2]! : null;
  m = /^(\d+(?:[.,]\d+)?)h?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 60) return Math.round(n * 60);
  return n >= 300 ? Math.round(n) : null;
}

export function parseTipoEscala(v: string): '6x1' | '5x2' | '12x36' | 'personalizada' | null {
  const s = v.toLowerCase().replace(/[\s×]/g, '');
  if (['6x1', '5x2', '12x36'].includes(s)) return s as '6x1' | '5x2' | '12x36';
  if (['personalizada', 'outra', 'outro', 'especial', 'variavel', 'variável'].includes(s)) return 'personalizada';
  return null;
}

export function parseEscolaridade(v: string): 'fundamental' | 'medio' | 'superior' | 'pos' | null {
  const s = v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/pos|mestrad|doutorad|especializ|mba/.test(s)) return 'pos';
  if (/superior|graduac|bacharel|licenciat|tecnolog/.test(s)) return /incompleto|cursando/.test(s) ? 'medio' : 'superior';
  if (/medio|2o grau|segundo grau/.test(s)) return 'medio';
  if (/fundamental|1o grau|primeiro grau|alfabetiz/.test(s)) return 'fundamental';
  return null;
}

export function parseTelefone(v: string): string | null {
  let d = v.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

/** Horas (sem heurística de minutos): "20", "20,5", "20h", "20:30". Devolve minutos. */
export function parseHorasMin(v: string): number | null {
  const s = v.trim().toLowerCase().replace(/\s/g, '');
  let m = /^(\d{1,4}):(\d{2})$/.exec(s);
  if (m) return +m[2]! < 60 ? +m[1]! * 60 + +m[2]! : null;
  m = /^(\d+(?:[.,]\d+)?)h?$/.exec(s);
  return m ? Math.round(Number(m[1]!.replace(',', '.')) * 60) : null;
}
