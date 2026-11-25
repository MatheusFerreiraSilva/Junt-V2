import type {
  AllowanceExpense,
  BankImportedTransaction,
  CategoryKeywordRule,
  FinancialOperationRecord,
  HouseholdConfig,
  HouseholdTransaction,
  InstallmentPlan,
  LinkedBankAccount,
  PaidBy,
  SharedAllowanceExpense,
  TransactionBucket,
} from '../types/finance';
import { addCyclesToCycleId, roundMoney } from '../domain/waterfallEngine';
import { getCycleIdFromDate } from './shiftsEngine';
import { categorizeTransaction, DEFAULT_KEYWORD_RULES } from './categorizationEngine';

// =============================================================================
// TIPOS v2.3 — PARSER CSV 100% CLIENT-SIDE & TRIAGEM PROTOCOLO B.4
// =============================================================================

export type StatementMode = 'checking' | 'credit_card';

export type StatementBankPreset =
  | 'auto'
  | 'nubank_conta'
  | 'nubank_cartao'
  | 'itau'
  | 'inter'
  | 'btg'
  | 'bradesco'
  | 'santander'
  | 'generic';

export type TriageDestination =
  | 'house_routine'
  | 'solo_allowance'
  | 'shared_allowance'
  | 'internal';

export type AutoExclusionReason = 'couple_pix' | 'invoice_payment';

export interface DetectedInstallmentInfo {
  currentInstallment: number;
  totalInstallments: number;
  cleanTitle: string;
  draft: InstallmentPlan;
}

export interface StagedCsvTransaction {
  stagingId: string;
  lineNumber: number;
  date: string; // YYYY-MM-DD
  cycleId: string; // YYYY_MM
  description: string;
  normalizedDescription: string;
  amount: number; // Sempre positivo, arredondado em 2 casas
  type: 'expense' | 'income';
  importHash: string;
  isDuplicate: boolean;
  duplicateSource?: 'same_file' | 'transactions' | 'shared_allowance' | 'allowance_expenses' | 'installment_plans' | 'existing_hash';
  autoExcluded: boolean;
  exclusionReason?: AutoExclusionReason;
  exclusionLabel?: string;
  suggestedDestination: TriageDestination;
  suggestedBucket: TransactionBucket;
  installment?: DetectedInstallmentInfo;
  accountLabel: string;
  presetUsed: Exclude<StatementBankPreset, 'auto'>;
}

export interface ImportRejectedItem {
  line: number;
  reason: string;
  rawContent?: string;
}

export interface CsvStatementParseSummary {
  totalRowsRead: number;
  stagedCount: number;
  duplicateCount: number;
  autoExcludedCount: number;
  couplePixExcludedCount: number;
  invoicePaymentExcludedCount: number;
  installmentsDetectedCount: number;
  rejectedCount: number;
}

export interface CsvStatementParseResult {
  staged: StagedCsvTransaction[];
  rejected: ImportRejectedItem[];
  detectedPreset: Exclude<StatementBankPreset, 'auto'>;
  summary: CsvStatementParseSummary;
}

export interface StatementImportReport {
  accepted: BankImportedTransaction[];
  rejected: ImportRejectedItem[];
  totalRowsRead: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
}

// =============================================================================
// DECODIFICAÇÃO UTF-8 / ISO-8859-1 & NORMALIZAÇÃO
// =============================================================================

export function decodeStatementBytes(
  input: string | ArrayBuffer | Uint8Array
): string {
  if (typeof input === 'string') {
    return input.replace(/^\uFEFF/, '');
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      return new TextDecoder('iso-8859-1').decode(bytes).replace(/^\uFEFF/, '');
    }
  }
}

