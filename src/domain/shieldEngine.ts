import type {
  BudgetCycle,
  Goal,
  GoalAllocationRule,
  GoalPillar,
  HouseholdConfig,
} from '../types/finance';
import {
  DEFAULT_HOUSEHOLD_CONFIG,
  clampRate,
  resolveHouseholdConfig,
  roundMoney,
  type WaterfallEvaluationResult,
} from './waterfallEngine';

export interface ShieldCycleSample {
  housingTotal: number;
  essentialFixedTotal: number;
  cancelableFixedTotal?: number;
  installmentsTotal: number;
  groceriesBudget?: number;
  groceriesAmount?: number;
  routineBudget?: number;
  routineAmount?: number;
  unexpectedBufferLimit?: number;
  unexpectedBufferSpent?: number;
  bufferAmount?: number;
}

export interface ShieldMetricsInput {
  /**
   * Cycles used to compute the 3-month rolling essential cost base.
   * Accepts full BudgetCycle records or simplified cycle snapshots.
   */
  cycles: Array<ShieldCycleSample | BudgetCycle>;
  currentShieldBalance: number;
  shieldFloorMonths?: number;
  shieldTargetMonths?: number;
  monthlyNetYieldRate?: number;
}

export interface ShieldMetricsResult {
  essentialMonthlyCosts: number[];
  essentialMonthlyBase: number;
  shieldFloorMonths: number;
  shieldTargetMonths: number;
  shieldFloorAmount: number;
  shieldTargetAmount: number;
  currentShieldBalance: number;
  currentCoverageMonths: number;
  usableFatAmount: number;
  missingToFloorAmount: number;
  missingToTargetAmount: number;
  monthlyNetYieldRate: number;
  estimatedMonthlyYield: number;
  isFloorSecured: boolean;
  isTankFull: boolean;
}

export const DEFAULT_MONTHLY_NET_YIELD_RATE = 0.0085;

/**
 * Extrai o Custo Essencial Real de um ciclo, excluindo estritamente streamings
 * e assinaturas canceláveis (`cancelableFixedTotal`).
 */
export function extractEssentialMonthlyCost(
  cycle: ShieldCycleSample | BudgetCycle
): number {
  const housing = Math.max(0, cycle.housingTotal ?? 0);
  const essentialFixed = Math.max(0, cycle.essentialFixedTotal ?? 0);
  const installments = Math.max(0, cycle.installmentsTotal ?? 0);
  const groceries = Math.max(
    0,
    'groceriesAmount' in cycle && cycle.groceriesAmount !== undefined
      ? cycle.groceriesAmount
      : cycle.groceriesBudget ?? 0
  );
  const routine = Math.max(
    0,
    'routineAmount' in cycle && cycle.routineAmount !== undefined
      ? cycle.routineAmount
      : cycle.routineBudget ?? 0
  );
  const buffer = Math.max(
    0,
    'bufferAmount' in cycle && cycle.bufferAmount !== undefined
      ? cycle.bufferAmount
      : Math.max(cycle.unexpectedBufferLimit ?? 0, cycle.unexpectedBufferSpent ?? 0)
  );

  return roundMoney(
    housing + essentialFixed + installments + groceries + routine + buffer
  );
}

/**
 * Protocolo C.1 — Escudo calibrado pelo Gasto Essencial Real (últimos 3 ciclos).
 */
