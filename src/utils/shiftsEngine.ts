import {
  HospitalIncomeMappingRule,
  HouseholdConfig,
  IncomeItem,
  MedicalCareerProfile,
  MedicalShift,
  MedicalShiftPreset,
  MedicalShiftRecord,
  MedicalShiftStatusV2,
  ShiftContractType,
  ShiftIncomeAllocation,
  ShiftPacingRecommendation,
  ShiftSector,
} from '../types/finance';
import {
  addCyclesToCycleId,
  calculateCycleLiquidity,
  clampRate,
  resolveHouseholdConfig,
  roundMoney,
} from '../domain/waterfallEngine';
import { formatMonthYear, getNextMonth } from './formatters';

// =============================================================================
// MOTOR UNIFICADO v2.3 DE PLANTÕES MÉDICOS (COMPETÊNCIA vs CAIXA REALIZADO)
// =============================================================================

export function shiftCivilToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Converte uma data civil/ISO (YYYY-MM-DD ou ISO timestamp) para cycleId YYYY_MM,
 * respeitando o dia de virada do ciclo do household (default = 1).
 */
export function getCycleIdFromDate(dateStr: string, cycleStartDay: number = 1): string {
  const clean = (dateStr || '').trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (!match) {
    const today = shiftCivilToday();
    return `${today.slice(0, 4)}_${today.slice(5, 7)}`;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const baseCycleId = `${year}_${String(month).padStart(2, '0')}`;
  if (cycleStartDay > 1 && day < cycleStartDay) {
    return addCyclesToCycleId(baseCycleId, -1);
  }
  return baseCycleId;
}

/**
 * Calcula o valor líquido do plantão descontando a reserva de imposto PJ/RPA configurada.
 * Na graduação (taxRate = 0), líquido === bruto.
 */
export function calculateShiftNetAmount(
  grossAmount: number,
  taxReserveRate: number = 0
): number {
  const safeGross = Math.max(0, Number.isFinite(grossAmount) ? grossAmount : 0);
  const safeRate = clampRate(taxReserveRate, 0, 1);
  return roundMoney(safeGross * (1 - safeRate));
}

export interface CreateMedicalShiftInput {
  id?: string;
  doctorUid: string;
  institution: string;
  shiftDate: string;
  hours: number;
  grossAmount: number;
  taxReserveRate?: number;
  netAmount?: number;
  status?: MedicalShiftStatusV2;
  expectedPayDate?: string;
  delayDays?: number;
  paidAt?: string | null;
}

/**
 * Cria um registro canônico MedicalShiftRecord respeitando o ciclo de vida:
 * "scheduled" (Agendado) -> "pending_payment" (Realizado / A Receber) -> "paid" (Pago).
 */
export function createMedicalShiftRecord(
  input: CreateMedicalShiftInput,
  defaultShiftTaxRate: number = 0
): MedicalShiftRecord {
  const institution = (input.institution || '').trim();
  if (!institution) {
    throw new Error('Informe o hospital ou instituição do plantão.');
  }
  if (!input.doctorUid?.trim()) {
    throw new Error('Informe o médico responsável pelo plantão.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.shiftDate)) {
    throw new Error('Data do plantão inválida. Use o formato YYYY-MM-DD.');
  }
  if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 72) {
    throw new Error('A duração do plantão deve estar entre 1 e 72 horas.');
  }
  if (!Number.isFinite(input.grossAmount) || input.grossAmount <= 0) {
    throw new Error('O valor bruto do plantão deve ser maior que zero.');
  }

  const grossAmount = roundMoney(input.grossAmount);
  const taxRate = clampRate(input.taxReserveRate ?? defaultShiftTaxRate);
  const computedNet =
    input.netAmount !== undefined && Number.isFinite(input.netAmount)
      ? Math.min(grossAmount, Math.max(0.01, roundMoney(input.netAmount)))
      : Math.max(0.01, calculateShiftNetAmount(grossAmount, taxRate));

  const status: MedicalShiftStatusV2 = input.status ?? 'scheduled';
  const expectedPayDate =
    input.expectedPayDate && /^\d{4}-\d{2}-\d{2}$/.test(input.expectedPayDate)
      ? input.expectedPayDate
      : calculateEstimatedPayDate(input.shiftDate, input.delayDays ?? 30);

  let paidAt: string | null | undefined = null;
  if (status === 'paid') {
    paidAt =
      input.paidAt && /^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)
        ? input.paidAt
        : expectedPayDate;
  }

  return {
    ...(input.id ? { id: input.id } : {}),
    doctorUid: input.doctorUid.trim(),
    institution,
    shiftDate: input.shiftDate,
    hours: roundMoney(input.hours),
    grossAmount,
    netAmount: computedNet,
    status,
    expectedPayDate,
    paidAt,
  };
}

/**
 * Executa transição estrita de status do plantão separando competência de caixa.
 */
export function transitionShiftStatus(
  shift: MedicalShiftRecord,
  nextStatus: MedicalShiftStatusV2,
  paidAt?: string
): MedicalShiftRecord {
  if (nextStatus === 'paid') {
    const resolvedPaidAt =
      paidAt && /^\d{4}-\d{2}-\d{2}$/.test(paidAt)
        ? paidAt
        : shiftCivilToday();
    return {
      ...shift,
      status: 'paid',
      paidAt: resolvedPaidAt,
    };
  }

  return {
    ...shift,
    status: nextStatus,
    paidAt: null,
  };
}

