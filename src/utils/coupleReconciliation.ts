import { BoostTransfer, CategoryKey, ExpenseItem, SurplusRouting } from '../types/finance';
import {
  calculateClosingLedgers,
  roundMoney,
  type ClosingLedgersResult,
  type PartnerWalletInput,
} from '../domain/waterfallEngine';
import { CATEGORY_PRESENTATION_META } from './occurrenceProjection';

export interface DuplicateGroup {
  id: string;
  primary: ExpenseItem;
  duplicates: ExpenseItem[];
  reason: string;
  amount: number;
  date: string;
}

export interface SinglePoolReconciliationInput {
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

export interface SinglePoolReconciliationResult extends ClosingLedgersResult {
  /**
   * No modelo Caixa Único + Mesada Híbrida v2.3 não existe dívida nem acerto 50/50 entre parceiros.
   */
  partnerDebtBalance: 0;
  settlementRequired: false;
}

/**
 * Reconciliação canônica v2.3 sob Caixa Único + Mesada Híbrida (`Só Minha` vs `Dos Dois`).
 * Substitui integralmente o antigo cálculo de rateio/dívida entre parceiros.
 */
export function reconcileSinglePoolV23(
  input: SinglePoolReconciliationInput
): SinglePoolReconciliationResult {
  const ledgers = calculateClosingLedgers(input);
  return {
    ...ledgers,
    closingSurplus: roundMoney(ledgers.closingSurplus),
    partnerDebtBalance: 0,
    settlementRequired: false,
  };
}

export interface PredictiveBurnAlert {
  categoryKey: CategoryKey;
  categoryName: string;
  categoryEmoji: string;
  spent: number;
  budget: number;
  percentUsed: number;
  burnRatePerDay: number;
  projectedBurstDay: number | null;
  safeDailyTarget: number;
  daysUntilBurst: number | null;
  severity: 'nominal' | 'warning' | 'critical';
  recommendation: string;
}

/**
 * Detects suspicious duplicate expenses in the given list.
 * Identifies entries with:
 * 1. Same amount, same date, same category.
 * 2. Same amount and identical/very similar description within +- 24 hours.
 */
export function detectDuplicateExpenses(expenses: ExpenseItem[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const processedIds = new Set<string>();

  for (let i = 0; i < expenses.length; i++) {
    const a = expenses[i];
    if (processedIds.has(a.id)) continue;

    const matchedDuplicates: ExpenseItem[] = [];

    for (let j = i + 1; j < expenses.length; j++) {
      const b = expenses[j];
      if (processedIds.has(b.id)) continue;

      const sameAmount = Math.abs(a.amount - b.amount) < 0.01;
      const sameCategory = a.category === b.category;
      const sameDate = a.date === b.date;

      const descA = a.description.trim().toLowerCase();
      const descB = b.description.trim().toLowerCase();
      const sameDesc = descA === descB;

      const dateDiffDays = Math.abs(
        (new Date(a.date).getTime() - new Date(b.date).getTime()) / (1000 * 60 * 60 * 24)
      );

      if ((sameDate && sameAmount && sameCategory) || (dateDiffDays <= 1 && sameAmount && sameDesc)) {
        matchedDuplicates.push(b);
        processedIds.add(b.id);
      }
    }

    if (matchedDuplicates.length > 0) {
      processedIds.add(a.id);
      groups.push({
        id: `dup-${a.id}`,
        primary: a,
        duplicates: matchedDuplicates,
        reason:
          a.date === matchedDuplicates[0].date
            ? `Valor idêntico (R$ ${a.amount.toFixed(2)}) lançado no mesmo dia (${a.date})`
            : `Mesmo valor e descrição em datas consecutivas`,
        amount: a.amount,
        date: a.date,
      });
    }
  }

  return groups;
}

/**
 * Calculates predictive burn rate and projections for categories before they burst.
 */
export function calculatePredictiveBurnRates({
  categoriesSpending,
  currentMonth,
}: {
  categoriesSpending: Record<
    CategoryKey,
    { spent: number; budget: number; remaining: number; percentageUsed: number; isOver: boolean }
  >;
  currentMonth: string;
}): PredictiveBurnAlert[] {
  const alerts: PredictiveBurnAlert[] = [];

  const now = new Date();
  const year = parseInt(currentMonth.split('-')[0], 10);
  const month = parseInt(currentMonth.split('-')[1], 10);
  const totalDaysInMonth = new Date(year, month, 0).getDate();

  const isCurrentMonth =
    now.getFullYear() === year && now.getMonth() + 1 === month;
  const currentDay = isCurrentMonth ? Math.max(1, now.getDate()) : 15;
  const daysRemaining = Math.max(0, totalDaysInMonth - currentDay);

  (Object.keys(categoriesSpending) as CategoryKey[]).forEach((catKey) => {
    const spend = categoriesSpending[catKey];
    if (!spend || spend.budget <= 0) return;

    const catMeta = CATEGORY_PRESENTATION_META[catKey];
    const burnRatePerDay = currentDay > 0 ? spend.spent / currentDay : 0;
    const safeDailyTarget =
      daysRemaining > 0 && spend.remaining > 0 ? spend.remaining / daysRemaining : 0;

    let projectedBurstDay: number | null = null;
    let daysUntilBurst: number | null = null;
    let severity: 'nominal' | 'warning' | 'critical' = 'nominal';
    let recommendation = 'Ritmo sob controle para o mês.';

    if (spend.isOver) {
      severity = 'critical';
      recommendation = `Categoria já ultrapassou o teto em R$ ${Math.abs(spend.remaining).toFixed(2)}.`;
    } else if (burnRatePerDay > 0) {
      const daysToExhaustBudget = spend.budget / burnRatePerDay;
      projectedBurstDay = Math.ceil(daysToExhaustBudget);

      if (projectedBurstDay < totalDaysInMonth) {
        daysUntilBurst = Math.max(1, projectedBurstDay - currentDay);
        severity = daysUntilBurst <= 5 ? 'critical' : 'warning';
        recommendation = `No ritmo atual (R$ ${burnRatePerDay.toFixed(
          2
        )}/dia), o orçamento esgotará no dia ${projectedBurstDay}. Limitem a R$ ${safeDailyTarget.toFixed(
          2
        )}/dia para fechar no positivo.`;
      }
    }

    if (severity !== 'nominal') {
      alerts.push({
        categoryKey: catKey,
        categoryName: catMeta?.label || catKey,
        categoryEmoji: catMeta?.emoji || '💳',
        spent: spend.spent,
        budget: spend.budget,
        percentUsed: spend.percentageUsed,
        burnRatePerDay,
        projectedBurstDay,
        safeDailyTarget,
        daysUntilBurst,
        severity,
        recommendation,
      });
    }
  });

  return alerts.sort((a, b) => {
    if (a.severity === 'critical' && b.severity !== 'critical') return -1;
    if (b.severity === 'critical' && a.severity !== 'critical') return 1;
    return (a.daysUntilBurst || 99) - (b.daysUntilBurst || 99);
  });
}

