import type {
  AllowanceWallet,
  BoostTransfer,
  Goal,
  GoalAllocationRule,
  HouseholdConfig,
  MedicalShiftRecord,
  SurplusRouting,
} from '../types/finance';

export type GuardStatus = 'ok' | 'warning' | 'exceeded';
export type InstallmentGuardStatus = 'ok' | 'warning' | 'blocked';
export type InstallmentSimulationVerdict = 'approved' | 'caution' | 'blocked';

export const DEFAULT_HOUSEHOLD_CONFIG: HouseholdConfig = {
  memberUids: [],
  memberTaxIds: [],
  cycleStartDay: 1,
  mandatoryGoalRate: 0.1,
  housingCapRate: 0.3,
  structureCapRate: 0.6,
  installmentCapMin: 0.1,
  installmentCapMax: 0.2,
  installmentCapTarget: 0.15,
  allowanceFloor: 600,
  allowanceCap: 3200,
  shieldFloorMonths: 4,
  shieldTargetMonths: 10,
  defaultShiftTaxRate: 0,
  goalAllocationRules: [],
};

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

export function clampRate(rate: number, min = 0, max = 1): number {
  if (!Number.isFinite(rate)) return min;
  return Math.min(max, Math.max(min, rate));
}

export function resolveHouseholdConfig(
  partial?: Partial<HouseholdConfig>
): HouseholdConfig {
  const allowanceFloor = Math.max(
    0,
    roundMoney(partial?.allowanceFloor ?? DEFAULT_HOUSEHOLD_CONFIG.allowanceFloor)
  );
  const allowanceCap = Math.max(
    allowanceFloor,
    roundMoney(partial?.allowanceCap ?? DEFAULT_HOUSEHOLD_CONFIG.allowanceCap)
  );
  const installmentCapMin = clampRate(
    partial?.installmentCapMin ?? DEFAULT_HOUSEHOLD_CONFIG.installmentCapMin
  );
  const installmentCapMax = Math.max(
    installmentCapMin,
    clampRate(
      partial?.installmentCapMax ?? DEFAULT_HOUSEHOLD_CONFIG.installmentCapMax
    )
  );
  const installmentCapTarget = clampRate(
    partial?.installmentCapTarget ?? DEFAULT_HOUSEHOLD_CONFIG.installmentCapTarget,
    installmentCapMin,
    installmentCapMax
  );
  const shieldFloorMonths = Math.max(
    0,
    partial?.shieldFloorMonths ?? DEFAULT_HOUSEHOLD_CONFIG.shieldFloorMonths
  );
  const shieldTargetMonths = Math.max(
    shieldFloorMonths,
    partial?.shieldTargetMonths ?? DEFAULT_HOUSEHOLD_CONFIG.shieldTargetMonths
  );

  return {
    id: partial?.id,
    memberUids: partial?.memberUids ? [...partial.memberUids] : [],
    memberTaxIds: partial?.memberTaxIds ? [...partial.memberTaxIds] : [],
    cycleStartDay: partial?.cycleStartDay ?? DEFAULT_HOUSEHOLD_CONFIG.cycleStartDay,
    mandatoryGoalRate: clampRate(
      partial?.mandatoryGoalRate ?? DEFAULT_HOUSEHOLD_CONFIG.mandatoryGoalRate
    ),
    housingCapRate: clampRate(
      partial?.housingCapRate ?? DEFAULT_HOUSEHOLD_CONFIG.housingCapRate
    ),
    structureCapRate: clampRate(
      partial?.structureCapRate ?? DEFAULT_HOUSEHOLD_CONFIG.structureCapRate
    ),
    installmentCapMin,
    installmentCapMax,
    installmentCapTarget,
    allowanceFloor,
    allowanceCap,
    shieldFloorMonths,
    shieldTargetMonths,
    defaultShiftTaxRate: clampRate(
      partial?.defaultShiftTaxRate ?? DEFAULT_HOUSEHOLD_CONFIG.defaultShiftTaxRate
    ),
    goalAllocationRules: partial?.goalAllocationRules
      ? partial.goalAllocationRules.map((r) => ({ ...r }))
      : [],
  };
}

export function addCyclesToCycleId(cycleId: string, deltaMonths: number): string {
  const match = /^(\d{4})_(\d{2})$/.exec(cycleId || '');
  const year = match ? Number(match[1]) : 2026;
  const month0 = match ? Number(match[2]) - 1 : 0;
  const totalMonths = year * 12 + month0 + deltaMonths;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth1 = ((totalMonths % 12) + 12) % 12 + 1;
  return `${targetYear}_${String(targetMonth1).padStart(2, '0')}`;
}

export interface SettledIncomeInput {
  amount: number;
  isGross?: boolean;
  taxRate?: number;
}