export interface CycleShiftsSummary {
  cycleId: string;
  paidShifts: MedicalShiftRecord[];
  receivableShifts: MedicalShiftRecord[];
  scheduledShifts: MedicalShiftRecord[];
  pendingPaymentShifts: MedicalShiftRecord[];
  paidShiftsNetTotal: number;
  receivableShiftsNetTotal: number;
  scheduledShiftsNetTotal: number;
  pendingPaymentShiftsNetTotal: number;
  paidCount: number;
  scheduledCount: number;
  pendingPaymentCount: number;
  workedHoursInCycle: number;
  scheduledHoursInCycle: number;
  averageNetPerHour: number;
}

/**
 * Conecta plantões diretamente ao waterfallEngine.calculateCycleLiquidity:
 * - Apenas plantões `status === "paid"` cuja data de recebimento (`paidAt`) cai em `cycleId`
 *   entram em `paidShiftsNetTotal` (e consequentemente em `newNetIncome`).
 * - Plantões `scheduled` e `pending_payment` são somados à parte em `receivableShiftsNetTotal`
 *   e NUNCA inflam o caixa nem o teto de parcelas.
 */
export function summarizeShiftsForCycle(
  shifts: MedicalShiftRecord[],
  cycleId: string,
  householdConfig?: Partial<HouseholdConfig>
): CycleShiftsSummary {
  const config = resolveHouseholdConfig(householdConfig);
  const startDay = config.cycleStartDay;

  const paidShifts: MedicalShiftRecord[] = [];
  const scheduledShifts: MedicalShiftRecord[] = [];
  const pendingPaymentShifts: MedicalShiftRecord[] = [];

  let workedHoursInCycle = 0;
  let scheduledHoursInCycle = 0;
  let workedNetForHourly = 0;

  for (const shift of shifts) {
    if (!shift) continue;
    const shiftCompetenceCycle = getCycleIdFromDate(shift.shiftDate, startDay);
    const shiftCashCycle = shift.paidAt
      ? getCycleIdFromDate(shift.paidAt, startDay)
      : getCycleIdFromDate(shift.expectedPayDate, startDay);

    if (shift.status === 'paid') {
      if (shiftCashCycle === cycleId) {
        paidShifts.push(shift);
      }
      if (shiftCompetenceCycle === cycleId) {
        workedHoursInCycle += shift.hours || 0;
        workedNetForHourly += shift.netAmount || 0;
      }
    } else if (shift.status === 'pending_payment') {
      pendingPaymentShifts.push(shift);
      if (shiftCompetenceCycle === cycleId) {
        workedHoursInCycle += shift.hours || 0;
        workedNetForHourly += shift.netAmount || 0;
      }
    } else if (shift.status === 'scheduled') {
      scheduledShifts.push(shift);
      if (shiftCompetenceCycle === cycleId) {
        scheduledHoursInCycle += shift.hours || 0;
      }
    }
  }

  const receivableShifts = [...pendingPaymentShifts, ...scheduledShifts];

  const liquidity = calculateCycleLiquidity({
    shifts: [...paidShifts, ...receivableShifts],
    defaultShiftTaxRate: config.defaultShiftTaxRate,
  });

  const averageNetPerHour =
    workedHoursInCycle > 0 ? roundMoney(workedNetForHourly / workedHoursInCycle) : 0;

  return {
    cycleId,
    paidShifts,
    receivableShifts,
    scheduledShifts,
    pendingPaymentShifts,
    paidShiftsNetTotal: liquidity.paidShiftsNetTotal,
    receivableShiftsNetTotal: liquidity.receivableShiftsTotal,
    scheduledShiftsNetTotal: liquidity.scheduledShiftsTotal,
    pendingPaymentShiftsNetTotal: liquidity.pendingPaymentShiftsTotal,
    paidCount: paidShifts.length,
    scheduledCount: scheduledShifts.length,
    pendingPaymentCount: pendingPaymentShifts.length,
    workedHoursInCycle: roundMoney(workedHoursInCycle),
    scheduledHoursInCycle: roundMoney(scheduledHoursInCycle),
    averageNetPerHour,
  };
}

export interface ShiftCreditMatchCandidate {
  shift: MedicalShiftRecord;
  score: number;
  exactAmountMatch: boolean;
  institutionMatch: boolean;
  reason: string;
}

export interface ShiftCreditMatchResult {
  exactMatch: MedicalShiftRecord | null;
  candidates: ShiftCreditMatchCandidate[];
}

