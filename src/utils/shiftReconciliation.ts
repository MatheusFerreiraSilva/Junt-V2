import type {
  BoostTransfer,
  BudgetCycle,
  Goal,
  HouseholdConfig,
  IncomeItem,
  MedicalShift,
  MedicalShiftRecord,
  ShiftIncomeAllocation,
  SurplusRouting,
} from '../types/finance';
import {
  evaluateWaterfall,
  resolveHouseholdConfig,
  roundMoney,
  type PartnerWalletInput,
  type WaterfallEvaluationResult,
} from '../domain/waterfallEngine';
import { getCycleIdFromDate, transitionShiftStatus } from './shiftsEngine';

// =============================================================================
// CONCILIAÇÃO v2.3 DE PLANTÕES COM CAIXA & CASCATA 60/30/10
// =============================================================================

export interface ReconcileShiftPaymentParams {
  shifts: MedicalShiftRecord[];
  shiftId: string;
  paidAt: string;
  cycleId?: string;
  actualNetAmount?: number;
  settledBaseIncomesTotal?: number;
  previousMonthCarryOver?: number;
  historicalNetIncomes?: number[];
  householdConfig?: Partial<HouseholdConfig>;
  housingTotal?: number;
  essentialFixedTotal?: number;
  cancelableFixedTotal?: number;
  installmentsTotal?: number;
  groceriesBudget?: number;
  routineBudget?: number;
  unexpectedBufferLimit?: number;
  unexpectedBufferSpent?: number;
  wave?: 1 | 2;
  goals?: Goal[];
  sharedAllowanceExpensesTotal?: number;
  boostTransfers?: BoostTransfer[];
  partnerA?: PartnerWalletInput;
  partnerB?: PartnerWalletInput;
  surplusRouting?: SurplusRouting;
}

export interface ReconcileShiftPaymentResult {
  updatedShift: MedicalShiftRecord;
  updatedShifts: MedicalShiftRecord[];
  cycleId: string;
  budgetCycle: BudgetCycle;
  waterfallResult: WaterfallEvaluationResult;
}

/**
 * Marca um plantão como "paid", registra `paidAt`, e recalcula imediatamente o BudgetCycle
 * do mês de recebimento via waterfallEngine.evaluateWaterfall.
 */