export interface CycleLiquidityInput {
  settledIncomes?: SettledIncomeInput[];
  settledIncomesTotal?: number;
  shifts?: MedicalShiftRecord[];
  defaultShiftTaxRate?: number;
  previousMonthCarryOver?: number;
  /**
   * Prior cycles' net incomes (oldest -> newest). Up to the last 2 prior cycles
   * are combined with the current cycle's newNetIncome to compute the 3-month average.
   */
  historicalNetIncomes?: number[];
}

export interface CycleLiquidityResult {
  settledBaseIncomesTotal: number;
  paidShiftsNetTotal: number;
  newNetIncome: number;
  receivableShiftsTotal: number;
  scheduledShiftsTotal: number;
  pendingPaymentShiftsTotal: number;
  previousMonthCarryOver: number;
  totalAvailableCash: number;
  referenceIncome3M: number;
  cyclesCountInReference: number;
}

function resolveShiftNetAmount(
  shift: MedicalShiftRecord,
  defaultShiftTaxRate: number
): number {
  const gross = Math.max(0, Number.isFinite(shift.grossAmount) ? shift.grossAmount : 0);
  const explicitNet = Number.isFinite(shift.netAmount) ? Math.max(0, shift.netAmount) : gross;
  if (explicitNet < gross) {
    return roundMoney(explicitNet);
  }
  if (defaultShiftTaxRate > 0) {
    return roundMoney(gross * (1 - clampRate(defaultShiftTaxRate)));
  }
  return roundMoney(explicitNet);
}

/**
 * Degrau 0 — Disponibilidade Real & Renda de Referência 3M.
 * Plantões `scheduled` e `pending_payment` NUNCA entram no caixa nem na média de parcelas.
 */
export function calculateCycleLiquidity(
  input: CycleLiquidityInput
): CycleLiquidityResult {
  const taxRate = clampRate(input.defaultShiftTaxRate ?? 0);

  let settledBaseIncomesTotal = Math.max(
    0,
    Number.isFinite(input.settledIncomesTotal ?? 0) ? input.settledIncomesTotal ?? 0 : 0
  );
  if (input.settledIncomes && input.settledIncomes.length > 0) {
    settledBaseIncomesTotal += input.settledIncomes.reduce((sum, item) => {
      const amt = Math.max(0, Number.isFinite(item.amount) ? item.amount : 0);
      if (item.isGross) {
        const rate = clampRate(item.taxRate ?? taxRate);
        return sum + roundMoney(amt * (1 - rate));
      }
      return sum + roundMoney(amt);
    }, 0);
  }
  settledBaseIncomesTotal = roundMoney(settledBaseIncomesTotal);

  let paidShiftsNetTotal = 0;
  let scheduledShiftsTotal = 0;
  let pendingPaymentShiftsTotal = 0;

  for (const shift of input.shifts ?? []) {
    if (!shift) continue;
    const net = resolveShiftNetAmount(shift, taxRate);
    if (shift.status === 'paid') {
      paidShiftsNetTotal += net;
    } else if (shift.status === 'scheduled') {
      scheduledShiftsTotal += net;
    } else if (shift.status === 'pending_payment') {
      pendingPaymentShiftsTotal += net;
    }
  }

  paidShiftsNetTotal = roundMoney(paidShiftsNetTotal);
  scheduledShiftsTotal = roundMoney(scheduledShiftsTotal);
  pendingPaymentShiftsTotal = roundMoney(pendingPaymentShiftsTotal);

  const receivableShiftsTotal = roundMoney(
    scheduledShiftsTotal + pendingPaymentShiftsTotal
  );
  const newNetIncome = roundMoney(settledBaseIncomesTotal + paidShiftsNetTotal);
  const previousMonthCarryOver = Number.isFinite(input.previousMonthCarryOver ?? 0)
    ? roundMoney(input.previousMonthCarryOver ?? 0)
    : 0;
  const totalAvailableCash = roundMoney(newNetIncome + previousMonthCarryOver);

  const priorTwo = (input.historicalNetIncomes ?? [])
    .filter((n) => Number.isFinite(n) && n >= 0)
    .slice(-2);
  const windowValues = [...priorTwo, newNetIncome];
  const windowSum = windowValues.reduce((sum, val) => sum + val, 0);
  const referenceIncome3M = roundMoney(windowSum / windowValues.length);

  return {
    settledBaseIncomesTotal,
    paidShiftsNetTotal,
    newNetIncome,
    receivableShiftsTotal,
    scheduledShiftsTotal,
    pendingPaymentShiftsTotal,
    previousMonthCarryOver,
    totalAvailableCash,
    referenceIncome3M,
    cyclesCountInReference: windowValues.length,
  };
}

export interface MandatoryGoalBreakdownItem {
  goalId: string;
  title: string;
  pillar: Goal['pillar'];
  amount: number;
  weightUsed: number;
}