export function normalizeHeaderToken(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeDescriptionForHash(description: string): string {
  return (description || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Pure-JS SHA-256 fallback so deterministic hashing works identically even in minimal runtimes
function sha256HexFallback(asciiInput: string): string {
  const bytes = new TextEncoder().encode(asciiInput);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  const rotr = (v: number, n: number) => (v >>> n) | (v << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Gera importHash determinístico SHA-256 por `(uid, isoDate, amountCents, normalizedDescription)`.
 */
export async function computeImportHash(
  uid: string,
  isoDate: string,
  amount: number,
  description: string
): Promise<string> {
  const safeUid = (uid || 'local').trim();
  const safeDate = (isoDate || '').trim().slice(0, 10);
  const cents = Math.round(Math.abs(amount || 0) * 100);
  const normDesc = normalizeDescriptionForHash(description);
  const payload = `${safeUid}|${safeDate}|${cents}|${normDesc}`;

  if (globalThis.crypto?.subtle?.digest) {
    try {
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(payload)
      );
      return Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0')
      ).join('');
    } catch {
      return sha256HexFallback(payload);
    }
  }
  return sha256HexFallback(payload);
}

/**
 * Coleta todos os importHashes já existentes nos 4 ledgers do Juntô v2.3:
 * `transactions`, `shared_allowance_expenses`, `allowance_expenses` e `installment_plans`.
 */
export async function collectExistingImportHashes(input: {
  uid: string;
  transactions?: Array<Partial<HouseholdTransaction>>;
  sharedAllowanceExpenses?: Array<Partial<SharedAllowanceExpense>>;
  allowanceExpenses?: Array<Partial<AllowanceExpense>>;
  installmentPlans?: Array<Partial<InstallmentPlan>>;
  extraHashes?: Iterable<string>;
}): Promise<{
  hashSet: Set<string>;
  sourceByHash: Map<string, StagedCsvTransaction['duplicateSource']>;
}> {
  const hashSet = new Set<string>();
  const sourceByHash = new Map<string, StagedCsvTransaction['duplicateSource']>();

  const register = (hash: string | null | undefined, source: StagedCsvTransaction['duplicateSource']) => {
    const clean = (hash || '').trim();
    if (!clean) return;
    hashSet.add(clean);
    if (!sourceByHash.has(clean)) {
      sourceByHash.set(clean, source);
    }
  };

  for (const h of input.extraHashes ?? []) {
    register(h, 'existing_hash');
  }

  for (const tx of input.transactions ?? []) {
    if (tx.importHash) register(tx.importHash, 'transactions');
    else if (tx.date && tx.amount && tx.title) {
      register(
        await computeImportHash(input.uid, tx.date, tx.amount, tx.title),
        'transactions'
      );
    }
  }

  for (const shared of input.sharedAllowanceExpenses ?? []) {
    if (shared.importHash) register(shared.importHash, 'shared_allowance');
    else if (shared.date && shared.totalAmount && shared.title) {
      register(
        await computeImportHash(input.uid, shared.date, shared.totalAmount, shared.title),
        'shared_allowance'
      );
    }
  }

  for (const solo of input.allowanceExpenses ?? []) {
    if (solo.importHash) register(solo.importHash, 'allowance_expenses');
    else if (solo.date && solo.amount && solo.title) {
      register(
        await computeImportHash(input.uid, solo.date, solo.amount, solo.title),
        'allowance_expenses'
      );
    }
  }

  for (const plan of input.installmentPlans ?? []) {
    if (plan.importHash) register(plan.importHash, 'installment_plans');
  }

  return { hashSet, sourceByHash };
}

// =============================================================================
// CSV PARSING ENGINE (DELIMITERS, PRESETS, DATAS, MOEDA BR/US, PARCELAS, HIGIENE)
// =============================================================================

function parseCsvRows(text: string, delimiter: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && ch === delimiter) {
      row.push(value);
      value = '';
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      if (row.some((v) => v.trim())) result.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }
  if (quoted) throw new Error('Arquivo CSV contém aspas não fechadas.');
  row.push(value);
  if (row.some((v) => v.trim())) result.push(row);
  return result;
}

function detectDelimiter(sampleLines: string[]): string {
  const candidates = [';', ',', '\t'];
  let best = ';';
  let bestScore = -1;

  for (const delim of candidates) {
    let score = 0;
    for (const line of sampleLines.slice(0, 8)) {
      const count = line.split(delim).length - 1;
      if (count >= 2) score += count;
    }
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return bestScore > 0 ? best : ',';
}

function findHeaderRowIndex(rows: string[][]): number {
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const norm = rows[i].map(normalizeHeaderToken);
    const hasDate = norm.some((h) =>
      ['data', 'date', 'data lancamento', 'data transacao', 'dt', 'data mov'].some((k) =>
        h.includes(k)
      )
    );
    const hasText = norm.some((h) =>
      [
        'descricao',
        'description',
        'historico',
        'titulo',
        'title',
        'lancamento',
        'memo',
        'detalhes',
        'estabelecimento',
      ].some((k) => h.includes(k))
    );
    const hasValue = norm.some((h) =>
      ['valor', 'amount', 'value', 'quantia', 'credito', 'debito'].some(
        (k) => h.includes(k) && !h.includes('saldo')
      )
    );
    if (hasDate && (hasText || hasValue) && rows[i].length >= 2) {
      return i;
    }
  }
  return 0;
}

export function detectCsvPreset(
  normalizedHeaders: string[],
  statementMode: StatementMode
): Exclude<StatementBankPreset, 'auto'> {
  const joined = normalizedHeaders.join('|');
  if (
    normalizedHeaders.includes('date') &&
    normalizedHeaders.includes('title') &&
    normalizedHeaders.includes('amount')
  ) {
    return 'nubank_cartao';
  }
  if (
    normalizedHeaders.includes('identificador') &&
    normalizedHeaders.includes('descricao') &&
    normalizedHeaders.includes('valor')
  ) {
    return 'nubank_conta';
  }
  if (joined.includes('data lancamento') && joined.includes('historico') && joined.includes('saldo')) {
    return 'inter';
  }
  if (joined.includes('credito') && joined.includes('debito')) {
    return 'bradesco';
  }
  if (joined.includes('data') && joined.includes('lancamento') && !joined.includes('historico')) {
    return 'itau';
  }
  if (joined.includes('valor (r$)') && joined.includes('saldo')) {
    return 'santander';
  }
  if (joined.includes('tipo') && joined.includes('descricao') && joined.includes('valor')) {
    return 'btg';
  }
  if (statementMode === 'credit_card' && joined.includes('titulo')) {
    return 'nubank_cartao';
  }
  return 'generic';
}

export function parseCsvDateToIso(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // DD/MM/YYYY or DD-MM-YYYY (with optional time)
  const brFull = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s.*)?$/.exec(trimmed);
  if (brFull) {
    const dd = brFull[1].padStart(2, '0');
    const mm = brFull[2].padStart(2, '0');
    const yyyy = brFull[3];
    const iso = `${yyyy}-${mm}-${dd}`;
    return isValidCivilIsoDate(iso) ? iso : null;
  }

  // DD/MM/YY
  const brShort = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})(?:\s.*)?$/.exec(trimmed);
  if (brShort) {
    const dd = brShort[1].padStart(2, '0');
    const mm = brShort[2].padStart(2, '0');
    const yy = Number(brShort[3]);
    const yyyy = yy <= 79 ? 2000 + yy : 1900 + yy;
    const iso = `${yyyy}-${mm}-${dd}`;
    return isValidCivilIsoDate(iso) ? iso : null;
  }

  // YYYY-MM-DD (with optional ISO time)
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(trimmed);
  if (isoMatch) {
    const iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    return isValidCivilIsoDate(iso) ? iso : null;
  }

  return null;
}

function isValidCivilIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const dateObj = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(dateObj.valueOf()) && dateObj.toISOString().slice(0, 10) === iso;
}

export function parseCsvCurrencyAmount(raw: string): number | null {
  let clean = (raw || '').trim();
  if (!clean || clean === '-' || clean === '--') return null;

  let negative = false;
  if (clean.startsWith('(') && clean.endsWith(')')) {
    negative = true;
    clean = clean.slice(1, -1).trim();
  }
  if (/\bD\b$/i.test(clean) || clean.endsWith('-')) {
    negative = true;
    clean = clean.replace(/(?:\s*\bD\b|-)$/i, '').trim();
  }
  if (/\bC\b$/i.test(clean) || clean.endsWith('+')) {
    clean = clean.replace(/(?:\s*\bC\b|\+)$/i, '').trim();
  }

  clean = clean.replace(/R\$|\u00a0|\s/gi, '');
  if (clean.startsWith('-')) {
    negative = true;
    clean = clean.slice(1);
  } else if (clean.startsWith('+')) {
    clean = clean.slice(1);
  }

  if (!clean) return null;

  const hasComma = clean.includes(',');
  const hasDot = clean.includes('.');

  let numericStr = clean;
  if (hasComma && hasDot) {
    // Decidir pelo último separador encontrado
    const lastComma = clean.lastIndexOf(',');
    const lastDot = clean.lastIndexOf('.');
    if (lastComma > lastDot) {
      numericStr = clean.replace(/\./g, '').replace(',', '.');
    } else {
      numericStr = clean.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Formato BR: "1.250,90" ou "-45,00"
    numericStr = clean.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    // Pode ser "1250.90" (US) ou "1.250" (milhar BR sem decimais)
    const parts = clean.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      // Ambiguidade: se 3 dígitos após ponto e parece milhar ex: 1.500 -> tratar apenas se >1 ponto, senão manter decimal padrão se <= 2 dígitos
      if (parts.length > 2) {
        numericStr = clean.replace(/\./g, '');
      }
    }
  }

  if (!/^\d+(?:\.\d{1,4})?$/.test(numericStr)) {
    return null;
  }

  const parsed = Number(numericStr);
  if (!Number.isFinite(parsed)) return null;
  const signed = negative ? -parsed : parsed;
  return roundMoney(signed);
}

/**
 * Detecta parcelamentos `XX/YY` na descrição e gera rascunho de InstallmentPlan
 * com `startCycleId` e `endCycleId` alinhados ao ciclo atual.
 */
export function detectInstallmentFromDescription(
  description: string,
  amount: number,
  cycleId: string,
  importHash: string
): DetectedInstallmentInfo | undefined {
  const text = (description || '').trim();
  if (!text) return undefined;

  // Evita confundir datas DD/MM ou DD/MM/AAAA com parcelas
  const withoutDates = text.replace(/\b\d{2}\/\d{2}\/\d{2,4}\b/g, ' ');
  const regex =
    /(?:^|[\s\-–(])(?:parc(?:ela)?\.?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})(?=$|[\s\-–)])/gi;

  let matched: RegExpExecArray | null = null;
  for (const m of withoutDates.matchAll(regex)) {
    const curr = Number(m[1]);
    const total = Number(m[2]);
    if (curr >= 1 && total >= 2 && curr <= total && total <= 480) {
      matched = m;
    }
  }

  if (!matched) return undefined;

  const currentInstallment = Number(matched[1]);
  const totalInstallments = Number(matched[2]);

  const cleanTitle = text
    .replace(
      new RegExp(
        `(?:\\s*[-–]?\\s*(?:parc(?:ela)?\\.?\\s*)?0?${currentInstallment}\\s*\\/\\s*0?${totalInstallments})`,
        'i'
      ),
      ''
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–]+$/g, '')
    .trim();

  const startCycleId = addCyclesToCycleId(cycleId, -(currentInstallment - 1));
  const endCycleId = addCyclesToCycleId(cycleId, totalInstallments - currentInstallment);

  return {
    currentInstallment,
    totalInstallments,
    cleanTitle: cleanTitle || text,
    draft: {
      title: cleanTitle || text,
      installmentAmount: roundMoney(Math.abs(amount)),
      currentInstallment,
      totalInstallments,
      startCycleId,
      endCycleId,
      importHash,
    },
  };
}

const INVOICE_PAYMENT_PATTERNS = [
  'PGTO FATURA',
  'PAGTO FATURA',
  'PAGAMENTO FATURA',
  'PAGAMENTO DE FATURA',
  'FATURA PAGA',
  'PAGAMENTO CARTAO',
  'PAGTO CARTAO',
  'PGTO CARTAO',
  'PAGAMENTO RECEBIDO',
  'DEB AUT FATURA',
  'DEBITO AUTOMATICO FATURA',
  'LIQUIDACAO FATURA',
  'FATURA NUBANK',
  'FATURA ITAU',
  'FATURA INTER',
  'FATURA BTG',
  'FATURA BRADESCO',
  'FATURA SANTANDER',
];