export function calculateShieldMetrics(
  input: ShieldMetricsInput
): ShieldMetricsResult {
  const shieldFloorMonths = Math.max(
    0,
    input.shieldFloorMonths ?? DEFAULT_HOUSEHOLD_CONFIG.shieldFloorMonths
  );
  const shieldTargetMonths = Math.max(
    shieldFloorMonths,
    input.shieldTargetMonths ?? DEFAULT_HOUSEHOLD_CONFIG.shieldTargetMonths
  );
  const monthlyNetYieldRate = Math.max(
    0,
    input.monthlyNetYieldRate ?? DEFAULT_MONTHLY_NET_YIELD_RATE
  );
  const currentShieldBalance = Math.max(
    0,
    roundMoney(input.currentShieldBalance ?? 0)
  );

  const windowCycles = (input.cycles ?? []).filter(Boolean).slice(-3);
  const essentialMonthlyCosts = windowCycles.map(extractEssentialMonthlyCost);

  const essentialMonthlyBase =
    essentialMonthlyCosts.length > 0
      ? roundMoney(
          essentialMonthlyCosts.reduce((sum, val) => sum + val, 0) /
            essentialMonthlyCosts.length
        )
      : 0;

  const shieldFloorAmount = roundMoney(essentialMonthlyBase * shieldFloorMonths);
  const shieldTargetAmount = roundMoney(essentialMonthlyBase * shieldTargetMonths);

  const currentCoverageMonths =
    essentialMonthlyBase > 0
      ? Number((currentShieldBalance / essentialMonthlyBase).toFixed(2))
      : 0;

  const usableFatAmount = roundMoney(
    Math.max(0, currentShieldBalance - shieldFloorAmount)
  );
  const missingToFloorAmount = roundMoney(
    Math.max(0, shieldFloorAmount - currentShieldBalance)
  );
  const missingToTargetAmount = roundMoney(
    Math.max(0, shieldTargetAmount - currentShieldBalance)
  );
  const estimatedMonthlyYield = roundMoney(
    currentShieldBalance * monthlyNetYieldRate
  );
  const isFloorSecured =
    shieldFloorAmount > 0 && currentShieldBalance >= shieldFloorAmount - 0.005;
  const isTankFull =
    shieldTargetAmount > 0 && currentShieldBalance >= shieldTargetAmount - 0.005;

  return {
    essentialMonthlyCosts,
    essentialMonthlyBase,
    shieldFloorMonths,
    shieldTargetMonths,
    shieldFloorAmount,
    shieldTargetAmount,
    currentShieldBalance,
    currentCoverageMonths,
    usableFatAmount,
    missingToFloorAmount,
    missingToTargetAmount,
    monthlyNetYieldRate,
    estimatedMonthlyYield,
    isFloorSecured,
    isTankFull,
  };
}

export interface RoutedGoalAllocation {
  goalId: string;
  title: string;
  pillar: GoalPillar;
  amount: number;
  overflowedFromShield: number;
}

export interface RouteInvestmentsInput {
  mandatoryGoalAmount: number;
  optionalSurplusToInvest?: number;
  partnerAllowanceSweeps?: number;
  goals: Goal[];
  shieldMetrics: ShieldMetricsResult;
  goalAllocationRules?: GoalAllocationRule[];
}

export interface RouteInvestmentsResult {
  totalInvestableAmount: number;
  byPillar: Record<GoalPillar, number>;
  goalAllocations: RoutedGoalAllocation[];
  shieldOverflowRedirected: number;
  didCutShieldForFullTank: boolean;
  projectedShieldBalanceAfter: number;
  projectedShieldTankFullAfter: boolean;
}

function allocateCentsByWeights(totalCents: number, weights: number[]): number[] {
  const result = new Array<number>(weights.length).fill(0);
  if (totalCents <= 0 || weights.length === 0) return result;

  const positiveSum = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  const effectiveWeights =
    positiveSum > 0 ? weights.map((w) => (w > 0 ? w : 0)) : weights.map(() => 1);
  const effectiveSum = effectiveWeights.reduce((s, w) => s + w, 0);

  let assigned = 0;
  let lastPositiveIdx = 0;
  for (let i = 0; i < effectiveWeights.length; i++) {
    if (effectiveWeights[i] > 0) lastPositiveIdx = i;
    const share = Math.floor((effectiveWeights[i] / effectiveSum) * totalCents);
    result[i] = share;
    assigned += share;
  }
  const diff = totalCents - assigned;
  if (diff !== 0) {
    result[lastPositiveIdx] += diff;
  }
  return result;
}

/**
 * Roteamento automático dos 10% obrigatórios + sobras entre os 3 pilares
 * (`shield`, `dreams`, `wealth`), cortando ou transbordando o Escudo ao atingir 10 meses.
 */