export interface MandatoryGoalAllocationResult {
  mandatoryGoalRate: number;
  mandatoryGoalAmount: number;
  mandatoryGoalBreakdown: MandatoryGoalBreakdownItem[];
}

/**
 * Degrau 1 — Regra "Pague-se Primeiro" (10% obrigatórios no topo da cascata).
 */
export function calculateMandatoryGoalAllocation(params: {
  newNetIncome: number;
  mandatoryGoalRate?: number;
  goals?: Goal[];
  goalAllocationRules?: GoalAllocationRule[];
}): MandatoryGoalAllocationResult {
  const rate = clampRate(
    params.mandatoryGoalRate ?? DEFAULT_HOUSEHOLD_CONFIG.mandatoryGoalRate
  );
  const safeIncome = Math.max(0, Number.isFinite(params.newNetIncome) ? params.newNetIncome : 0);
  const mandatoryGoalAmount = roundMoney(safeIncome * rate);
  const goals = (params.goals ?? []).filter((g) => Boolean(g));
  const rules = params.goalAllocationRules ?? [];

  if (mandatoryGoalAmount <= 0 || goals.length === 0) {
    return {
      mandatoryGoalRate: rate,
      mandatoryGoalAmount,
      mandatoryGoalBreakdown: [],
    };
  }

  const ruleByGoalId = new Map<string, GoalAllocationRule>();
  for (const rule of rules) {
    if (rule && rule.goalId) {
      ruleByGoalId.set(rule.goalId, rule);
    }
  }

  const totalCents = Math.round(mandatoryGoalAmount * 100);
  const allocatedCentsByIndex = new Array<number>(goals.length).fill(0);

  // First pass: fixedAmount rules from household goalAllocationRules
  let requestedFixedCents = 0;
  const fixedRequested = goals.map((g, idx) => {
    const id = g.id ?? `goal-${idx}`;
    const rule = ruleByGoalId.get(id);
    const fixed = rule?.fixedAmount && rule.fixedAmount > 0 ? Math.round(rule.fixedAmount * 100) : 0;
    requestedFixedCents += fixed;
    return fixed;
  });

  let remainingCents = totalCents;
  if (requestedFixedCents > 0) {
    if (requestedFixedCents <= totalCents) {
      for (let i = 0; i < goals.length; i++) {
        allocatedCentsByIndex[i] = fixedRequested[i];
      }
      remainingCents = totalCents - requestedFixedCents;
    } else {
      // Scale fixed amounts down proportionally to fit mandatoryGoalAmount exactly
      let assigned = 0;
      for (let i = 0; i < goals.length; i++) {
        const share = Math.floor((fixedRequested[i] / requestedFixedCents) * totalCents);
        allocatedCentsByIndex[i] = share;
        assigned += share;
      }
      let leftover = totalCents - assigned;
      for (let i = 0; i < goals.length && leftover > 0; i++) {
        if (fixedRequested[i] > 0) {
          allocatedCentsByIndex[i] += 1;
          leftover -= 1;
        }
      }
      remainingCents = 0;
    }
  }

  // Second pass: weight-based distribution of remainingCents
  const weights = goals.map((g, idx) => {
    const id = g.id ?? `goal-${idx}`;
    const rule = ruleByGoalId.get(id);
    const w = rule ? rule.weight : g.autoAllocateWeight;
    return Number.isFinite(w) && w > 0 ? w : 0;
  });
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  if (remainingCents > 0) {
    const effectiveWeights =
      totalWeight > 0 ? weights : goals.map(() => 1);
    const effectiveSum = effectiveWeights.reduce((sum, w) => sum + w, 0);

    let assigned = 0;
    let lastPositiveIdx = 0;
    for (let i = 0; i < goals.length; i++) {
      if (effectiveWeights[i] > 0) lastPositiveIdx = i;
      const share = Math.floor((effectiveWeights[i] / effectiveSum) * remainingCents);
      allocatedCentsByIndex[i] += share;
      assigned += share;
    }
    const diff = remainingCents - assigned;
    if (diff !== 0) {
      allocatedCentsByIndex[lastPositiveIdx] += diff;
    }
  }

  const mandatoryGoalBreakdown: MandatoryGoalBreakdownItem[] = goals.map((g, idx) => {
    const id = g.id ?? `goal-${idx}`;
    return {
      goalId: id,
      title: g.title,
      pillar: g.pillar,
      amount: roundMoney(allocatedCentsByIndex[idx] / 100),
      weightUsed: weights[idx],
    };
  });

  return {
    mandatoryGoalRate: rate,
    mandatoryGoalAmount,
    mandatoryGoalBreakdown,
  };
}

export interface HousingGuardResult {
  total: number;
  capRate: number;
  capAmount: number;
  ratio: number;
  margin: number;
  status: GuardStatus;
}