function isInvoicePaymentDescription(normalizedUpper: string): boolean {
  return INVOICE_PAYMENT_PATTERNS.some((pattern) =>
    normalizedUpper.includes(pattern)
  );
}

function isCoupleInternalTransfer(
  description: string,
  memberTaxIds: string[] = []
): boolean {
  if (!memberTaxIds || memberTaxIds.length === 0) return false;
  const upperDesc = (description || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const descDigits = description.replace(/\D/g, '');

  for (const taxId of memberTaxIds) {
    const cleanTaxId = (taxId || '').trim();
    if (!cleanTaxId) continue;

    const taxDigits = cleanTaxId.replace(/\D/g, '');
    // Match exact 11-digit CPF or 6+ core digits (masked Nubank/Itaú CPF format ***.456.789-**)
    if (taxDigits.length >= 11) {
      if (descDigits.includes(taxDigits)) {
        return true;
      }
      const coreSix = taxDigits.slice(3, 9);
      if (coreSix.length === 6 && descDigits.includes(coreSix)) {
        return true;
      }
    } else if (taxDigits.length >= 6 && descDigits.includes(taxDigits)) {
      return true;
    }

    const normToken = cleanTaxId
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
    if (normToken.length >= 4 && !/^\d+$/.test(normToken) && upperDesc.includes(normToken)) {
      return true;
    }
  }

  return false;
}

/**
 * Sugere o sub-balde do Protocolo B.4 (Casa & Rotina) a partir da descrição.
 */
export function suggestBucketFromDescription(description: string): TransactionBucket {
  const norm = normalizeDescriptionForHash(description);

  if (
    /\b(aluguel|condominio|iptu|enel|cemig|light|cpfl|copel|celesc|sabesp|cedae|sanepar|comgas|naturgy|internet|vivo fibra|claro net|oi fibra|energia|agua|luz|gas)\b/.test(
      norm
    )
  ) {
    return 'housing';
  }

  if (
    /\b(supermercado|mercado|hipermercado|atacadao|assai|carrefour|pao de acucar|zona sul|hortifruti|sacolao|acougue|padaria|extra mercado|sams club)\b/.test(
      norm
    )
  ) {
    return 'groceries';
  }

  if (
    /\b(netflix|spotify|amazon prime|prime video|disney|hbo|max|youtube|icloud|apple\.com|globoplay|smart fit|smartfit|bluefit|academia|wellhub|gympass|clube)\b/.test(
      norm
    )
  ) {
    return 'fixed_cancelable';
  }

  if (
    /\b(unimed|bradesco saude|sulamerica|amil|plano de saude|seguro|porto seguro|escola|faculdade|creche|mensalidade|inss|das|darf|contador|contabilidade|crm|conselho)\b/.test(
      norm
    )
  ) {
    return 'fixed_essential';
  }

  if (
    /\b(oficina|guincho|chaveiro|pronto socorro|emergencia|conserto|reparo|encanador|eletricista|veterinario)\b/.test(
      norm
    )
  ) {
    return 'buffer';
  }

  return 'routine';
}

export interface ParseCsvStatementV23Input {
  textOrBytes: string | ArrayBuffer | Uint8Array;
  uid: string;
  statementMode: StatementMode;
  preset?: StatementBankPreset;
  accountLabel?: string;
  householdConfig?: Partial<HouseholdConfig>;
  existingHashes?: Iterable<string>;
  existingRecords?: {
    transactions?: Array<Partial<HouseholdTransaction>>;
    sharedAllowanceExpenses?: Array<Partial<SharedAllowanceExpense>>;
    allowanceExpenses?: Array<Partial<AllowanceExpense>>;
    installmentPlans?: Array<Partial<InstallmentPlan>>;
  };
}

/**
 * Parser CSV v2.3 100% Client-Side:
 * - Suporta `;`, `,`, `\t`, BOM, UTF-8 e ISO-8859-1/Windows-1252
 * - Suporta Modo `checking` (Conta Corrente) vs `credit_card` (Fatura Cartão com inversão de sinal)
 * - Suporta presets Nubank, Itaú, Inter, BTG, Bradesco, Santander + genérico
 * - Deduplicação cross-ledger via `importHash` (SHA-256)
 * - Higiene automática (Pix entre o casal via `memberTaxIds` + pagamento de fatura)
 * - Detecção de parcelas `XX/YY`
 */
export async function parseCsvStatementV23(
  input: ParseCsvStatementV23Input
): Promise<CsvStatementParseResult> {
  const decoded = decodeStatementBytes(input.textOrBytes);
  const nonEmptyLines = decoded
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (nonEmptyLines.length === 0) {
    throw new Error('O arquivo CSV está vazio.');
  }

  const delimiter = detectDelimiter(nonEmptyLines);
  const allRows = parseCsvRows(decoded, delimiter);
  const headerIdx = findHeaderRowIndex(allRows);
  const rawHeader = allRows[headerIdx] || [];
  const dataRows = allRows.slice(headerIdx + 1);
  const header = rawHeader.map(normalizeHeaderToken);

  const detectedPreset =
    input.preset && input.preset !== 'auto'
      ? input.preset
      : detectCsvPreset(header, input.statementMode);

  const findIncludes = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h.includes(normalizeHeaderToken(n))));

  const di = findIncludes('data', 'date', 'data lancamento', 'data transacao', 'dt', 'data mov');
  const de = findIncludes(
    'descricao',
    'description',
    'historico',
    'titulo',
    'title',
    'lancamento',
    'memo',
    'detalhes',
    'estabelecimento'
  );
  const secondaryDescIndex = header.findIndex(
    (h, idx) =>
      idx !== de &&
      ['descricao', 'historico', 'detalhes', 'estabelecimento'].some((n) => h.includes(n))
  );

  const saldoIndex = findIncludes('saldo', 'saldo acumulado', 'saldo disponivel');
  const creditColIdx = header.findIndex(
    (h, idx) => idx !== saldoIndex && !h.includes('saldo') && h.includes('credito')
  );
  const debitColIdx = header.findIndex(
    (h, idx) => idx !== saldoIndex && !h.includes('saldo') && h.includes('debito')
  );
  const typeColIdx = findIncludes('tipo', 'type', 'natureza', 'movimentacao');

  const isAmountExact = (h: string) =>
    ['valor', 'amount', 'value', 'quantia', 'valor (r$)', 'valor do lancamento'].some(
      (n) => h === normalizeHeaderToken(n)
    );
  const isAmountMatch = (h: string) =>
    ['valor', 'amount', 'value', 'quantia', 'lancamento'].some((n) =>
      h.includes(normalizeHeaderToken(n))
    );

  let am = header.findIndex(
    (h, idx) => idx !== saldoIndex && !h.includes('saldo') && isAmountExact(h)
  );
  if (am < 0) {
    am = header.findIndex(
      (h, idx) => idx !== saldoIndex && idx !== de && !h.includes('saldo') && isAmountMatch(h)
    );
  }

  const hasSeparateCreditDebit = creditColIdx >= 0 && debitColIdx >= 0;

  if (di < 0 || de < 0 || (am < 0 && !hasSeparateCreditDebit)) {
    throw new Error(
      'CSV precisa conter colunas claras de Data, Descrição (ou Título/Histórico) e Valor (ou Crédito/Débito).'
    );
  }

  if (dataRows.length > 5000) {
    throw new Error('O arquivo excede o limite de 5.000 lançamentos por importação.');
  }

  const { hashSet, sourceByHash } = await collectExistingImportHashes({
    uid: input.uid,
    transactions: input.existingRecords?.transactions,
    sharedAllowanceExpenses: input.existingRecords?.sharedAllowanceExpenses,
    allowanceExpenses: input.existingRecords?.allowanceExpenses,
    installmentPlans: input.existingRecords?.installmentPlans,
    extraHashes: input.existingHashes,
  });

  const seenInFile = new Set<string>();
  const staged: StagedCsvTransaction[] = [];
  const rejected: ImportRejectedItem[] = [];

  const cycleStartDay = input.householdConfig?.cycleStartDay ?? 1;
  const memberTaxIds = input.householdConfig?.memberTaxIds ?? [];
  const accountLabel = (input.accountLabel || detectedPreset).trim();

  let duplicateCount = 0;
  let couplePixExcludedCount = 0;
  let invoicePaymentExcludedCount = 0;
  let installmentsDetectedCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const lineNumber = headerIdx + i + 2;
    const row = dataRows[i];
    const rawDate = (row[di] || '').trim();
    if (!rawDate) {
      rejected.push({ line: lineNumber, reason: 'Linha sem data' });
      continue;
    }

    const isoDate = parseCsvDateToIso(rawDate);
    if (!isoDate) {
      rejected.push({
        line: lineNumber,
        reason: `Data civil inválida: "${rawDate}"`,
        rawContent: row.join(' | '),
      });
      continue;
    }

    const primaryDesc = (row[de] || '').trim();
    const extraDesc = secondaryDescIndex >= 0 ? (row[secondaryDescIndex] || '').trim() : '';
    const description =
      primaryDesc && extraDesc && !primaryDesc.toLowerCase().includes(extraDesc.toLowerCase())
        ? `${primaryDesc} - ${extraDesc}`
        : primaryDesc || extraDesc;

    if (!description) {
      rejected.push({
        line: lineNumber,
        reason: 'Descrição em branco',
        rawContent: row.join(' | '),
      });
      continue;
    }

    let signedAmount: number | null = null;
    if (am >= 0 && (row[am] || '').trim() !== '') {
      signedAmount = parseCsvCurrencyAmount(row[am]);
      if (signedAmount !== null && typeColIdx >= 0) {
        const typeToken = normalizeHeaderToken(row[typeColIdx] || '');
        if (typeToken.includes('debito') || typeToken === 'd' || typeToken.includes('saida')) {
          signedAmount = -Math.abs(signedAmount);
        } else if (
          typeToken.includes('credito') ||
          typeToken === 'c' ||
          typeToken.includes('entrada')
        ) {
          signedAmount = Math.abs(signedAmount);
        }
      }
    } else if (hasSeparateCreditDebit) {
      const creditVal = parseCsvCurrencyAmount(row[creditColIdx] || '');
      const debitVal = parseCsvCurrencyAmount(row[debitColIdx] || '');
      if (creditVal !== null && Math.abs(creditVal) > 0) {
        signedAmount = Math.abs(creditVal);
      } else if (debitVal !== null && Math.abs(debitVal) > 0) {
        signedAmount = -Math.abs(debitVal);
      }
    }

    if (signedAmount === null || signedAmount === 0) {
      rejected.push({
        line: lineNumber,
        reason: `Valor numérico inválido ou zerado`,
        rawContent: row.join(' | '),
      });
      continue;
    }

    const amount = roundMoney(Math.abs(signedAmount));
    // Modo Conta Corrente: negativo = expense, positivo = income
    // Modo Fatura Cartão: positivo = expense, negativo = income (estorno/pagamento)
    const txType: 'expense' | 'income' =
      input.statementMode === 'credit_card'
        ? signedAmount > 0
          ? 'expense'
          : 'income'
        : signedAmount < 0
          ? 'expense'
          : 'income';

    const cycleId = getCycleIdFromDate(isoDate, cycleStartDay);
    const normalizedDescription = normalizeDescriptionForHash(description);
    const importHash = await computeImportHash(input.uid, isoDate, amount, description);

    const isSameFileDup = seenInFile.has(importHash);
    const isExistingDup = hashSet.has(importHash);
    const isDuplicate = isSameFileDup || isExistingDup;
    const duplicateSource = isSameFileDup
      ? 'same_file'
      : isExistingDup
        ? sourceByHash.get(importHash) ?? 'existing_hash'
        : undefined;

    if (isDuplicate) duplicateCount++;
    seenInFile.add(importHash);

    const upperDesc = description
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();

    const isCouplePix = isCoupleInternalTransfer(description, memberTaxIds);
    const isInvoicePay = isInvoicePaymentDescription(upperDesc);

    let autoExcluded = false;
    let exclusionReason: AutoExclusionReason | undefined;
    let exclusionLabel: string | undefined;

    if (isCouplePix) {
      autoExcluded = true;
      exclusionReason = 'couple_pix';
      exclusionLabel = 'Pix entre o casal';
      couplePixExcludedCount++;
    } else if (isInvoicePay) {
      autoExcluded = true;
      exclusionReason = 'invoice_payment';
      exclusionLabel = 'Pagamento de fatura';
      invoicePaymentExcludedCount++;
    }

    const installment =
      txType === 'expense' && !autoExcluded
        ? detectInstallmentFromDescription(description, amount, cycleId, importHash)
        : undefined;

    if (installment) installmentsDetectedCount++;

    const suggestedBucket = suggestBucketFromDescription(description);
    const suggestedDestination: TriageDestination = autoExcluded
      ? 'internal'
      : txType === 'income'
        ? 'internal'
        : 'house_routine';

    staged.push({
      stagingId: `csv-stage-${lineNumber}-${importHash.slice(0, 12)}`,
      lineNumber,
      date: isoDate,
      cycleId,
      description,
      normalizedDescription,
      amount,
      type: txType,
      importHash,
      isDuplicate,
      duplicateSource,
      autoExcluded,
      exclusionReason,
      exclusionLabel,
      suggestedDestination,
      suggestedBucket,
      installment,
      accountLabel,
      presetUsed: detectedPreset,
    });
  }

  return {
    staged,
    rejected,
    detectedPreset,
    summary: {
      totalRowsRead: dataRows.length,
      stagedCount: staged.length,
      duplicateCount,
      autoExcludedCount: couplePixExcludedCount + invoicePaymentExcludedCount,
      couplePixExcludedCount,
      invoicePaymentExcludedCount,
      installmentsDetectedCount,
      rejectedCount: rejected.length,
    },
  };
}