export function routeMonthlyInvestments(
  input: RouteInvestmentsInput
): RouteInvestmentsResult {
  const totalInvestableAmount = roundMoney(
    Math.max(0, input.mandatoryGoalAmount) +
      Math.max(0, input.optionalSurplusToInvest ?? 0) +
      Math.max(0, input.partnerAllowanceSweeps ?? 0)
  );
  const totalCents = Math.round(totalInvestableAmount * 100);
  const goals = (input.goals ?? []).filter(Boolean);

  if (totalCents <= 0 || goals.length === 0) {
    return {
      totalInvestableAmount,
      byPillar: { shield: 0, dreams: 0, wealth: 0 },
      goalAllocations: [],
      shieldOverflowRedirected: 0,
      didCutShieldForFullTank: input.shieldMetrics.isTankFull,
      projectedShieldBalanceAfter: input.shieldMetrics.currentShieldBalance,
      projectedShieldTankFullAfter: input.shieldMetrics.isTankFull,
    };
  }

  const ruleMap = new Map<string, GoalAllocationRule>();
  for (const rule of input.goalAllocationRules ?? []) {
    if (rule?.goalId) ruleMap.set(rule.goalId, rule);
  }

  const weights = goals.map((g, idx) => {
    const id = g.id ?? `goal-${idx}`;
    const rule = ruleMap.get(id);
    const w = rule ? rule.weight : g.autoAllocateWeight;
    return Number.isFinite(w) && w > 0 ? w : 0;
  });

  const nonShieldIndices = goals
    .map((g, idx) => (g.pillar !== 'shield' ? idx : -1))
    .filter((idx) => idx >= 0);
  const shieldIndices = goals
    .map((g, idx) => (g.pillar === 'shield' ? idx : -1))
    .filter((idx) => idx >= 0);

  const allocatedCents = new Array<number>(goals.length).fill(0);
  const overflowFromShieldCents = new Array<number>(goals.length).fill(0);
  let didCutShieldForFullTank = false;
  let shieldOverflowCents = 0;

  if (input.shieldMetrics.isTankFull && nonShieldIndices.length > 0) {
    didCutShieldForFullTank = true;
    const nonShieldWeights = nonShieldIndices.map((idx) => weights[idx]);
    const shares = allocateCentsByWeights(totalCents, nonShieldWeights);
    nonShieldIndices.forEach((goalIdx, pos) => {
      allocatedCents[goalIdx] = shares[pos];
    });
  } else {
    const baseShares = allocateCentsByWeights(totalCents, weights);
    const totalPlannedShieldCents = shieldIndices.reduce(
      (sum, idx) => sum + baseShares[idx],
      0
    );
    const remainingShieldRoomCents = Math.max(
      0,
      Math.round(input.shieldMetrics.missingToTargetAmount * 100)
    );

    if (
      shieldIndices.length > 0 &&
      nonShieldIndices.length > 0 &&
      totalPlannedShieldCents > remainingShieldRoomCents
    ) {
      // Fill shield up to exact 10-month tank target and overflow remainder to dreams & wealth
      shieldOverflowCents = totalPlannedShieldCents - remainingShieldRoomCents;
      const shieldWeights = shieldIndices.map((idx) => weights[idx]);
      const cappedShieldShares = allocateCentsByWeights(
        remainingShieldRoomCents,
        shieldWeights
      );
      shieldIndices.forEach((goalIdx, pos) => {
        allocatedCents[goalIdx] = cappedShieldShares[pos];
      });

      const nonShieldWeights = nonShieldIndices.map((idx) => weights[idx]);
      const overflowShares = allocateCentsByWeights(
        shieldOverflowCents,
        nonShieldWeights
      );
      nonShieldIndices.forEach((goalIdx, pos) => {
        allocatedCents[goalIdx] = baseShares[goalIdx] + overflowShares[pos];
        overflowFromShieldCents[goalIdx] = overflowShares[pos];
      });
    } else {
      for (let i = 0; i < goals.length; i++) {
        allocatedCents[i] = baseShares[i];
      }
    }
  }

  const byPillar: Record<GoalPillar, number> = {
    shield: 0,
    dreams: 0,
    wealth: 0,
  };

  const goalAllocations: RoutedGoalAllocation[] = goals.map((g, idx) => {
    const amount = roundMoney(allocatedCents[idx] / 100);
    byPillar[g.pillar] = roundMoney(byPillar[g.pillar] + amount);
    return {
      goalId: g.id ?? `goal-${idx}`,
      title: g.title,
      pillar: g.pillar,
      amount,
      overflowedFromShield: roundMoney(overflowFromShieldCents[idx] / 100),
    };
  });

  const projectedShieldBalanceAfter = roundMoney(
    input.shieldMetrics.currentShieldBalance + byPillar.shield
  );
  const projectedShieldTankFullAfter =
    input.shieldMetrics.shieldTargetAmount > 0 &&
    projectedShieldBalanceAfter >= input.shieldMetrics.shieldTargetAmount - 0.005;

  return {
    totalInvestableAmount,
    byPillar,
    goalAllocations,
    shieldOverflowRedirected: roundMoney(shieldOverflowCents / 100),
    didCutShieldForFullTank,
    projectedShieldBalanceAfter,
    projectedShieldTankFullAfter,
  };
}