export interface InstallmentGuardResult {
  total: number;
  referenceIncome3M: number;
  minRate: number;
  maxRate: number;
  targetRate: number;
  minAmount: number;
  targetAmount: number;
  max20Amount: number;
  ratio: number;
  marginToTarget: number;
  marginToMax: number;
  status: InstallmentGuardStatus;
}

export interface StructureGuardResult {
  housingTotal: number;
  essentialFixedTotal: number;
  cancelableFixedTotal: number;
  installmentsTotal: number;
  groceriesAmount: number;
  routineAmount: number;
  bufferAmount: number;
  actualStructureTotal: number;
  capRate: number;
  capAmount: number;
  ratio: number;
  margin: number;
  savingsBelowCap: number;
  status: GuardStatus;
}

export function evaluateHousingGuard(params: {
  housingTotal: number;
  newNetIncome: number;
  housingCapRate?: number;
}): HousingGuardResult {
  const capRate = clampRate(
    params.housingCapRate ?? DEFAULT_HOUSEHOLD_CONFIG.housingCapRate
  );
  const total = Math.max(0, roundMoney(params.housingTotal));
  const income = Math.max(0, roundMoney(params.newNetIncome));
  const capAmount = roundMoney(income * capRate);
  const ratio = income > 0 ? total / income : total > 0 ? Infinity : 0;
  const margin = roundMoney(capAmount - total);

  let status: GuardStatus = 'ok';
  if (total > capAmount + 0.005 || (income <= 0 && total > 0)) {
    status = 'exceeded';
  } else if (capRate > 0 && ratio >= capRate * 0.9) {
    status = 'warning';
  }

  return {
    total,
    capRate,
    capAmount,
    ratio,
    margin,
    status,
  };
}

export function evaluateInstallmentGuard(params: {
  installmentsTotal: number;
  referenceIncome3M: number;
  installmentCapMin?: number;
  installmentCapMax?: number;
  installmentCapTarget?: number;
}): InstallmentGuardResult {
  const minRate = clampRate(
    params.installmentCapMin ?? DEFAULT_HOUSEHOLD_CONFIG.installmentCapMin
  );
  const maxRate = Math.max(
    minRate,
    clampRate(
      params.installmentCapMax ?? DEFAULT_HOUSEHOLD_CONFIG.installmentCapMax
    )
  );
  const targetRate = clampRate(
    params.installmentCapTarget ?? DEFAULT_HOUSEHOLD_CONFIG.installmentCapTarget,
    minRate,
    maxRate
  );

  const total = Math.max(0, roundMoney(params.installmentsTotal));
  const ref = Math.max(0, roundMoney(params.referenceIncome3M));
  const minAmount = roundMoney(ref * minRate);
  const targetAmount = roundMoney(ref * targetRate);
  const max20Amount = roundMoney(ref * maxRate);
  const ratio = ref > 0 ? total / ref : total > 0 ? Infinity : 0;
  const marginToTarget = roundMoney(targetAmount - total);
  const marginToMax = roundMoney(max20Amount - total);

  let status: InstallmentGuardStatus = 'ok';
  if (total > max20Amount + 0.005 || (ref <= 0 && total > 0)) {
    status = 'blocked';
  } else if (total > targetAmount + 0.005) {
    status = 'warning';
  }

  return {
    total,
    referenceIncome3M: ref,
    minRate,
    maxRate,
    targetRate,
    minAmount,
    targetAmount,
    max20Amount,
    ratio,
    marginToTarget,
    marginToMax,
    status,
  };
}

/**
 * Degrau 3 — Estrutura de Vida Global (<= 60% — Protocolo B.4).
 * 60% é teto máximo, nunca meta de gasto. Economia abaixo dos 60% permanece no caixa comum.
 */