// =============================================================================
// PARSER LEGADO (OFX + BankImportedTransaction) — COMPATIBILIDADE 26B
// =============================================================================

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

export function isOfxContent(text: string): boolean {
  const upper = text.slice(0, 1000).toUpperCase();
  return (
    upper.includes('OFXHEADER') ||
    upper.includes('<OFX>') ||
    upper.includes('<STMTTRN>') ||
    upper.includes('<BANKTRANLIST>')
  );
}

export async function parseOfxStatement(
  text: string,
  account: string,
  owner: PaidBy,
  customRules: CategoryKeywordRule[] = DEFAULT_KEYWORD_RULES
): Promise<StatementImportReport> {
  let rawBlocks: string[] = [];
  const trnRegex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>|<\/OFX>))/gi;
  for (const match of text.matchAll(trnRegex)) {
    if (match[1]) rawBlocks.push(match[1]);
  }

  if (rawBlocks.length === 0 && text.toUpperCase().includes('<STMTTRN>')) {
    const parts = text.split(/<STMTTRN>/i).slice(1);
    rawBlocks = parts.map((p) => {
      const end = p.search(/<STMTTRN>|<\/BANKTRANLIST>|<\/OFX>/i);
      return end > 0 ? p.substring(0, end) : p;
    });
  }

  if (rawBlocks.length === 0) {
    throw new Error(
      'Nenhuma transação encontrada no arquivo OFX. Verifique se o extrato contém o bloco <STMTTRN>.'
    );
  }

  const getTagValue = (block: string, tag: string): string => {
    const re = new RegExp(`<${tag}>([^<\\r\\n]+)(?:<\\/${tag}>)?`, 'i');
    const m = block.match(re);
    return m ? unescapeXml(m[1]) : '';
  };

  const accountClean = normalize(account);
  const accepted: BankImportedTransaction[] = [];
  const rejected: ImportRejectedItem[] = [];
  const seenIds = new Set<string>();
  let duplicateCount = 0;

  for (let i = 0; i < rawBlocks.length; i++) {
    const lineNum = i + 1;
    const block = rawBlocks[i];
    const trnType = getTagValue(block, 'TRNTYPE').toUpperCase();
    const rawDate = getTagValue(block, 'DTPOSTED');
    const rawAmt = getTagValue(block, 'TRNAMT').replace(',', '.');
    const memo = getTagValue(block, 'MEMO');
    const name = getTagValue(block, 'NAME');
    const fitId = getTagValue(block, 'FITID');

    const dateMatch = rawDate.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!dateMatch) {
      rejected.push({
        line: lineNum,
        reason: `Data inválida ou ausente em DTPOSTED: "${rawDate}"`,
        rawContent: memo || name,
      });
      continue;
    }

    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    if (!isValidCivilIsoDate(date)) {
      rejected.push({
        line: lineNum,
        reason: `Data civil inválida no calendário: "${date}"`,
        rawContent: memo || name,
      });
      continue;
    }

    const numAmt = parseFloat(rawAmt);
    if (!Number.isFinite(numAmt) || numAmt === 0) {
      rejected.push({
        line: lineNum,
        reason: 'Valor monetário nulo ou numérico inválido',
        rawContent: memo || name,
      });
      continue;
    }

    const description = memo || name || 'Lançamento bancário';
    const isCreditType = ['CREDIT', 'DEP', 'DIRECTDEP', 'INT', 'DIV'].includes(trnType);
    const isDebitType = ['DEBIT', 'PAYMENT', 'FEE', 'CHECK', 'SRVCHG', 'POS', 'ATM'].includes(trnType);
    let isCredit = isCreditType || numAmt > 0;
    if (isDebitType && numAmt < 0) isCredit = false;

    const absAmount = roundMoney(Math.abs(numAmt));
    const catResult = categorizeTransaction(description, customRules);

    const id = fitId
      ? `ofx:${accountClean}:${normalize(fitId)}`
      : `ofx:${await computeImportHash(accountClean, date, absAmount, `${description}|${numAmt}`)}`;

    if (seenIds.has(id)) {
      duplicateCount++;
      rejected.push({
        line: lineNum,
        reason: `Lançamento duplicado no mesmo arquivo (FITID: ${fitId || id})`,
        rawContent: description,
      });
      continue;
    }

    seenIds.add(id);

    accepted.push({
      id,
      itemId: 'manual',
      accountId: account.trim(),
      bankName: account.trim(),
      amount: absAmount,
      date,
      description,
      direction: isCredit ? 'credit' : 'debit',
      owner,
      status: 'pending',
      category: catResult.category,
      subcategory: catResult.subcategory,
      matchedRule: catResult.matchedKeyword,
      nature: catResult.nature,
      priority: catResult.priority,
      policyMacroGroup: catResult.policyMacroGroup,
      classificationOrigin: catResult.classificationOrigin,
      fitid: fitId || undefined,
    });
  }

  return {
    accepted,
    rejected,
    totalRowsRead: rawBlocks.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    duplicateCount,
  };
}