export type BigPurchaseAssetType = 'car' | 'apartment' | 'trip';
export type AmortizationSystem = 'price' | 'sac';
export type BigPurchaseVerdict = 'green' | 'yellow' | 'red';

export type BigPurchaseViolationCode =
  | 'HOUSING_CAP_EXCEEDED'
  | 'INSTALLMENT_CAP_EXCEEDED'
  | 'STRUCTURE_CAP_EXCEEDED'
  | 'INSUFFICIENT_DOWN_PAYMENT'
  | 'INSTALLMENT_CAUTION_BAND';

export interface BigPurchaseViolation {
  code: BigPurchaseViolationCode;
  severity: 'warning' | 'blocking';
  message: string;
  limit: number;
  projected: number;
}

export interface BigPurchaseSimulationInput {
  assetType: BigPurchaseAssetType;
  totalPrice: number;
  downPayment: number;
  installmentsCount: number;
  monthlyInterestRate: number;
  amortizationSystem: AmortizationSystem;
  monthlyHiddenCosts: number;
  currentGoalSavedAmount: number;
  shieldMetrics: ShieldMetricsResult;
  waterfallResult: WaterfallEvaluationResult;
  householdConfig?: Partial<HouseholdConfig>;
  /**
   * Optional replaceable housing costs (rent + condo + IPTU) when simulating an apartment purchase.
   * Defaults to waterfallResult.guards.housing.total.
   */
  currentHousingReplaceableAmount?: number;
}

export interface BigPurchaseSimulationResult {
  assetType: BigPurchaseAssetType;
  verdict: BigPurchaseVerdict;
  financedPrincipal: number;
  monthlyInstallment: number;
  averageMonthlyInstallment: number;
  totalMonthlyAssetImpact: number;
  availableDownPayment: number;
  downPaymentGap: number;
  monthsToSaveDownPayment: number;
  projectedHousingTotal: number;
  projectedHousingRatio: number;
  projectedInstallmentsTotal: number;
  projectedInstallmentRatio: number;
  projectedStructureTotal: number;
  projectedStructureRatio: number;
  violations: BigPurchaseViolation[];
  summary: string;
}

export function calculatePriceInstallment(
  principal: number,
  monthlyInterestRate: number,
  installmentsCount: number
): number {
  const P = Math.max(0, principal);
  const n = Math.floor(installmentsCount);
  if (P <= 0 || n <= 0) return 0;
  const i = Math.max(0, monthlyInterestRate);
  if (i === 0) return roundMoney(P / n);
  const factor = Math.pow(1 + i, n);
  return roundMoney((P * (i * factor)) / (factor - 1));
}

export function calculateSacInstallments(
  principal: number,
  monthlyInterestRate: number,
  installmentsCount: number
): { firstInstallment: number; averageInstallment: number } {
  const P = Math.max(0, principal);
  const n = Math.floor(installmentsCount);
  if (P <= 0 || n <= 0) {
    return { firstInstallment: 0, averageInstallment: 0 };
  }
  const i = Math.max(0, monthlyInterestRate);
  const amort = P / n;
  const firstInstallment = roundMoney(amort + P * i);
  const averageInstallment = roundMoney(amort + (P * i * (n + 1)) / (2 * n));
  return { firstInstallment, averageInstallment };
}

/**
 * Simulador "Posso Comprar?" para aquisições de porte (Carro, Apartamento ou Grande Viagem).
 */