export function evaluateStructureGuard(params: {
  newNetIncome: number;
  housingTotal: number;
  essentialFixedTotal: number;
  cancelableFixedTotal: number;
  installmentsTotal: number;
  groceriesAmount: number;
  routineAmount: number;
  bufferAmount: number;
  structureCapRate?: number;
}): StructureGuardResult {
  const capRate = clampRate(
    params.structureCapRate ?? DEFAULT_HOUSEHOLD_CONFIG.structureCapRate
  );
  const housingTotal = Math.max(0, roundMoney(params.housingTotal));
  const essentialFixedTotal = Math.max(0, roundMoney(params.essentialFixedTotal));
  const cancelableFixedTotal = Math.max(0, roundMoney(params.cancelableFixedTotal));
  const installmentsTotal = Math.max(0, roundMoney(params.installmentsTotal));
  const groceriesAmount = Math.max(0, roundMoney(params.groceriesAmount));
  const routineAmount = Math.max(0, roundMoney(params.routineAmount));
  const bufferAmount = Math.max(0, roundMoney(params.bufferAmount));

  const actualStructureTotal = roundMoney(
    housingTotal +
      essentialFixedTotal +
      cancelableFixedTotal +
      installmentsTotal +
      groceriesAmount +
      routineAmount +
      bufferAmount
  );

  const income = Math.max(0, roundMoney(params.newNetIncome));
  const capAmount = roundMoney(income * capRate);
  const ratio =
    income > 0 ? actualStructureTotal / income : actualStructureTotal > 0 ? Infinity : 0;
  const margin = roundMoney(capAmount - actualStructureTotal);
  const savingsBelowCap = Math.max(0, margin);

  let status: GuardStatus = 'ok';
  if (actualStructureTotal > capAmount + 0.005 || (income <= 0 && actualStructureTotal > 0)) {
    status = 'exceeded';
  } else if (capRate > 0 && ratio >= capRate * 0.9) {
    status = 'warning';
  }

  return {
    housingTotal,
    essentialFixedTotal,
    cancelableFixedTotal,
    installmentsTotal,
    groceriesAmount,
    routineAmount,
    bufferAmount,
    actualStructureTotal,
    capRate,
    capAmount,
    ratio,
    margin,
    savingsBelowCap,
    status,
  };
}

export interface AllowanceWaveResult {
  wave: 1 | 2;
  safeAllowancePool: number;
  allowanceFloor: number;
  allowanceCap: number;
  fullMonthlyAllocationPerPartner: number;
  unlockedAllowanceA: number;
  unlockedAllowanceB: number;
  pendingWave2ComplementPerPartner: number;
  retainedAboveCapSurplus: number;
  floorComplementRequired: number;
}

/**
 * Degrau 4 — Mesada Híbrida (50/50 com Piso, Teto e Liberação em 2 Ondas).
 */
export function calculateAllowanceWave(params: {
  newNetIncome: number;
  mandatoryGoalAmount: number;
  actualStructureTotal: number;
  allowanceFloor?: number;
  allowanceCap?: number;
  wave?: 1 | 2;
}): AllowanceWaveResult {
  const wave: 1 | 2 = params.wave === 1 ? 1 : 2;
  const allowanceFloor = Math.max(
    0,
    roundMoney(params.allowanceFloor ?? DEFAULT_HOUSEHOLD_CONFIG.allowanceFloor)
  );
  const allowanceCap = Math.max(
    allowanceFloor,
    roundMoney(params.allowanceCap ?? DEFAULT_HOUSEHOLD_CONFIG.allowanceCap)
  );

  const safeAllowancePool = roundMoney(
    Math.max(
      0,
      params.newNetIncome - params.mandatoryGoalAmount - params.actualStructureTotal
    )
  );

  const fullMonthlyAllocationPerPartner = roundMoney(
    Math.min(allowanceCap, Math.max(allowanceFloor, safeAllowancePool / 2))
  );

  const unlockedAllowanceA =
    wave === 1 ? allowanceFloor : fullMonthlyAllocationPerPartner;
  const unlockedAllowanceB =
    wave === 1 ? allowanceFloor : fullMonthlyAllocationPerPartner;

  const pendingWave2ComplementPerPartner =
    wave === 1
      ? roundMoney(Math.max(0, fullMonthlyAllocationPerPartner - allowanceFloor))
      : 0;

  const retainedAboveCapSurplus = roundMoney(
    Math.max(0, safeAllowancePool - fullMonthlyAllocationPerPartner * 2)
  );

  const floorComplementRequired = roundMoney(
    Math.max(0, unlockedAllowanceA + unlockedAllowanceB - safeAllowancePool)
  );

  return {
    wave,
    safeAllowancePool,
    allowanceFloor,
    allowanceCap,
    fullMonthlyAllocationPerPartner,
    unlockedAllowanceA,
    unlockedAllowanceB,
    pendingWave2ComplementPerPartner,
    retainedAboveCapSurplus,
    floorComplementRequired,
  };
}

export interface PartnerWalletInput {
  uid?: string;
  rolloverFromPrevious?: number;
  soloSpent?: number;
  personalInstallments?: number;
  sweptToSharedGoals?: number;
}

export interface AllowanceWalletLedger {
  rolloverFromPrevious: number;
  monthlyAllocation: number;
  boostsNet: number;
  soloSpent: number;
  personalInstallments: number;
  jointAllowanceShareSpent: number;
  sweptToSharedGoals: number;
  closingBalance: number;
  personalInstallmentLimit: number;
  isPersonalInstallmentWithinLimit: boolean;
  walletRecord: AllowanceWallet;
}