export function reconcileShiftPayment(
  params: ReconcileShiftPaymentParams
): ReconcileShiftPaymentResult {
  const target = params.shifts.find((s) => s.id === params.shiftId);
  if (!target) {
    throw new Error(`Plantão "${params.shiftId}" não encontrado para baixa.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test((params.paidAt || '').trim())) {
    throw new Error('Data de pagamento inválida. Informe YYYY-MM-DD.');
  }

  const config = resolveHouseholdConfig(params.householdConfig);
  const paidDate = params.paidAt.trim();
  const cycleId = params.cycleId ?? getCycleIdFromDate(paidDate, config.cycleStartDay);

  let updatedShift = transitionShiftStatus(target, 'paid', paidDate);
  if (params.actualNetAmount !== undefined && Number.isFinite(params.actualNetAmount)) {
    const safeNet = Math.max(0.01, roundMoney(params.actualNetAmount));
    updatedShift = {
      ...updatedShift,
      netAmount: safeNet,
      grossAmount: Math.max(updatedShift.grossAmount, safeNet),
    };
  }

  const updatedShifts = params.shifts.map((s) =>
    s.id === params.shiftId ? updatedShift : s
  );

  // Apenas plantões "paid" realizados no cycleId alvo compõem o newNetIncome deste ciclo.
  // Plantões scheduled/pending_payment continuam sendo enviados apenas para cálculo de a receber.
  const shiftsForCycleWaterfall = updatedShifts.filter((s) => {
    if (s.status !== 'paid') return true;
    const cashCycle = getCycleIdFromDate(
      s.paidAt || s.expectedPayDate,
      config.cycleStartDay
    );
    return cashCycle === cycleId;
  });

  const groceriesBudget = Math.max(0, roundMoney(params.groceriesBudget ?? 0));
  const routineBudget = Math.max(0, roundMoney(params.routineBudget ?? 0));
  const unexpectedBufferSpent = Math.max(
    0,
    roundMoney(params.unexpectedBufferSpent ?? 0)
  );
  const unexpectedBufferLimit = Math.max(
    unexpectedBufferSpent,
    roundMoney(params.unexpectedBufferLimit ?? unexpectedBufferSpent)
  );

  const waterfallResult = evaluateWaterfall({
    householdConfig: config,
    liquidity: {
      settledIncomesTotal: params.settledBaseIncomesTotal ?? 0,
      shifts: shiftsForCycleWaterfall,
      defaultShiftTaxRate: config.defaultShiftTaxRate,
      previousMonthCarryOver: params.previousMonthCarryOver ?? 0,
      historicalNetIncomes: params.historicalNetIncomes ?? [],
    },
    housingTotal: params.housingTotal ?? 0,
    essentialFixedTotal: params.essentialFixedTotal ?? 0,
    cancelableFixedTotal: params.cancelableFixedTotal ?? 0,
    installmentsTotal: params.installmentsTotal ?? 0,
    groceriesAmount: groceriesBudget,
    routineAmount: routineBudget,
    bufferAmount: unexpectedBufferSpent,
    wave: params.wave ?? 2,
    goals: params.goals ?? [],
    sharedAllowanceExpensesTotal: params.sharedAllowanceExpensesTotal ?? 0,
    boostTransfers: params.boostTransfers ?? [],
    partnerA: params.partnerA,
    partnerB: params.partnerB,
    surplusRouting: params.surplusRouting ?? 'carry_over',
  });

  const budgetCycle: BudgetCycle = {
    newNetIncome: waterfallResult.liquidity.newNetIncome,
    previousMonthCarryOver: waterfallResult.liquidity.previousMonthCarryOver,
    totalAvailableCash: waterfallResult.liquidity.totalAvailableCash,
    mandatoryGoalAmount: waterfallResult.mandatoryGoal.mandatoryGoalAmount,
    housingTotal: waterfallResult.guards.housing.total,
    essentialFixedTotal: waterfallResult.guards.structure.essentialFixedTotal,
    cancelableFixedTotal: waterfallResult.guards.structure.cancelableFixedTotal,
    installmentsTotal: waterfallResult.guards.installments.total,
    groceriesBudget,
    routineBudget,
    unexpectedBufferLimit,
    unexpectedBufferSpent,
    unlockedAllowanceA: waterfallResult.allowance.unlockedAllowanceA,
    unlockedAllowanceB: waterfallResult.allowance.unlockedAllowanceB,
    boostTransfers: params.boostTransfers ? [...params.boostTransfers] : [],
    closingSurplus: waterfallResult.closingLedgers.closingSurplus,
    surplusRouting: waterfallResult.closingLedgers.surplusRouting,
  };

  return {
    updatedShift,
    updatedShifts,
    cycleId,
    budgetCycle,
    waterfallResult,
  };
}

// =============================================================================
// ADAPTADORES DE TRANSIÇÃO LEGADA (FinanceContext / testes existentes)
// =============================================================================

const cents = (value: number) => Math.round(value * 100);

export function applyShiftAllocation(
  shifts: MedicalShift[],
  incomes: IncomeItem[],
  ledgers: ShiftIncomeAllocation[],
  shiftId: string,
  incomeId: string,
  amount?: number
) {
  const shift = shifts.find((s) => s.id === shiftId);
  const income = incomes.find((i) => i.id === incomeId);
  if (!shift || !income || income.recipient !== shift.partner) {
    throw new Error('Selecione um recebimento do parceiro deste plantão.');
  }
  if (
    income.classification === 'resgate_principal' ||
    income.classification === 'principal_redemption' ||
    income.status === 'internal_transfer' ||
    /resgate/i.test(income.description || '')
  ) {
    throw new Error(
      'Resgates de caixinhas ou investimentos não podem ser conciliados como remuneração de plantão.'
    );
  }
  if (shift.executionStatus && shift.executionStatus !== 'performed') {
    throw new Error('Somente um plantão realizado pode ser conciliado.');
  }
  if (
    shift.dateWorked > income.date ||
    shift.dateWorked >
      [
        new Date().getFullYear(),
        String(new Date().getMonth() + 1).padStart(2, '0'),
        String(new Date().getDate()).padStart(2, '0'),
      ].join('-')
  ) {
    throw new Error('O plantão precisa ter sido realizado antes do recebimento.');
  }
  const next = ledgers.map((l) => ({ ...l, allocations: { ...l.allocations } }));
  let ledger = next.find((l) => l.id === incomeId);
  if (!ledger) {
    ledger = { id: incomeId, allocations: {} };
    next.push(ledger);
  }
  if (ledger.allocations[shiftId] !== undefined) return { shifts, ledgers };
  const allocatedIncome = Object.values(ledger.allocations).reduce(
    (sum, value) => sum + value,
    0
  );
  const receivedShift = next.reduce(
    (sum, entry) => sum + (entry.allocations[shiftId] || 0),
    0
  );
  const expectedValue =
    shift.netAmount !== undefined ? shift.netAmount : shift.grossAmount;
  const expectedCents = cents(expectedValue);
  const outstanding = Math.max(0, expectedCents - receivedShift);
  const available = Math.max(0, cents(income.amount) - allocatedIncome);
  const allocation =
    amount === undefined ? Math.min(outstanding, available) : cents(amount);
  if (
    !Number.isFinite(allocation) ||
    allocation <= 0 ||
    allocation > available ||
    allocation > outstanding
  ) {
    throw new Error(
      'O valor excede o saldo do recebimento ou o pendente do plantão.'
    );
  }
  ledger.allocations[shiftId] = allocation;
  return {
    ledgers: next,
    shifts: shifts.map((item) => {
      if (item.id !== shiftId) return item;
      const received = receivedShift + allocation;
      const itemExpected =
        item.netAmount !== undefined ? item.netAmount : item.grossAmount;
      const itemExpectedCents = cents(itemExpected);
      const itemPendingCents = Math.max(0, itemExpectedCents - received);
      const itemOverallocatedCents = Math.max(0, received - itemExpectedCents);
      return {
        ...item,
        status:
          received >= itemExpectedCents
            ? ('received' as const)
            : ('pending' as const),
        reconciledAmount: received / 100,
        pendingAmount: itemPendingCents / 100,
        overallocatedAmount: itemOverallocatedCents / 100,
        actualPayDate: income.date,
        linkedIncomeId: incomeId,
        linkedIncomeDescription: income.description,
      };
    }),
  };
}

export function undoShiftAllocations(
  shifts: MedicalShift[],
  ledgers: ShiftIncomeAllocation[],
  shiftId: string
) {
  return {
    ledgers: ledgers.map((ledger) => {
      const allocations = { ...ledger.allocations };
      delete allocations[shiftId];
      return { ...ledger, allocations };
    }),
    shifts: shifts.map((shift) => {
      if (shift.id !== shiftId) return shift;
      const expected =
        shift.netAmount !== undefined ? shift.netAmount : shift.grossAmount;
      return {
        ...shift,
        status: 'pending' as const,
        reconciledAmount: 0,
        pendingAmount: expected,
        overallocatedAmount: 0,
        actualPayDate: undefined,
        linkedIncomeId: undefined,
        linkedIncomeDescription: undefined,
      };
    }),
  };
}

export function migrateLegacyShiftAllocations(
  shifts: MedicalShift[],
  incomes: IncomeItem[],
  ledgers: ShiftIncomeAllocation[]
) {
  const next = ledgers.map((ledger) => ({
    ...ledger,
    allocations: { ...ledger.allocations },
  }));
  for (const shift of shifts) {
    if (
      !shift.linkedIncomeId ||
      next.some((ledger) => ledger.allocations[shift.id] !== undefined)
    )
      continue;
    const income = incomes.find((item) => item.id === shift.linkedIncomeId);
    if (!income || income.recipient !== shift.partner) continue;
    let ledger = next.find((item) => item.id === income.id);
    if (!ledger) {
      ledger = { id: income.id, allocations: {} };
      next.push(ledger);
    }
    const available = Math.max(
      0,
      cents(income.amount) -
        Object.values(ledger.allocations).reduce((sum, value) => sum + value, 0)
    );
    const expected = cents(
      shift.netAmount !== undefined ? shift.netAmount : shift.grossAmount
    );
    const allocated = Math.min(available, expected);
    if (allocated > 0) ledger.allocations[shift.id] = allocated;
  }
  return next;
}