export function simulateBigPurchase(
  input: BigPurchaseSimulationInput
): BigPurchaseSimulationResult {
  const config = resolveHouseholdConfig(
    input.householdConfig ?? input.waterfallResult.config
  );

  const totalPrice = Math.max(0, roundMoney(input.totalPrice));
  const downPayment = Math.min(
    totalPrice,
    Math.max(0, roundMoney(input.downPayment))
  );
  const financedPrincipal = roundMoney(Math.max(0, totalPrice - downPayment));
  const n = Math.max(0, Math.floor(input.installmentsCount));
  const rate = Math.max(0, input.monthlyInterestRate);
  const hiddenCosts = Math.max(0, roundMoney(input.monthlyHiddenCosts));

  let monthlyInstallment = 0;
  let averageMonthlyInstallment = 0;

  if (financedPrincipal > 0 && n > 0) {
    if (input.amortizationSystem === 'sac') {
      const sac = calculateSacInstallments(financedPrincipal, rate, n);
      monthlyInstallment = sac.firstInstallment;
      averageMonthlyInstallment = sac.averageInstallment;
    } else {
      monthlyInstallment = calculatePriceInstallment(financedPrincipal, rate, n);
      averageMonthlyInstallment = monthlyInstallment;
    }
  }

  // Trava 1: Entrada sem furar o Chão de 4 meses
  const availableDownPayment = roundMoney(
    Math.max(0, input.currentGoalSavedAmount) + input.shieldMetrics.usableFatAmount
  );
  const downPaymentGap = roundMoney(
    Math.max(0, downPayment - availableDownPayment)
  );
  const monthlySavingsPace = roundMoney(
    Math.max(0, input.waterfallResult.mandatoryGoal.mandatoryGoalAmount) +
      Math.max(0, input.waterfallResult.closingLedgers.closingSurplus)
  );
  const monthsToSaveDownPayment =
    downPaymentGap <= 0
      ? 0
      : monthlySavingsPace > 0
      ? Math.ceil(downPaymentGap / monthlySavingsPace)
      : Infinity;

  // Trava 2: Tetos Mensais
  const newNetIncome = input.waterfallResult.liquidity.newNetIncome;
  const referenceIncome3M = input.waterfallResult.liquidity.referenceIncome3M;
  const baseHousing = input.waterfallResult.guards.housing.total;
  const baseInstallments = input.waterfallResult.guards.installments.total;
  const baseStructure = input.waterfallResult.guards.structure.actualStructureTotal;

  let projectedHousingTotal = baseHousing;
  let projectedInstallmentsTotal = baseInstallments;
  let projectedStructureTotal = baseStructure;

  if (input.assetType === 'car') {
    projectedHousingTotal = baseHousing;
    projectedInstallmentsTotal = roundMoney(baseInstallments + monthlyInstallment);
    projectedStructureTotal = roundMoney(
      baseStructure + monthlyInstallment + hiddenCosts
    );
  } else if (input.assetType === 'apartment') {
    const replaceable = Math.min(
      baseHousing,
      Math.max(0, roundMoney(input.currentHousingReplaceableAmount ?? baseHousing))
    );
    const nextHousingCost = roundMoney(monthlyInstallment + hiddenCosts);
    projectedHousingTotal = roundMoney(baseHousing - replaceable + nextHousingCost);
    projectedInstallmentsTotal = baseInstallments;
    projectedStructureTotal = roundMoney(baseStructure - replaceable + nextHousingCost);
  } else {
    // trip
    const tripHidden = hiddenCosts;
    projectedHousingTotal = baseHousing;
    projectedInstallmentsTotal = roundMoney(baseInstallments + monthlyInstallment);
    projectedStructureTotal = roundMoney(
      baseStructure + monthlyInstallment + tripHidden
    );
  }

  const projectedHousingRatio =
    newNetIncome > 0
      ? projectedHousingTotal / newNetIncome
      : projectedHousingTotal > 0
      ? Infinity
      : 0;
  const projectedInstallmentRatio =
    referenceIncome3M > 0
      ? projectedInstallmentsTotal / referenceIncome3M
      : projectedInstallmentsTotal > 0
      ? Infinity
      : 0;
  const projectedStructureRatio =
    newNetIncome > 0
      ? projectedStructureTotal / newNetIncome
      : projectedStructureTotal > 0
      ? Infinity
      : 0;

  const violations: BigPurchaseViolation[] = [];

  if (projectedHousingRatio > config.housingCapRate + 1e-6) {
    violations.push({
      code: 'HOUSING_CAP_EXCEEDED',
      severity: 'blocking',
      message: `Moradia projetada (${(projectedHousingRatio * 100).toFixed(1)}%) ultrapassa o teto de ${(config.housingCapRate * 100).toFixed(0)}%.`,
      limit: config.housingCapRate,
      projected: projectedHousingRatio,
    });
  }

  if (projectedInstallmentRatio > config.installmentCapMax + 1e-6) {
    violations.push({
      code: 'INSTALLMENT_CAP_EXCEEDED',
      severity: 'blocking',
      message: `Parcelas projetadas (${(projectedInstallmentRatio * 100).toFixed(1)}%) ultrapassam o limite máximo de ${(config.installmentCapMax * 100).toFixed(0)}%.`,
      limit: config.installmentCapMax,
      projected: projectedInstallmentRatio,
    });
  } else if (projectedInstallmentRatio > config.installmentCapTarget + 1e-6) {
    violations.push({
      code: 'INSTALLMENT_CAUTION_BAND',
      severity: 'warning',
      message: `Parcelas projetadas (${(projectedInstallmentRatio * 100).toFixed(1)}%) ficam acima do alvo de ${(config.installmentCapTarget * 100).toFixed(0)}%.`,
      limit: config.installmentCapTarget,
      projected: projectedInstallmentRatio,
    });
  }

  if (projectedStructureRatio > config.structureCapRate + 1e-6) {
    violations.push({
      code: 'STRUCTURE_CAP_EXCEEDED',
      severity: 'blocking',
      message: `Estrutura de Vida (${(projectedStructureRatio * 100).toFixed(1)}%) ultrapassa o teto global de ${(config.structureCapRate * 100).toFixed(0)}%.`,
      limit: config.structureCapRate,
      projected: projectedStructureRatio,
    });
  }

  if (downPaymentGap > 0) {
    violations.push({
      code: 'INSUFFICIENT_DOWN_PAYMENT',
      severity: Number.isFinite(monthsToSaveDownPayment) ? 'warning' : 'blocking',
      message: Number.isFinite(monthsToSaveDownPayment)
        ? `Faltam R$ ${downPaymentGap.toFixed(2)} para a entrada sem furar o Chão de ${input.shieldMetrics.shieldFloorMonths} meses (viável em ${monthsToSaveDownPayment} ${monthsToSaveDownPayment === 1 ? 'mês' : 'meses'}).`
        : `Faltam R$ ${downPaymentGap.toFixed(2)} para a entrada e não há sobra mensal positiva para acumular o valor.`,
      limit: availableDownPayment,
      projected: downPayment,
    });
  }

  const hasBlockingViolation = violations.some((v) => v.severity === 'blocking');
  const hasWarningViolation = violations.some((v) => v.severity === 'warning');

  let verdict: BigPurchaseVerdict = 'green';
  let summary =
    'Compra viável agora: entrada coberta sem furar o Chão do Escudo e todos os tetos preservados.';

  if (hasBlockingViolation) {
    verdict = 'red';
    summary = violations
      .filter((v) => v.severity === 'blocking')
      .map((v) => v.message)
      .join(' ');
  } else if (hasWarningViolation) {
    verdict = 'yellow';
    summary = violations.map((v) => v.message).join(' ');
  }

  return {
    assetType: input.assetType,
    verdict,
    financedPrincipal,
    monthlyInstallment,
    averageMonthlyInstallment,
    totalMonthlyAssetImpact: roundMoney(monthlyInstallment + hiddenCosts),
    availableDownPayment,
    downPaymentGap,
    monthsToSaveDownPayment,
    projectedHousingTotal,
    projectedHousingRatio,
    projectedInstallmentsTotal,
    projectedInstallmentRatio,
    projectedStructureTotal,
    projectedStructureRatio,
    violations,
    summary,
  };
}