export interface ClosingLedgersInput {
  totalAvailableCash: number;
  mandatoryGoalAmount: number;
  actualStructureTotal: number;
  unlockedAllowanceA: number;
  unlockedAllowanceB: number;
  previousMonthCarryOver?: number;
  safeAllowancePool?: number;
  allowanceFloor?: number;
  sharedAllowanceExpensesTotal?: number;
  boostTransfers?: BoostTransfer[];
  partnerA?: PartnerWalletInput;
  partnerB?: PartnerWalletInput;
  surplusRouting?: SurplusRouting;
}

export interface ClosingLedgersResult {
  closingSurplus: number;
  surplusRouting: SurplusRouting;
  isCashDeficit: boolean;
  carryOverAbsorbedForAllowanceFloor: number;
  jointAllowanceSharePerPartner: number;
  walletA: AllowanceWalletLedger;
  walletB: AllowanceWalletLedger;
}

function buildPartnerWalletLedger(params: {
  input?: PartnerWalletInput;
  unlockedAllocation: number;
  boostsNet: number;
  jointAllowanceShare: number;
  allowanceFloor: number;
}): AllowanceWalletLedger {
  const rolloverFromPrevious = roundMoney(params.input?.rolloverFromPrevious ?? 0);
  const monthlyAllocation = Math.max(0, roundMoney(params.unlockedAllocation));
  const boostsNet = roundMoney(params.boostsNet);
  const soloSpent = Math.max(0, roundMoney(params.input?.soloSpent ?? 0));
  const personalInstallments = Math.max(
    0,
    roundMoney(params.input?.personalInstallments ?? 0)
  );
  const jointAllowanceShareSpent = Math.max(0, roundMoney(params.jointAllowanceShare));
  const sweptToSharedGoals = Math.max(
    0,
    roundMoney(params.input?.sweptToSharedGoals ?? 0)
  );

  const closingBalance = roundMoney(
    rolloverFromPrevious +
      monthlyAllocation +
      boostsNet -
      soloSpent -
      personalInstallments -
      jointAllowanceShareSpent -
      sweptToSharedGoals
  );

  const personalInstallmentLimit = roundMoney(params.allowanceFloor * 0.5);
  const isPersonalInstallmentWithinLimit =
    personalInstallments <= personalInstallmentLimit + 0.005;

  return {
    rolloverFromPrevious,
    monthlyAllocation,
    boostsNet,
    soloSpent,
    personalInstallments,
    jointAllowanceShareSpent,
    sweptToSharedGoals,
    closingBalance,
    personalInstallmentLimit,
    isPersonalInstallmentWithinLimit,
    walletRecord: {
      rolloverFromPrevious,
      monthlyAllocation,
      boostsNet,
      soloSpent: roundMoney(soloSpent + personalInstallments),
      jointAllowanceShareSpent,
      sweptToSharedGoals,
      closingBalance,
    },
  };
}

/**
 * Degrau 5 — Duplo Ledger de Sobras (Sobra do Caixa Comum + Carteira Híbrida Privada A e B).
 */
export function calculateClosingLedgers(
  input: ClosingLedgersInput
): ClosingLedgersResult {
  const allowanceFloor = Math.max(
    0,
    roundMoney(input.allowanceFloor ?? DEFAULT_HOUSEHOLD_CONFIG.allowanceFloor)
  );
  const unlockedA = Math.max(0, roundMoney(input.unlockedAllowanceA));
  const unlockedB = Math.max(0, roundMoney(input.unlockedAllowanceB));

  const closingSurplus = roundMoney(
    input.totalAvailableCash -
      input.mandatoryGoalAmount -
      input.actualStructureTotal -
      (unlockedA + unlockedB)
  );

  const floorDeficitInPool = Math.max(
    0,
    roundMoney(unlockedA + unlockedB - (input.safeAllowancePool ?? unlockedA + unlockedB))
  );
  const carryOverAbsorbedForAllowanceFloor = roundMoney(
    Math.min(Math.max(0, input.previousMonthCarryOver ?? 0), floorDeficitInPool)
  );

  const jointAllowanceSharePerPartner = roundMoney(
    Math.max(0, input.sharedAllowanceExpensesTotal ?? 0) / 2
  );

  const uidA = input.partnerA?.uid ?? 'partnerA';
  const uidB = input.partnerB?.uid ?? 'partnerB';

  let boostsNetA = 0;
  let boostsNetB = 0;
  for (const transfer of input.boostTransfers ?? []) {
    if (!transfer || !Number.isFinite(transfer.amount) || transfer.amount <= 0) {
      continue;
    }
    const amt = roundMoney(transfer.amount);
    if (transfer.fromUid === uidA) boostsNetA -= amt;
    if (transfer.toUid === uidA) boostsNetA += amt;
    if (transfer.fromUid === uidB) boostsNetB -= amt;
    if (transfer.toUid === uidB) boostsNetB += amt;
  }

  const walletA = buildPartnerWalletLedger({
    input: input.partnerA,
    unlockedAllocation: unlockedA,
    boostsNet: boostsNetA,
    jointAllowanceShare: jointAllowanceSharePerPartner,
    allowanceFloor,
  });

  const walletB = buildPartnerWalletLedger({
    input: input.partnerB,
    unlockedAllocation: unlockedB,
    boostsNet: boostsNetB,
    jointAllowanceShare: jointAllowanceSharePerPartner,
    allowanceFloor,
  });

  return {
    closingSurplus,
    surplusRouting: input.surplusRouting ?? 'carry_over',
    isCashDeficit: closingSurplus < -0.005,
    carryOverAbsorbedForAllowanceFloor,
    jointAllowanceSharePerPartner,
    walletA,
    walletB,
  };
}

