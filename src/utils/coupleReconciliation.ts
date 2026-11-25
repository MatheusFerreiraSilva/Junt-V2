import { ExpenseItem, CategoryKey } from '../types/finance';
import { CATEGORIES_BASE } from '../context/FinanceContext';

export interface DuplicateGroup {
  id: string;
  primary: ExpenseItem;
  duplicates: ExpenseItem[];
  reason: string;
  amount: number;
  date: string;
}

// TODO(Etapa 2): Regras de reconciliação v2.3 sob Caixa Único (CoupleSettlementSummary removido)

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

      // Date difference in days
      const dateDiffDays = Math.abs(
        (new Date(a.date).getTime() - new Date(b.date).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Match criteria 1: Same date, exact amount, and same category
      // Match criteria 2: Within 1 day, exact amount, and same description
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

// TODO(Etapa 2): Regras de reconciliação v2.3 sob Caixa Único (calculateCoupleSettlement removido)

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

  // Determine days passed and total days in current month
  const now = new Date();
  const year = parseInt(currentMonth.split('-')[0], 10);
  const month = parseInt(currentMonth.split('-')[1], 10);
  const totalDaysInMonth = new Date(year, month, 0).getDate();

  // If viewing current calendar month, use real today date; else assume 30 days
  const isCurrentMonth =
    now.getFullYear() === year && now.getMonth() + 1 === month;
  const currentDay = isCurrentMonth ? Math.max(1, now.getDate()) : 15;
  const daysRemaining = Math.max(0, totalDaysInMonth - currentDay);

  (Object.keys(categoriesSpending) as CategoryKey[]).forEach((catKey) => {
    const spend = categoriesSpending[catKey];
    if (!spend || spend.budget <= 0) return;

    const catBase = CATEGORIES_BASE[catKey];
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
      // Days needed at current burn rate to reach budget limit
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
        categoryName: catBase?.name || catKey,
        categoryEmoji: catBase?.emoji || '💳',
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

  // Sort by most critical first
  return alerts.sort((a, b) => {
    if (a.severity === 'critical' && b.severity !== 'critical') return -1;
    if (b.severity === 'critical' && a.severity !== 'critical') return 1;
    return (a.daysUntilBurst || 99) - (b.daysUntilBurst || 99);
  });
}