export async function parseCsvStatement(
  text: string,
  account: string,
  owner: PaidBy,
  customRules: CategoryKeywordRule[] = DEFAULT_KEYWORD_RULES
): Promise<StatementImportReport> {
  const parsed = await parseCsvStatementV23({
    textOrBytes: text,
    uid: normalize(account) || 'conta',
    statementMode: 'checking',
    accountLabel: account.trim(),
  });

  const accepted: BankImportedTransaction[] = parsed.staged
    .filter((item) => !item.isDuplicate)
    .map((item) => {
      const catResult = categorizeTransaction(item.description, customRules);
      return {
        id: `csv:${item.importHash}`,
        itemId: 'manual',
        accountId: account.trim(),
        bankName: account.trim(),
        amount: item.amount,
        date: item.date,
        description: item.description,
        direction: item.type === 'income' ? 'credit' : 'debit',
        owner,
        status: 'pending',
        category: catResult.category,
        subcategory: catResult.subcategory,
        matchedRule: catResult.matchedKeyword,
        nature: catResult.nature,
        priority: catResult.priority,
        policyMacroGroup: catResult.policyMacroGroup,
        classificationOrigin: catResult.classificationOrigin,
      };
    });

  return {
    accepted,
    rejected: parsed.rejected,
    totalRowsRead: parsed.summary.totalRowsRead,
    acceptedCount: accepted.length,
    rejectedCount: parsed.rejected.length,
    duplicateCount: parsed.summary.duplicateCount,
  };
}