export interface WaterfallEvaluationInput {
  householdConfig?: Partial<HouseholdConfig>;
  liquidity: CycleLiquidityInput;
  housingTotal: number;
  essentialFixedTotal: number;
  cancelableFixedTotal: number;
  installmentsTotal: number;
  groceriesAmount: number;
  routineAmount: number;
  bufferAmount: number;
  wave?: 1 | 2;
  goals?: Goal[];
  sharedAllowanceExpensesTotal?: number;
  boostTransfers?: BoostTransfer[];
  partnerA?: PartnerWalletInput;
  partnerB?: PartnerWalletInput;
  surplusRouting?: SurplusRouting;
}

export interface WaterfallEvaluationResult {
  config: HouseholdConfig;
  liquidity: CycleLiquidityResult;
  mandatoryGoal: MandatoryGoalAllocationResult;
  guards: {
    housing: HousingGuardResult;
    installments: InstallmentGuardResult;
    structure: StructureGuardResult;
  };
  allowance: AllowanceWaveResult;
  closingLedgers: ClosingLedgersResult;
}

/**
 * Executa a cascata completa dos 5 degraus do Juntô v2.3.
 */
export function evaluateWaterfall(
  input: WaterfallEvaluationInput
): WaterfallEvaluationResult {
  const config = resolveHouseholdConfig(input.householdConfig);

  const liquidity = calculateCycleLiquidity({
    ...input.liquidity,
    defaultShiftTaxRate:
      input.liquidity.defaultShiftTaxRate ?? config.defaultShiftTaxRate,
  });

  const mandatoryGoal = calculateMandatoryGoalAllocation({
    newNetIncome: liquidity.newNetIncome,
    mandatoryGoalRate: config.mandatoryGoalRate,
    goals: input.goals,
    goalAllocationRules: config.goalAllocationRules,
  });

  const housing = evaluateHousingGuard({
    housingTotal: input.housingTotal,
    newNetIncome: liquidity.newNetIncome,
    housingCapRate: config.housingCapRate,
  });

  const installments = evaluateInstallmentGuard({
    installmentsTotal: input.installmentsTotal,
    referenceIncome3M: liquidity.referenceIncome3M,
    installmentCapMin: config.installmentCapMin,
    installmentCapMax: config.installmentCapMax,
    installmentCapTarget: config.installmentCapTarget,
  });

  const structure = evaluateStructureGuard({
    newNetIncome: liquidity.newNetIncome,
    housingTotal: input.housingTotal,
    essentialFixedTotal: input.essentialFixedTotal,
    cancelableFixedTotal: input.cancelableFixedTotal,
    installmentsTotal: input.installmentsTotal,
    groceriesAmount: input.groceriesAmount,
    routineAmount: input.routineAmount,
    bufferAmount: input.bufferAmount,
    structureCapRate: config.structureCapRate,
  });

  const allowance = calculateAllowanceWave({
    newNetIncome: liquidity.newNetIncome,
    mandatoryGoalAmount: mandatoryGoal.mandatoryGoalAmount,
    actualStructureTotal: structure.actualStructureTotal,
    allowanceFloor: config.allowanceFloor,
    allowanceCap: config.allowanceCap,
    wave: input.wave,
  });

  const closingLedgers = calculateClosingLedgers({
    totalAvailableCash: liquidity.totalAvailableCash,
    mandatoryGoalAmount: mandatoryGoal.mandatoryGoalAmount,
    actualStructureTotal: structure.actualStructureTotal,
    unlockedAllowanceA: allowance.unlockedAllowanceA,
    unlockedAllowanceB: allowance.unlockedAllowanceB,
    previousMonthCarryOver: liquidity.previousMonthCarryOver,
    safeAllowancePool: allowance.safeAllowancePool,
    allowanceFloor: config.allowanceFloor,
    sharedAllowanceExpensesTotal: input.sharedAllowanceExpensesTotal,
    boostTransfers: input.boostTransfers,
    partnerA: input.partnerA,
    partnerB: input.partnerB,
    surplusRouting: input.surplusRouting,
  });

  return {
    config,
    liquidity,
    mandatoryGoal,
    guards: {
      housing,
      installments,
      structure,
    },
    allowance,
    closingLedgers,
  };
}