function normalizeTextForMatch(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

/**
 * Encontra plantões com status `pending_payment` compatíveis com um crédito do extrato CSV
 * para oferecer vinculação em 1 clique ("Vincular ao Plantão X e marcar como Pago").
 */
export function findMatchingShiftForCredit(
  credit: { amount: number; description: string; date: string; doctorUid?: string },
  shifts: MedicalShiftRecord[]
): ShiftCreditMatchResult {
  const creditAmount = roundMoney(Math.abs(credit.amount || 0));
  if (creditAmount <= 0) {
    return { exactMatch: null, candidates: [] };
  }

  const descNorm = normalizeTextForMatch(credit.description);
  const candidates: ShiftCreditMatchCandidate[] = [];

  for (const shift of shifts) {
    if (!shift || shift.status !== 'pending_payment') continue;
    if (credit.doctorUid && shift.doctorUid && credit.doctorUid !== shift.doctorUid) {
      continue;
    }

    const net = roundMoney(shift.netAmount || shift.grossAmount);
    const gross = roundMoney(shift.grossAmount);
    const diffNet = Math.abs(creditAmount - net);
    const diffGross = Math.abs(creditAmount - gross);
    const minDiff = Math.min(diffNet, diffGross);

    const exactAmountMatch = minDiff <= 0.05;
    const closeAmountMatch = minDiff <= Math.max(50, net * 0.08);

    const instTokens = normalizeTextForMatch(shift.institution)
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !['HOSPITAL', 'UPA', 'CLINICA', 'MEDICO'].includes(t));
    const institutionMatch =
      instTokens.length > 0 && instTokens.some((tok) => descNorm.includes(tok));

    if (!closeAmountMatch && !institutionMatch) continue;

    let score = 0;
    if (exactAmountMatch) score += 60;
    else if (closeAmountMatch) score += 30;
    if (institutionMatch) score += 35;
    if (credit.date >= shift.shiftDate) score += 5;

    const reasons: string[] = [];
    if (exactAmountMatch) reasons.push('Valor líquido exato');
    else if (closeAmountMatch) reasons.push(`Valor próximo (diferença R$ ${minDiff.toFixed(2)})`);
    if (institutionMatch) reasons.push('Instituição compatível');

    candidates.push({
      shift,
      score,
      exactAmountMatch,
      institutionMatch,
      reason: reasons.join(' · ') || 'Plantão a receber',
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const exactMatch = top && (top.exactAmountMatch || top.score >= 60) ? top.shift : null;

  return { exactMatch, candidates };
}

// =============================================================================
// ADAPTADORES DE TRANSIÇÃO LEGADA (Etapa 4 migrará MedicalShiftsScreen completa)
// =============================================================================

export function isActiveShift(shift: MedicalShift): boolean {
  return shift.executionStatus !== 'cancelled' && shift.executionStatus !== 'replaced';
}

export function isPerformedShift(shift: MedicalShift): boolean {
  return (
    isActiveShift(shift) &&
    shift.executionStatus !== 'scheduled' &&
    shift.dateWorked <= shiftCivilToday()
  );
}

export const SECTOR_CONFIG: Record<
  ShiftSector,
  { label: string; emoji: string; bgClass: string; textClass: string; borderClass: string }
> = {
  porta: {
    label: 'Porta de Emergência (UPA/CER)',
    emoji: '🚪',
    bgClass: 'bg-amber-500/10 dark:bg-amber-950/40',
    textClass: 'text-amber-800 dark:text-amber-300',
    borderClass: 'border-amber-300 dark:border-amber-800',
  },
  vermelha: {
    label: 'Sala Vermelha / Reanimação',
    emoji: '🚨',
    bgClass: 'bg-rose-500/10 dark:bg-rose-950/40',
    textClass: 'text-rose-800 dark:text-rose-300',
    borderClass: 'border-rose-300 dark:border-rose-800',
  },
  uti: {
    label: 'Terapia Intensiva (UTI)',
    emoji: '🫀',
    bgClass: 'bg-blue-500/10 dark:bg-blue-950/40',
    textClass: 'text-blue-800 dark:text-blue-300',
    borderClass: 'border-blue-300 dark:border-blue-800',
  },
  enfermaria: {
    label: 'Enfermaria / Pareceres',
    emoji: '📋',
    bgClass: 'bg-purple-500/10 dark:bg-purple-950/40',
    textClass: 'text-purple-800 dark:text-purple-300',
    borderClass: 'border-purple-300 dark:border-purple-800',
  },
  sobreaviso: {
    label: 'Sobreaviso de Especialidade',
    emoji: '📞',
    bgClass: 'bg-emerald-500/10 dark:bg-emerald-950/40',
    textClass: 'text-emerald-800 dark:text-emerald-300',
    borderClass: 'border-emerald-300 dark:border-emerald-800',
  },
  evento: {
    label: 'Cobertura de Eventos & Shows',
    emoji: '🎪',
    bgClass: 'bg-sky-500/10 dark:bg-sky-950/40',
    textClass: 'text-sky-800 dark:text-sky-300',
    borderClass: 'border-sky-300 dark:border-sky-800',
  },
  outro: {
    label: 'Outro Setor',
    emoji: '🩺',
    bgClass: 'bg-slate-500/10 dark:bg-slate-800',
    textClass: 'text-slate-800 dark:text-slate-200',
    borderClass: 'border-slate-300 dark:border-slate-700',
  },
};

export const CONTRACT_CONFIG: Record<
  ShiftContractType,
  { label: string; short: string; delayHint: string; typicalDays: number }
> = {
  clt: {
    label: 'CLT (Concurso / RioSaúde / EBSERH)',
    short: 'CLT (D+5)',
    delayHint: 'Recebe no 5º dia útil do mês seguinte',
    typicalDays: 5,
  },
  pj_privado: {
    label: "Pessoa Jurídica (Rede Privada D'Or / Unimed)",
    short: 'PJ Privado (D+30)',
    delayHint: 'Pagamento 30 a 60 dias após fechamento da escala',
    typicalDays: 30,
  },
  pj_oss: {
    label: 'Pessoa Jurídica (UPAs e Hospitais via OSS)',
    short: 'PJ OSS (D+60)',
    delayHint: 'Pagamento 60 a 90+ dias com risco de atrasos públicos',
    typicalDays: 60,
  },
  evento: {
    label: 'Plantão Avulso em Eventos / Shows',
    short: 'Evento (Imediato a 15d)',
    delayHint: 'PIX no término ou em até 15 dias',
    typicalDays: 7,
  },
  outro: {
    label: 'Outro Regime',
    short: 'Outro',
    delayHint: 'Data personalizada',
    typicalDays: 30,
  },
};

export const DEFAULT_SHIFT_PRESETS: MedicalShiftPreset[] = [
  {
    id: 'preset-upa-porta',
    name: 'Porta UPA 12h (OSS D+60)',
    hospitalName: 'UPA 24h Tijuca / OSS',
    sector: 'porta',
    contractType: 'pj_oss',
    defaultDurationHours: 12,
    defaultGrossAmount: 1350,
    typicalPayDelayDays: 60,
  },
  {
    id: 'preset-vermelha-upa',
    name: 'Sala Vermelha 12h (OSS D+60)',
    hospitalName: 'UPA 24h Engenho de Dentro',
    sector: 'vermelha',
    contractType: 'pj_oss',
    defaultDurationHours: 12,
    defaultGrossAmount: 1650,
    typicalPayDelayDays: 60,
  },
  {
    id: 'preset-dor-uti',
    name: "UTI Geral Copa D'Or 12h (PJ D+30)",
    hospitalName: "Hospital Copa D'Or",
    sector: 'uti',
    contractType: 'pj_privado',
    defaultDurationHours: 12,
    defaultGrossAmount: 1950,
    typicalPayDelayDays: 30,
  },
  {
    id: 'preset-riosaude-clt',
    name: 'RioSaúde CER 12h (CLT D+5)',
    hospitalName: 'RioSaúde - CER Campo Grande',
    sector: 'porta',
    contractType: 'clt',
    defaultDurationHours: 12,
    defaultGrossAmount: 1500,
    typicalPayDelayDays: 5,
  },
  {
    id: 'preset-evento-show',
    name: 'Cobertura de Show / Evento (PIX 7d)',
    hospitalName: 'Eventos & Festivais RJ',
    sector: 'evento',
    contractType: 'evento',
    defaultDurationHours: 12,
    defaultGrossAmount: 1400,
    typicalPayDelayDays: 7,
  },
  {
    id: 'preset-enfermaria-visita',
    name: 'Visita de Enfermaria 6h (PJ D+30)',
    hospitalName: "Hospital Quinta D'Or",
    sector: 'enfermaria',
    contractType: 'pj_privado',
    defaultDurationHours: 6,
    defaultGrossAmount: 850,
    typicalPayDelayDays: 30,
  },
];

export const DEFAULT_HOSPITAL_MAPPING_RULES: HospitalIncomeMappingRule[] = [
  {
    id: 'rule-hosp-1',
    hospitalName: "Hospital Copa D'Or",
    keywordPattern: "D'OR",
    createdAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'rule-hosp-2',
    hospitalName: 'UPA 24h Tijuca / OSS',
    keywordPattern: 'VIVA RIO',
    createdAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'rule-hosp-3',
    hospitalName: 'RioSaúde - CER Campo Grande',
    keywordPattern: 'RIOSAUDE',
    createdAt: '2026-10-01T00:00:00Z',
  },
];

export function calculateEstimatedPayDate(workedDateStr: string, delayDays: number): string {
  const [year, month, day] = workedDateStr.split('-').map(Number);
  const worked = new Date(year, month - 1, day);
  worked.setDate(worked.getDate() + delayDays);

  const y = worked.getFullYear();
  const m = String(worked.getMonth() + 1).padStart(2, '0');
  const d = String(worked.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface ShiftBalance {
  expectedAmount: number;
  receivedAmount: number;
  pendingAmount: number;
  overallocatedAmount: number;
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
  isOverallocated: boolean;
}

export function getShiftExpectedAmount(shift: MedicalShift): number {
  return shift.netAmount !== undefined ? shift.netAmount : shift.grossAmount ?? 0;
}

export function getShiftBalance(
  shift: MedicalShift,
  ledgers: ShiftIncomeAllocation[] = []
): ShiftBalance {
  const expected = getShiftExpectedAmount(shift);
  const expectedCents = Math.round(expected * 100);

  const allocatedCents = ledgers.reduce((sum, ledger) => {
    return sum + (ledger.allocations[shift.id] || 0);
  }, 0);

  let receivedCents = allocatedCents;
  if (receivedCents === 0 && shift.status === 'received' && isPerformedShift(shift)) {
    receivedCents = expectedCents;
  }

  const receivedAmount = receivedCents / 100;
  const pendingAmount = Math.max(0, (expectedCents - receivedCents) / 100);
  const overallocatedAmount = Math.max(0, (receivedCents - expectedCents) / 100);

  const isFullyPaid =
    (receivedCents >= expectedCents && expectedCents > 0) ||
    (expectedCents === 0 && isPerformedShift(shift));
  const isPartiallyPaid = receivedCents > 0 && receivedCents < expectedCents;
  const isOverallocated = receivedCents > expectedCents;

  return {
    expectedAmount: expected,
    receivedAmount,
    pendingAmount,
    overallocatedAmount,
    isFullyPaid,
    isPartiallyPaid,
    isOverallocated,
  };
}

export interface ShiftTimeWindow {
  start: Date;
  end: Date;
  crossesMidnight: boolean;
  hasExactTimes: boolean;
}

export function getShiftTimeWindow(
  shift: MedicalShift,
  includeCommute: boolean = false
): ShiftTimeWindow | null {
  if (!shift.dateWorked) return null;

  const hasTimes = Boolean(shift.startTime && shift.endTime);
  if (!hasTimes) {
    const [y, m, d] = shift.dateWorked.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
    return {
      start,
      end,
      crossesMidnight: false,
      hasExactTimes: false,
    };
  }

  const [y, m, d] = shift.dateWorked.split('-').map(Number);
  const [startH, startM] = (shift.startTime || '07:00').split(':').map(Number);
  const [endH, endM] = (shift.endTime || '19:00').split(':').map(Number);

  const start = new Date(Date.UTC(y, m - 1, d, startH, startM, 0));
  let end = new Date(Date.UTC(y, m - 1, d, endH, endM, 0));

  let crossesMidnight = false;
  if (end <= start) {
    end = new Date(Date.UTC(y, m - 1, d + 1, endH, endM, 0));
    crossesMidnight = true;
  }

  if (includeCommute && shift.commuteMinutes && shift.commuteMinutes > 0) {
    start.setMinutes(start.getMinutes() - shift.commuteMinutes);
    end.setMinutes(end.getMinutes() + shift.commuteMinutes);
  }

  return {
    start,
    end,
    crossesMidnight,
    hasExactTimes: true,
  };
}

export interface ShiftOverlapResult {
  overlaps: boolean;
  reason?: string;
  overlappingShift?: MedicalShift;
}

export function checkShiftOverlap(
  shiftA: MedicalShift,
  shiftB: MedicalShift,
  includeCommute: boolean = true
): ShiftOverlapResult {
  if (shiftA.id === shiftB.id) return { overlaps: false };
  if (shiftA.partner !== shiftB.partner) return { overlaps: false };
  if (!isActiveShift(shiftA) || !isActiveShift(shiftB)) return { overlaps: false };

  const windowA = getShiftTimeWindow(shiftA, includeCommute);
  const windowB = getShiftTimeWindow(shiftB, includeCommute);

  if (!windowA || !windowB) return { overlaps: false };

  if (windowA.hasExactTimes && windowB.hasExactTimes) {
    const isOverlapping = windowA.start < windowB.end && windowB.start < windowA.end;
    if (isOverlapping) {
      const commuteMsg =
        includeCommute && (shiftA.commuteMinutes || shiftB.commuteMinutes)
          ? ' (com deslocamento)'
          : '';
      return {
        overlaps: true,
        reason: `Conflito de horário com o plantão "${shiftB.title}" no ${shiftB.hospitalName}${commuteMsg}.`,
        overlappingShift: shiftB,
      };
    }
    return { overlaps: false };
  }

  if (shiftA.dateWorked === shiftB.dateWorked) {
    return {
      overlaps: true,
      reason: `Possível sobreposição na mesma data (${shiftA.dateWorked}) com o plantão "${shiftB.title}".`,
      overlappingShift: shiftB,
    };
  }

  return { overlaps: false };
}

export interface ShiftMetricsSummary {
  totalHours: number;
  totalGross: number;
  totalReceived: number;
  totalPending: number;
  totalOverdue: number;
  totalOverallocated: number;
  shiftsCount: number;
  receivedCount: number;
  pendingCount: number;
  overdueCount: number;
  averageRatePerHour: number;
}

export function calculateShiftMetrics(
  shifts: MedicalShift[],
  monthKey: string,
  partnerFilter?: 'partner1' | 'partner2' | 'both',
  shiftIncomeAllocations: ShiftIncomeAllocation[] = []
): ShiftMetricsSummary {
  const todayStr = shiftCivilToday();

  const filtered = shifts.filter((s) => {
    const isPartner =
      !partnerFilter || partnerFilter === 'both' || s.partner === partnerFilter;
    const isMonth =
      s.dateWorked.startsWith(monthKey) || s.estimatedPayDate.startsWith(monthKey);
    return isPartner && isMonth && isActiveShift(s);
  });

  let totalHours = 0;
  let totalGross = 0;
  let totalReceived = 0;
  let totalPending = 0;
  let totalOverdue = 0;
  let totalOverallocated = 0;
  let receivedCount = 0;
  let pendingCount = 0;
  let overdueCount = 0;

  filtered.forEach((shift) => {
    if (isPerformedShift(shift)) {
      totalHours += shift.durationHours || 0;
      totalGross += shift.grossAmount || 0;
    }

    const isOverdue =
      shift.status === 'overdue' ||
      (shift.status === 'pending' && shift.estimatedPayDate < todayStr);

    const balance = getShiftBalance(shift, shiftIncomeAllocations);

    if (isPerformedShift(shift)) {
      totalReceived += balance.receivedAmount;
      totalOverallocated += balance.overallocatedAmount;

      if (balance.isFullyPaid) {
        receivedCount++;
      } else {
        totalPending += balance.pendingAmount;
        pendingCount++;
        if (isOverdue) {
          totalOverdue += balance.pendingAmount;
          overdueCount++;
        }
      }
    } else {
      totalPending += balance.pendingAmount;
      pendingCount++;
      if (isOverdue) {
        totalOverdue += balance.pendingAmount;
        overdueCount++;
      }
    }
  });

  const averageRatePerHour = totalHours > 0 ? Math.round(totalGross / totalHours) : 0;

  return {
    totalHours,
    totalGross,
    totalReceived,
    totalPending,
    totalOverdue,
    totalOverallocated,
    shiftsCount: filtered.length,
    receivedCount,
    pendingCount,
    overdueCount,
    averageRatePerHour,
  };
}

export interface HourlyEfficiencyRank {
  key: string;
  label: string;
  sector: ShiftSector;
  hospitalName: string;
  totalHours: number;
  totalEarned: number;
  ratePerHour: number;
  shiftsCount: number;
  badge: string;
}

export function calculateHourlyYieldRanking(shifts: MedicalShift[]): HourlyEfficiencyRank[] {
  const groups: Record<
    string,
    {
      sector: ShiftSector;
      hospitalName: string;
      totalHours: number;
      totalEarned: number;
      shiftsCount: number;
    }
  > = {};

  shifts.filter(isPerformedShift).forEach((s) => {
    const key = `${s.hospitalName}-${s.sector}`;
    if (!groups[key]) {
      groups[key] = {
        sector: s.sector,
        hospitalName: s.hospitalName,
        totalHours: 0,
        totalEarned: 0,
        shiftsCount: 0,
      };
    }
    groups[key].totalHours += s.durationHours || 12;
    groups[key].totalEarned += s.grossAmount || 0;
    groups[key].shiftsCount += 1;
  });

  const list: HourlyEfficiencyRank[] = Object.entries(groups).map(([key, data]) => {
    const ratePerHour =
      data.totalHours > 0 ? Math.round(data.totalEarned / data.totalHours) : 0;
    const sectorConf = SECTOR_CONFIG[data.sector];

    let badge = 'Padrão';
    if (ratePerHour >= 160) badge = '🌟 Alta Eficiência';
    else if (ratePerHour >= 130) badge = '⚡ Boa Rentabilidade';
    else if (ratePerHour < 100) badge = '⚠️ Baixo Retorno/h';

    return {
      key,
      label: `${sectorConf.emoji} ${data.hospitalName}`,
      sector: data.sector,
      hospitalName: data.hospitalName,
      totalHours: data.totalHours,
      totalEarned: data.totalEarned,
      ratePerHour,
      shiftsCount: data.shiftsCount,
      badge,
    };
  });

  return list.sort((a, b) => b.ratePerHour - a.ratePerHour);
}

export interface PacingContext {
  partnerFilter?: 'partner1' | 'partner2' | 'both';
  partner1Career?: MedicalCareerProfile;
  partner2Career?: MedicalCareerProfile;
  allowResidencyExtraShifts?: boolean;
}

export function calculateShiftRecommendations(
  projectedAmount: number,
  fixedExpensesAmount: number,
  averageIncomeTarget: number,
  averageShiftValue: number,
  monthKey: string,
  monthLabel: string,
  context?: PacingContext
): ShiftPacingRecommendation {
  const safeShiftValue =
    Number.isFinite(averageShiftValue) && averageShiftValue > 0 ? averageShiftValue : 0;
  const isDryMonth = projectedAmount < fixedExpensesAmount;

  const isStudent = (career?: MedicalCareerProfile) =>
    career?.stage === 'graduacao' || career?.stage === 'internato';
  const isResidency = (career?: MedicalCareerProfile) => career?.stage === 'residencia';

  let disallowExtraShifts = false;
  if (context?.partnerFilter === 'partner1') {
    if (isStudent(context.partner1Career)) {
      disallowExtraShifts = true;
    } else if (
      isResidency(context.partner1Career) &&
      !context.allowResidencyExtraShifts
    ) {
      disallowExtraShifts = true;
    }
  } else if (context?.partnerFilter === 'partner2') {
    if (isStudent(context.partner2Career)) {
      disallowExtraShifts = true;
    } else if (
      isResidency(context.partner2Career) &&
      !context.allowResidencyExtraShifts
    ) {
      disallowExtraShifts = true;
    }
  } else {
    const p1Student = isStudent(context?.partner1Career);
    const p2Student = isStudent(context?.partner2Career);
    const p1Res = isResidency(context?.partner1Career);
    const p2Res = isResidency(context?.partner2Career);

    if (p1Student && p2Student) {
      disallowExtraShifts = true;
    } else if (
      (p1Student || (p1Res && !context?.allowResidencyExtraShifts)) &&
      (p2Student || (p2Res && !context?.allowResidencyExtraShifts))
    ) {
      disallowExtraShifts = true;
    }
  }

  const gapToFixed = Math.max(0, fixedExpensesAmount - projectedAmount);
  const shiftsToCoverFixed =
    !disallowExtraShifts && gapToFixed > 0 && safeShiftValue > 0
      ? Math.ceil(gapToFixed / safeShiftValue)
      : 0;

  const gapToLifestyle = Math.max(0, averageIncomeTarget - projectedAmount);
  const shiftsToMaintainLifestyle =
    !disallowExtraShifts && gapToLifestyle > 0 && safeShiftValue > 0
      ? Math.ceil(gapToLifestyle / safeShiftValue)
      : 0;

  const accelerateTarget = Math.round(averageIncomeTarget * 1.2);
  const gapToAccelerate = Math.max(0, accelerateTarget - projectedAmount);
  const shiftsToAccelerateGains =
    !disallowExtraShifts && gapToAccelerate > 0 && safeShiftValue > 0
      ? Math.ceil(gapToAccelerate / safeShiftValue)
      : 0;

  return {
    monthKey,
    monthLabel,
    projectedAmount,
    fixedExpensesAmount,
    averageIncomeTarget,
    averageShiftValue: safeShiftValue,
    isDryMonth,
    shiftsToCoverFixed,
    shiftsToMaintainLifestyle,
    shiftsToAccelerateGains,
  };
}

export interface CashFlowMonthProjection {
  monthKey: string;
  monthLabel: string;
  projectedIncome: number;
  alreadyReceived: number;
  fixedExpenses: number;
  coverageRatio: number;
  shifts: MedicalShift[];
  recommendation: ShiftPacingRecommendation;
}

export function projectCashFlowTimeline(
  shifts: MedicalShift[],
  fixedExpenses: number,
  averageIncome: number,
  startMonthKey: string,
  monthsAhead: number = 4,
  shiftIncomeAllocations: ShiftIncomeAllocation[] = [],
  context?: PacingContext
): CashFlowMonthProjection[] {
  const timeline: CashFlowMonthProjection[] = [];
  const safeFixed = Number.isFinite(fixedExpenses) ? Math.max(0, fixedExpenses) : 0;
  const safeAvgIncome = Number.isFinite(averageIncome) ? Math.max(0, averageIncome) : 0;

  const validShifts = shifts.filter((s) => isPerformedShift(s) && s.grossAmount > 0);
  const avgShiftValue =
    validShifts.length > 0
      ? Math.round(
          validShifts.reduce((s, it) => s + it.grossAmount, 0) / validShifts.length
        )
      : 0;

  let currentKey = startMonthKey;

  for (let i = 0; i < monthsAhead; i++) {
    const monthShifts = shifts.filter(
      (s) =>
        isActiveShift(s) &&
        s.estimatedPayDate &&
        s.estimatedPayDate.startsWith(currentKey)
    );
    const projectedIncome = monthShifts.reduce((s, it) => s + (it.grossAmount || 0), 0);
    const alreadyReceived = monthShifts
      .filter((s) => isPerformedShift(s))
      .reduce(
        (s, it) => s + getShiftBalance(it, shiftIncomeAllocations).receivedAmount,
        0
      );

    const coverageRatio = safeFixed > 0 ? projectedIncome / safeFixed : 1;
    const label = formatMonthYear(currentKey);

    const recommendation = calculateShiftRecommendations(
      projectedIncome,
      safeFixed,
      safeAvgIncome,
      avgShiftValue,
      currentKey,
      label,
      context
    );

    timeline.push({
      monthKey: currentKey,
      monthLabel: label,
      projectedIncome,
      alreadyReceived,
      fixedExpenses: safeFixed,
      coverageRatio,
      shifts: monthShifts,
      recommendation,
    });

    currentKey = getNextMonth(currentKey);
  }

  return timeline;
}

export function findMatchingBankIncomesForShift(
  shift: MedicalShift,
  incomes: IncomeItem[],
  rules: HospitalIncomeMappingRule[] = []
): {
  exactMatches: IncomeItem[];
  probableMatches: IncomeItem[];
  matchingRule?: HospitalIncomeMappingRule;
} {
  const matchingRule = rules.find(
    (r) =>
      r.hospitalName.toLowerCase() === shift.hospitalName.toLowerCase() ||
      shift.hospitalName.toLowerCase().includes(r.hospitalName.toLowerCase())
  );

  const exactMatches: IncomeItem[] = [];
  const probableMatches: IncomeItem[] = [];
  const expectedAmount = getShiftExpectedAmount(shift);

  incomes.forEach((inc) => {
    if (inc.recipient !== shift.partner) return;

    if (
      inc.classification === 'resgate_principal' ||
      inc.classification === 'principal_redemption' ||
      inc.status === 'internal_transfer'
    ) {
      return;
    }
    const descLower = (inc.description || '').toLowerCase();
    if (
      descLower.includes('resgate') ||
      descLower.includes('aplicacao') ||
      descLower.includes('aplicação') ||
      descLower.includes('rendimento') ||
      descLower.includes('reinvest')
    ) {
      return;
    }

    const amountDiff = Math.abs(inc.amount - expectedAmount);
    const isAmountClose = amountDiff <= 50;

    const descUpper = (inc.description || '').toUpperCase();
    const hasRuleKeyword =
      matchingRule && descUpper.includes(matchingRule.keywordPattern.toUpperCase());
    const hasHospitalWord = shift.hospitalName
      .toUpperCase()
      .split(' ')
      .filter((w) => w.length > 3)
      .some((w) => descUpper.includes(w));

    if (isAmountClose && (hasRuleKeyword || hasHospitalWord)) {
      exactMatches.push(inc);
    } else if (isAmountClose || hasRuleKeyword || hasHospitalWord) {
      probableMatches.push(inc);
    }
  });

  return {
    exactMatches,
    probableMatches,
    matchingRule,
  };
}

export function getSampleMedicalShifts(currentMonthKey: string): MedicalShift[] {
  const [year, month] = currentMonthKey.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonthKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  return [
    {
      id: 'shift-sample-1',
      partner: 'partner1',
      title: 'Plantão UTI Geral 12h',
      hospitalName: "Hospital Copa D'Or",
      sector: 'uti',
      contractType: 'pj_privado',
      dateWorked: `${currentMonthKey}-12`,
      durationHours: 12,
      grossAmount: 1950,
      netAmount: 1833,
      estimatedPayDate: `${getNextMonth(currentMonthKey)}-15`,
      status: 'pending',
      notes: 'Escala mensal diurna na UTI 2.',
    },
    {
      id: 'shift-sample-2',
      partner: 'partner1',
      title: 'Porta de Emergência 12h',
      hospitalName: 'UPA 24h Tijuca / OSS',
      sector: 'porta',
      contractType: 'pj_oss',
      dateWorked: `${prevMonthKey}-18`,
      durationHours: 12,
      grossAmount: 1350,
      estimatedPayDate: `${currentMonthKey}-28`,
      status: 'pending',
      notes: 'Repasse habitual da OSS via PJ.',
    },
    {
      id: 'shift-sample-3',
      partner: 'partner2',
      title: 'RioSaúde CER 12h',
      hospitalName: 'RioSaúde - CER Campo Grande',
      sector: 'porta',
      contractType: 'clt',
      dateWorked: `${prevMonthKey}-25`,
      durationHours: 12,
      grossAmount: 1500,
      netAmount: 1380,
      estimatedPayDate: `${currentMonthKey}-07`,
      actualPayDate: `${currentMonthKey}-07`,
      status: 'received',
      notes: 'Crédito CLT 5º dia útil confirmado.',
    },
    {
      id: 'shift-sample-4',
      partner: 'partner2',
      title: 'Sala Vermelha UPA 12h',
      hospitalName: 'UPA 24h Engenho de Dentro',
      sector: 'vermelha',
      contractType: 'pj_oss',
      dateWorked: `${prevMonthKey}-05`,
      durationHours: 12,
      grossAmount: 1650,
      estimatedPayDate: `${currentMonthKey}-05`,
      status: 'overdue',
      notes: 'Prazo D+60 venceu. Entrar em contato com o faturamento da OSS.',
    },
    {
      id: 'shift-sample-5',
      partner: 'partner1',
      title: 'Visita de Enfermaria 6h',
      hospitalName: "Hospital Quinta D'Or",
      sector: 'enfermaria',
      contractType: 'pj_privado',
      dateWorked: `${currentMonthKey}-04`,
      durationHours: 6,
      grossAmount: 850,
      estimatedPayDate: `${getNextMonth(currentMonthKey)}-10`,
      status: 'pending',
      notes: 'Evolução e pareceres matutinos.',
    },
  ];
}

export function mapLegacyShiftToRecord(
  shift: MedicalShift,
  doctorUid: string,
  defaultShiftTaxRate: number = 0
): MedicalShiftRecord {
  const status: MedicalShiftStatusV2 =
    shift.status === 'received'
      ? 'paid'
      : shift.executionStatus === 'scheduled'
        ? 'scheduled'
        : 'pending_payment';

  const grossAmount = roundMoney(Math.max(0.01, shift.grossAmount || 0));
  const netAmount =
    shift.netAmount !== undefined && Number.isFinite(shift.netAmount)
      ? Math.min(grossAmount, Math.max(0.01, roundMoney(shift.netAmount)))
      : calculateShiftNetAmount(grossAmount, defaultShiftTaxRate);

  return {
    id: shift.id,
    doctorUid,
    institution: shift.hospitalName || shift.title || 'Hospital',
    shiftDate: shift.dateWorked,
    hours: Math.max(1, shift.durationHours || 12),
    grossAmount,
    netAmount,
    status,
    expectedPayDate: shift.estimatedPayDate || shift.dateWorked,
    paidAt: status === 'paid' ? (shift.actualPayDate || shift.estimatedPayDate || shift.dateWorked) : null,
  };
}