export async function parseStatement(
  text: string,
  account: string,
  owner: PaidBy,
  customRules: CategoryKeywordRule[] = DEFAULT_KEYWORD_RULES
): Promise<StatementImportReport> {
  if (!account.trim()) {
    throw new Error('Informe uma identificação para a conta (ex: Nubank, Itaú Personalité, etc.).');
  }

  if (isOfxContent(text)) {
    return parseOfxStatement(text, account, owner, customRules);
  }

  return parseCsvStatement(text, account, owner, customRules);
}

// =========================================================================
// STAGE 26B: INTERNAL TRANSFER PAIR DETECTION & WITHDRAWAL CANDIDATES
// =========================================================================

export interface InternalTransferPairCandidate {
  debitTx: BankImportedTransaction;
  creditTx: BankImportedTransaction;
  amountCents: number;
  daysApart: number;
  reason: string;
}

function diffDaysCivil(a: string, b: string): number {
  const ta = Date.parse(`${a.slice(0, 10)}T12:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 999;
  return Math.round(Math.abs(ta - tb) / 86400000);
}

function resolveCanonicalKey(tx: BankImportedTransaction, accounts: LinkedBankAccount[] = []): string {
  if (tx.canonicalAccountId) return tx.canonicalAccountId;
  const matched = accounts.find((a) => a.id === tx.accountId || a.bankName === tx.bankName);
  return matched?.canonicalAccountId || tx.accountId || tx.bankName || tx.id;
}

export function detectInternalTransferPairs(
  transactions: BankImportedTransaction[],
  accounts: LinkedBankAccount[] = []
): InternalTransferPairCandidate[] {
  const pendingDebits = transactions.filter((t) => t.status === 'pending' && t.direction === 'debit');
  const pendingCredits = transactions.filter((t) => t.status === 'pending' && t.direction === 'credit');
  const pairs: InternalTransferPairCandidate[] = [];
  const usedCredits = new Set<string>();

  for (const debit of pendingDebits) {
    const debitCents = Math.round((debit.amount || 0) * 100);
    if (debitCents <= 0) continue;
    const debitAccKey = resolveCanonicalKey(debit, accounts);

    let bestCredit: BankImportedTransaction | undefined;
    let bestDays = 999;

    for (const credit of pendingCredits) {
      if (usedCredits.has(credit.id)) continue;
      const creditCents = Math.round((credit.amount || 0) * 100);
      if (creditCents !== debitCents) continue;
      const creditAccKey = resolveCanonicalKey(credit, accounts);
      if (debitAccKey === creditAccKey) continue;
      const days = diffDaysCivil(debit.date, credit.date);
      if (days <= 2 && days < bestDays) {
        bestDays = days;
        bestCredit = credit;
      }
    }

    if (bestCredit) {
      usedCredits.add(bestCredit.id);
      pairs.push({
        debitTx: debit,
        creditTx: bestCredit,
        amountCents: debitCents,
        daysApart: bestDays,
        reason: `Saída de R$ ${(debitCents / 100).toFixed(2)} em ${debit.bankName || debit.accountId} compatível com entrada idêntica em ${bestCredit.bankName || bestCredit.accountId} (${bestDays === 0 ? 'mesmo dia' : `${bestDays}d de diferença`}).`,
      });
    }
  }

  return pairs;
}

export interface ReconciliationCandidate {
  operation: FinancialOperationRecord;
  score: number;
  exactNetMatch: boolean;
  withinGrossSpread: boolean;
  daysApart: number;
  differenceCents: number;
  reason: string;
}

export interface ReconciliationCandidateResult {
  candidates: ReconciliationCandidate[];
  ambiguous: boolean;
}

export function findReconciliationCandidates(
  bankTx: BankImportedTransaction,
  operations: FinancialOperationRecord[],
  accounts: LinkedBankAccount[] = []
): ReconciliationCandidateResult {
  if (bankTx.direction !== 'credit') {
    return { candidates: [], ambiguous: false };
  }
  const txCents = Math.round((bankTx.amount || 0) * 100);
  if (txCents <= 0) {
    return { candidates: [], ambiguous: false };
  }
  const txAccKey = resolveCanonicalKey(bankTx, accounts);
  const candidates: ReconciliationCandidate[] = [];

  for (const op of operations) {
    if (op.type !== 'GOAL_WITHDRAWAL') continue;
    if (op.state === 'reverted' || op.state === 'estornado') continue;
    if (op.withdrawalChannel === 'virtual_reallocation') continue;
    if (op.bankTransactionId && op.bankTransactionId !== bankTx.id) continue;

    const grossCents = op.grossAmountCents ?? op.amountCents;
    const netCents = op.netAmountCents ?? op.amountCents;
    const daysApart = diffDaysCivil(bankTx.date, op.date);
    if (daysApart > 10) continue;

    const exactNetMatch = netCents === txCents;
    const exactGrossMatch = grossCents === txCents;
    const spreadCents = grossCents - txCents;
    const withinGrossSpread =
      txCents <= grossCents &&
      grossCents > 0 &&
      spreadCents / grossCents <= 0.2;

    if (!exactNetMatch && !exactGrossMatch && !withinGrossSpread) continue;

    let score = 0;
    if (exactNetMatch) score += 60;
    else if (exactGrossMatch) score += 50;
    else score += 30;

    if (daysApart <= 1) score += 25;
    else if (daysApart <= 3) score += 15;
    else if (daysApart <= 7) score += 5;

    const dstAcc = op.destinationAccountId;
    if (dstAcc && (dstAcc === bankTx.accountId || dstAcc === txAccKey)) {
      score += 20;
    }

    const differenceCents = Math.max(0, grossCents - txCents);
    const reasonParts: string[] = [];
    if (exactNetMatch) reasonParts.push('Valor líquido exato');
    else if (withinGrossSpread) reasonParts.push(`Líquido R$ ${(txCents / 100).toFixed(2)} vs Bruto R$ ${(grossCents / 100).toFixed(2)}`);
    reasonParts.push(daysApart === 0 ? 'mesma data' : `${daysApart}d`);
    if (op.state === 'pending_settlement' || op.state === 'planned') reasonParts.push('em liquidação');

    candidates.push({
      operation: op,
      score,
      exactNetMatch,
      withinGrossSpread,
      daysApart,
      differenceCents,
      reason: reasonParts.join(' · '),
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.daysApart - b.daysApart);
  const topScore = candidates[0]?.score ?? 0;
  const ambiguous = candidates.filter((c) => c.score >= topScore - 5).length > 1;

  return { candidates, ambiguous };
}