export interface InstallmentSimulationInput {
  purchaseAmount: number;
  installmentsCount: number;
  currentInstallmentsTotal: number;
  referenceIncome3M: number;
  startCycleId?: string;
  householdConfig?: Partial<HouseholdConfig>;
  /**
   * Optional current cycle totals to calculate the exact reduction on each partner's allowance
   * respecting allowanceFloor and allowanceCap.
   */
  currentNewNetIncome?: number;
  currentActualStructureTotal?: number;
  currentMandatoryGoalAmount?: number;
}

export interface InstallmentSimulationResult {
  monthlyInstallment: number;
  currentInstallmentRatio: number;
  projectedInstallmentsTotal: number;
  projectedInstallmentRatio: number;
  targetRate: number;
  maxRate: number;
  allowanceReductionPerPartner: number;
  payoffCycleId: string;
  verdict: InstallmentSimulationVerdict;
  reason: string;
}

/**
 * Simulador pré-compra "Posso Parcelar?".
 */
export function simulateInstallmentPurchase(
  input: InstallmentSimulationInput
): InstallmentSimulationResult {
  const config = resolveHouseholdConfig(input.householdConfig);
  const purchaseAmount = Math.max(0, roundMoney(input.purchaseAmount));
  const count = Math.max(1, Math.floor(input.installmentsCount || 1));
  const monthlyInstallment = roundMoney(purchaseAmount / count);
  const currentTotal = Math.max(0, roundMoney(input.currentInstallmentsTotal));
  const ref = Math.max(0, roundMoney(input.referenceIncome3M));

  const currentInstallmentRatio =
    ref > 0 ? currentTotal / ref : currentTotal > 0 ? Infinity : 0;
  const projectedInstallmentsTotal = roundMoney(currentTotal + monthlyInstallment);
  const projectedInstallmentRatio =
    ref > 0
      ? projectedInstallmentsTotal / ref
      : projectedInstallmentsTotal > 0
      ? Infinity
      : 0;

  let verdict: InstallmentSimulationVerdict = 'approved';
  let reason = `Parcela cabe dentro da meta de ${(config.installmentCapTarget * 100).toFixed(0)}% da renda de referência 3M.`;

  if (
    projectedInstallmentRatio > config.installmentCapMax + 1e-6 ||
    (ref <= 0 && projectedInstallmentsTotal > 0)
  ) {
    verdict = 'blocked';
    reason = `Comprometimento de parcelas atingiria ${(projectedInstallmentRatio * 100).toFixed(1)}%, acima do limite máximo de ${(config.installmentCapMax * 100).toFixed(0)}%.`;
  } else if (projectedInstallmentRatio > config.installmentCapTarget + 1e-6) {
    verdict = 'caution';
    reason = `Comprometimento entrará na faixa de atenção (${(projectedInstallmentRatio * 100).toFixed(1)}%, entre ${(config.installmentCapTarget * 100).toFixed(0)}% e ${(config.installmentCapMax * 100).toFixed(0)}%).`;
  }

  let allowanceReductionPerPartner = roundMoney(monthlyInstallment / 2);
  if (
    input.currentNewNetIncome !== undefined &&
    input.currentActualStructureTotal !== undefined
  ) {
    const mandatory =
      input.currentMandatoryGoalAmount ??
      roundMoney(input.currentNewNetIncome * config.mandatoryGoalRate);
    const before = calculateAllowanceWave({
      newNetIncome: input.currentNewNetIncome,
      mandatoryGoalAmount: mandatory,
      actualStructureTotal: input.currentActualStructureTotal,
      allowanceFloor: config.allowanceFloor,
      allowanceCap: config.allowanceCap,
      wave: 2,
    });
    const after = calculateAllowanceWave({
      newNetIncome: input.currentNewNetIncome,
      mandatoryGoalAmount: mandatory,
      actualStructureTotal: input.currentActualStructureTotal + monthlyInstallment,
      allowanceFloor: config.allowanceFloor,
      allowanceCap: config.allowanceCap,
      wave: 2,
    });
    allowanceReductionPerPartner = roundMoney(
      Math.max(
        0,
        before.fullMonthlyAllocationPerPartner - after.fullMonthlyAllocationPerPartner
      )
    );
  }

  const startCycleId = input.startCycleId ?? '2026_01';
  const payoffCycleId = addCyclesToCycleId(startCycleId, count - 1);

  return {
    monthlyInstallment,
    currentInstallmentRatio,
    projectedInstallmentsTotal,
    projectedInstallmentRatio,
    targetRate: config.installmentCapTarget,
    maxRate: config.installmentCapMax,
    allowanceReductionPerPartner,
    payoffCycleId,
    verdict,
    reason,
  };
}
