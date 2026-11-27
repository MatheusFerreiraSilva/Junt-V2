import {
  addCyclesToCycleId,
  evaluateWaterfall,
  resolveHouseholdConfig,
  roundMoney,
  type WaterfallEvaluationResult,
} from '../domain/waterfallEngine';
import {
  calculateShieldMetrics,
  routeMonthlyInvestments,
  type RouteInvestmentsResult,
  type ShieldMetricsResult,
} from '../domain/shieldEngine';
import { formatMonthYear } from './formatters';
import type {
  AllowanceExpense,
  AllowanceWallet,
  BudgetCycle,
  CategoryKey,
  ExpenseItem,
  FixedBillAlert,
  Goal,
  GoalContribution,
  HouseholdConfig,
  HouseholdTransaction,
  IncomeItem,
  InstallmentPlan,
  InstallmentPurchase,
  MedicalShiftRecord,
  SavingsPiggyBank,
  SharedAllowanceExpense,
  TransactionBucket,
  V23DualLedgerHistoryPoint,
  V23WorkspacePreferences,
} from '../types/finance';

export const DEFAULT_V23_PREFERENCES: V23WorkspacePreferences = {
  wave2Day: 15,
  defaultGroceriesBudget: 1800,
  defaultRoutineBudget: 1200,
  defaultBufferLimit: 500,
  favoriteHospitals: ['Hospital Albert Einstein', 'Hospital Sírio-Libanês', 'UPA Central'],
  allowanceWaveOverrideByCycle: {},
};

export function monthKeyToCycleId(monthKey: string): string {
  if (!monthKey) return '2026_01';
  if (monthKey.includes('_')) return monthKey;
  return monthKey.replace('-', '_');
}

export function cycleIdToMonthKey(cycleId: string): string {
  if (!cycleId) return '2026-01';
  if (cycleId.includes('-')) return cycleId;
  return cycleId.replace('_', '-');
}

export const TRANSACTION_BUCKET_META: Record<
  TransactionBucket,
  { label: string; shortLabel: string; description: string; isEssentialForShield: boolean }
> = {
  housing: {
    label: 'Moradia',
    shortLabel: 'Moradia',
    description: 'Aluguel, condomínio, IPTU e manutenção da casa (teto 30%)',
    isEssentialForShield: true,
  },
  fixed_essential: {
    label: 'Fixo Essencial',
    shortLabel: 'Essencial',
    description: 'Luz, água, internet, planos de saúde e seguros',
    isEssentialForShield: true,
  },
  fixed_cancelable: {
    label: 'Fixo Cancelável',
    shortLabel: 'Cancelável',
    description: 'Streamings, assinaturas e apps (Fora da Reserva)',
    isEssentialForShield: false,
  },
  groceries: {
    label: 'Compra do Mês',
    shortLabel: 'Mercado',
    description: 'Supermercado, açougue, feira e abastecimento mensal',
    isEssentialForShield: true,
  },
  routine: {
    label: 'Rotina',
    shortLabel: 'Rotina',
    description: 'Transporte, farmácia, alimentação do dia a dia e plantões',
    isEssentialForShield: true,
  },
  buffer: {
    label: 'Buffer de Imprevistos',
    shortLabel: 'Buffer',
    description: 'Colchão rápido para pequenos imprevistos sem mexer no Escudo',
    isEssentialForShield: true,
  },
};

export function mapCategoryToBucket(
  category: CategoryKey,
  nature?: ExpenseItem['nature'],
  priority?: ExpenseItem['priority']
): TransactionBucket {
  if (category === 'moradia') return 'housing';
  if (category === 'comida') {
    return nature === 'fixa' || nature === 'fixo' ? 'groceries' : 'groceries';
  }
  if (category === 'lazer') {
    return nature === 'fixa' || nature === 'fixo' || priority === 'dispensavel' || priority === 'desejo'
      ? 'fixed_cancelable'
      : 'routine';
  }
  if (category === 'protecao') {
    return nature === 'fixa' || nature === 'fixo' ? 'fixed_essential' : 'buffer';
  }
  if (category === 'profissional' || category === 'transporte') {
    return nature === 'fixa' || nature === 'fixo' ? 'fixed_essential' : 'routine';
  }
  return 'routine';
}

export function mapBucketToCategory(bucket: TransactionBucket): CategoryKey {
  switch (bucket) {
    case 'housing':
      return 'moradia';
    case 'fixed_essential':
      return 'protecao';
    case 'fixed_cancelable':
      return 'lazer';
    case 'groceries':
      return 'comida';
    case 'buffer':
      return 'protecao';
    case 'routine':
    default:
      return 'transporte';
  }
}

export function resolveActiveWaveForCycle(params: {
  cycleId: string;
  currentMonthKey: string;
  wave2Day: number;
  overrideByCycle?: Record<string, 1 | 2>;
  now?: Date;
}): 1 | 2 {
  const override = params.overrideByCycle?.[params.cycleId];
  if (override === 1 || override === 2) return override;

  const targetMonth = cycleIdToMonthKey(params.cycleId);
  const today = params.now ?? new Date();
  const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  if (targetMonth < currentYm) return 2;
  if (targetMonth > currentYm) return 1;
  return today.getDate() >= Math.max(2, Math.min(28, params.wave2Day || 15)) ? 2 : 1;
}

export function mergeV23Goals(
  remoteGoals: Goal[],
  piggyBanks: SavingsPiggyBank[],
  protectionCurrentAmount: number,
  shieldTargetAmount: number
): Goal[] {
  const byId = new Map<string, Goal>();
  for (const g of remoteGoals) {
    if (g.id) byId.set(g.id, g);
  }

  // Ensure a canonical Shield goal exists if none is present yet
  const hasShield = Array.from(byId.values()).some((g) => g.pillar === 'shield');
  if (!hasShield) {
    byId.set('goal_escudo_principal', {
      id: 'goal_escudo_principal',
      title: 'Escudo de Segurança',
      pillar: 'shield',
      targetAmount: roundMoney(Math.max(shieldTargetAmount, protectionCurrentAmount, 10000)),
      currentAmount: roundMoney(Math.max(0, protectionCurrentAmount)),
      deadline: null,
      autoAllocateWeight: 50,
    });
  }

  for (const pb of piggyBanks) {
    if (!pb || pb.archived || pb.isDeleted) continue;
    if (!byId.has(pb.id)) {
      byId.set(pb.id, {
        id: pb.id,
        title: pb.name,
        pillar: pb.isFireEligible ? 'wealth' : 'dreams',
        targetAmount: roundMoney(pb.targetAmount || 0),
        currentAmount: roundMoney(pb.currentAmount || 0),
        deadline: pb.deadlineDate ?? null,
        autoAllocateWeight: pb.monthlyDeposit > 0 ? pb.monthlyDeposit : 25,
      });
    }
  }

  return Array.from(byId.values());
}

export function mergeV23InstallmentPlans(
  remotePlans: InstallmentPlan[],
  legacyInstallments: InstallmentPurchase[]
): InstallmentPlan[] {
  const byId = new Map<string, InstallmentPlan>();
  for (const plan of remotePlans) {
    const id = plan.id || plan.importHash || plan.title;
    byId.set(id, { ...plan, id });
  }

  for (const inst of legacyInstallments) {
    if (!inst || !inst.active) continue;
    if (inst.requestId?.startsWith('csv-hash:') || inst.requestId?.startsWith('v23:')) {
      // Avoid duplicating if already added via remotePlans
      const matching = Array.from(byId.values()).some(
        (p) => p.importHash && inst.requestId?.endsWith(p.importHash)
      );
      if (matching) continue;
    }
    const totalCount = Math.max(1, inst.installmentsCount ?? inst.totalInstallments ?? 1);
    const installmentAmount = roundMoney(
      inst.installmentAmount ?? inst.installmentValue ?? (inst.totalAmount || 0) / totalCount
    );
    const startCycleId = monthKeyToCycleId(
      inst.startMonth || (inst.firstPaymentDate ? inst.firstPaymentDate.slice(0, 7) : '2026-01')
    );
    const endCycleId = addCyclesToCycleId(startCycleId, totalCount - 1);
    const paidCount = Math.min(totalCount, Math.max(0, inst.paidInstallmentsCount || 0));

    byId.set(inst.id, {
      id: inst.id,
      title: inst.title || inst.description || 'Parcelamento',
      installmentAmount,
      currentInstallment: Math.min(totalCount, paidCount + 1),
      totalInstallments: totalCount,
      startCycleId,
      endCycleId,
      importHash: inst.requestId ?? null,
    });
  }

  return Array.from(byId.values());
}

export function isPlanActiveInCycle(plan: InstallmentPlan, cycleId: string): boolean {
  if (!plan.startCycleId || !plan.endCycleId) return false;
  return cycleId >= plan.startCycleId && cycleId <= plan.endCycleId;
}

export function computeCycleInputsFromWorkspace(params: {
  cycleId: string;
  householdConfig: HouseholdConfig;
  preferences: V23WorkspacePreferences;
  storedCycle?: BudgetCycle;
  transactions: HouseholdTransaction[];
  legacyExpenses: ExpenseItem[];
  fixedBills: FixedBillAlert[];
  installmentPlans: InstallmentPlan[];
  incomes: IncomeItem[];
  declaredMonthlyIncomeFallback: number;
  shifts: MedicalShiftRecord[];
  sharedAllowanceExpenses: SharedAllowanceExpense[];
  myAllowanceExpenses: AllowanceExpense[];
  myAllowanceWallet?: AllowanceWallet;
  goals: Goal[];
  uid: string;
  partnerUid: string;
  historicalCycles: Array<{ cycleId: string; newNetIncome: number; cycle?: BudgetCycle }>;
}): {
  waterfall: WaterfallEvaluationResult;
  shield: ShieldMetricsResult;
  investmentRouting: RouteInvestmentsResult;
  cycleRecord: BudgetCycle;
  bucketBreakdown: Record<TransactionBucket, number>;
} {
  const monthKey = cycleIdToMonthKey(params.cycleId);
  const config = resolveHouseholdConfig(params.householdConfig);

  // 1. Transactions in cycle (avoid double counting v2.3/csv expenses mirrored into state.expenses)
  const v23TxInCycle = params.transactions.filter((tx) => tx.cycleId === params.cycleId);
  const v23Hashes = new Set(
    v23TxInCycle.map((tx) => tx.importHash).filter((h): h is string => Boolean(h))
  );

  const bucketBreakdown: Record<TransactionBucket, number> = {
    housing: 0,
    fixed_essential: 0,
    fixed_cancelable: 0,
    groceries: 0,
    routine: 0,
    buffer: 0,
  };

  for (const tx of v23TxInCycle) {
    bucketBreakdown[tx.bucket] = roundMoney((bucketBreakdown[tx.bucket] || 0) + tx.amount);
  }

  for (const exp of params.legacyExpenses) {
    if (!exp || exp.isSplitParent || exp.isExcludedFromMonthlyBudget) continue;
    if (exp.fundingSource === 'personal_allowance') continue;
    if ((exp.date || '').slice(0, 7) !== monthKey) continue;
    if (exp.operationId?.startsWith('csv-hash:') && v23Hashes.has(exp.operationId.slice('csv-hash:'.length))) {
      continue;
    }
    if (exp.operationId?.startsWith('v23:') && v23Hashes.has(exp.operationId.slice('v23:'.length))) {
      continue;
    }
    const bucket = mapCategoryToBucket(exp.category, exp.nature, exp.priority);
    bucketBreakdown[bucket] = roundMoney((bucketBreakdown[bucket] || 0) + (exp.amount || 0));
  }

  // Add fixed bills configured by couple that aren't paid via an already-counted expense
  for (const bill of params.fixedBills) {
    if (!bill || bill.active === false) continue;
    const occ = bill.history?.[monthKey];
    if (occ?.linkedExpenseId) continue;
    if (occ?.status === 'paid') continue;
    const amount = roundMoney(bill.amount || 0);
    if (amount <= 0) continue;
    if (bill.category === 'moradia') {
      bucketBreakdown.housing = roundMoney(bucketBreakdown.housing + amount);
    } else if (bill.category === 'lazer') {
      bucketBreakdown.fixed_cancelable = roundMoney(bucketBreakdown.fixed_cancelable + amount);
    } else {
      bucketBreakdown.fixed_essential = roundMoney(bucketBreakdown.fixed_essential + amount);
    }
  }

  // 2. Active installments in this cycle
  const installmentsTotal = roundMoney(
    params.installmentPlans
      .filter((plan) => isPlanActiveInCycle(plan, params.cycleId))
      .reduce((sum, plan) => sum + Math.max(0, plan.installmentAmount || 0), 0)
  );

  // 3. Settled incomes (excluding internal transfers & unlinked/shift duplicates)
  const settledIncomesList = params.incomes.filter((inc) => {
    if (!inc) return false;
    if ((inc.date || '').slice(0, 7) !== monthKey) return false;
    if (inc.status === 'internal_transfer' || inc.status === 'pending' || inc.status === 'projected') {
      return false;
    }
    if (inc.classification === 'internal_transfer' || inc.classification === 'forecast') {
      return false;
    }
    if (inc.linkedShiftId) return false;
    return true;
  });

  const settledIncomesFromList = settledIncomesList.reduce(
    (sum, inc) => sum + Math.max(0, inc.amount || 0),
    0
  );

  // Only count shifts belonging to this cycle (or paid in this cycle)
  const shiftsInCycle = params.shifts.filter((s) => {
    const paidCycle = s.paidAt ? monthKeyToCycleId(s.paidAt.slice(0, 7)) : null;
    const shiftCycle = monthKeyToCycleId((s.shiftDate || s.expectedPayDate || '').slice(0, 7));
    if (s.status === 'paid') {
      return (paidCycle || shiftCycle) === params.cycleId;
    }
    return shiftCycle === params.cycleId;
  });

  const paidShiftsTotal = shiftsInCycle
    .filter((s) => s.status === 'paid')
    .reduce((sum, s) => sum + (s.netAmount || s.grossAmount || 0), 0);

  const settledBaseTotal =
    settledIncomesFromList + paidShiftsTotal > 0 || (params.storedCycle?.newNetIncome ?? 0) > 0
      ? Math.max(settledIncomesFromList, (params.storedCycle?.newNetIncome ?? 0) - paidShiftsTotal)
      : params.declaredMonthlyIncomeFallback;

  const prevCarryOver = params.storedCycle?.previousMonthCarryOver ?? 0;

  // 4. Wave & Allowance inputs
  const activeWave = resolveActiveWaveForCycle({
    cycleId: params.cycleId,
    currentMonthKey: monthKey,
    wave2Day: params.preferences.wave2Day,
    overrideByCycle: params.preferences.allowanceWaveOverrideByCycle,
  });

  const sharedAllowanceExpensesTotal = roundMoney(
    params.sharedAllowanceExpenses
      .filter((item) => item.cycleId === params.cycleId)
      .reduce((sum, item) => sum + Math.max(0, item.totalAmount || 0), 0)
  );

  const mySoloInCycle = params.myAllowanceExpenses.filter((item) => item.cycleId === params.cycleId);
  const mySoloNonInstallment = roundMoney(
    mySoloInCycle
      .filter((e) => !e.installmentInfo)
      .reduce((sum, e) => sum + Math.max(0, e.amount || 0), 0)
  );
  const myPersonalInstallments = roundMoney(
    mySoloInCycle
      .filter((e) => Boolean(e.installmentInfo))
      .reduce((sum, e) => sum + Math.max(0, e.amount || 0), 0)
  );

  const groceriesAmount = roundMoney(
    Math.max(
      bucketBreakdown.groceries,
      params.storedCycle?.groceriesBudget ?? params.preferences.defaultGroceriesBudget
    )
  );
  const routineAmount = roundMoney(
    Math.max(
      bucketBreakdown.routine,
      params.storedCycle?.routineBudget ?? params.preferences.defaultRoutineBudget
    )
  );
  const bufferLimit = roundMoney(
    params.storedCycle?.unexpectedBufferLimit ?? params.preferences.defaultBufferLimit
  );
  const bufferAmount = roundMoney(Math.max(bucketBreakdown.buffer, bufferLimit));

  const historicalNetIncomes = params.historicalCycles
    .filter((c) => c.cycleId < params.cycleId)
    .sort((a, b) => a.cycleId.localeCompare(b.cycleId))
    .map((c) => c.newNetIncome);

  const waterfall = evaluateWaterfall({
    householdConfig: config,
    liquidity: {
      settledIncomesTotal: settledBaseTotal,
      shifts: shiftsInCycle,
      defaultShiftTaxRate: config.defaultShiftTaxRate,
      previousMonthCarryOver: prevCarryOver,
      historicalNetIncomes,
    },
    housingTotal: bucketBreakdown.housing,
    essentialFixedTotal: bucketBreakdown.fixed_essential,
    cancelableFixedTotal: bucketBreakdown.fixed_cancelable,
    installmentsTotal,
    groceriesAmount,
    routineAmount,
    bufferAmount,
    wave: activeWave,
    goals: params.goals,
    sharedAllowanceExpensesTotal,
    boostTransfers: params.storedCycle?.boostTransfers ?? [],
    partnerA: {
      uid: params.uid,
      rolloverFromPrevious: params.myAllowanceWallet?.rolloverFromPrevious ?? 0,
      soloSpent: mySoloNonInstallment,
      personalInstallments: myPersonalInstallments,
      sweptToSharedGoals: params.myAllowanceWallet?.sweptToSharedGoals ?? 0,
    },
    partnerB: {
      uid: params.partnerUid,
      rolloverFromPrevious: 0,
      soloSpent: 0,
      personalInstallments: 0,
      sweptToSharedGoals: 0,
    },
    surplusRouting: params.storedCycle?.surplusRouting ?? 'carry_over',
  });

  const cycleRecord: BudgetCycle = {
    newNetIncome: waterfall.liquidity.newNetIncome,
    previousMonthCarryOver: waterfall.liquidity.previousMonthCarryOver,
    totalAvailableCash: waterfall.liquidity.totalAvailableCash,
    mandatoryGoalAmount: waterfall.mandatoryGoal.mandatoryGoalAmount,
    housingTotal: waterfall.guards.structure.housingTotal,
    essentialFixedTotal: waterfall.guards.structure.essentialFixedTotal,
    cancelableFixedTotal: waterfall.guards.structure.cancelableFixedTotal,
    installmentsTotal: waterfall.guards.structure.installmentsTotal,
    groceriesBudget: groceriesAmount,
    routineBudget: routineAmount,
    unexpectedBufferLimit: bufferLimit,
    unexpectedBufferSpent: bucketBreakdown.buffer,
    unlockedAllowanceA: waterfall.allowance.unlockedAllowanceA,
    unlockedAllowanceB: waterfall.allowance.unlockedAllowanceB,
    boostTransfers: params.storedCycle?.boostTransfers ?? [],
    closingSurplus: waterfall.closingLedgers.closingSurplus,
    surplusRouting: params.storedCycle?.surplusRouting ?? 'carry_over',
  };

  const shieldCycles = [
    ...params.historicalCycles
      .filter((c) => c.cycleId < params.cycleId && c.cycle)
      .slice(-2)
      .map((c) => c.cycle!),
    cycleRecord,
  ];

  const shieldGoalBalance = params.goals
    .filter((g) => g.pillar === 'shield')
    .reduce((sum, g) => sum + Math.max(0, g.currentAmount || 0), 0);

  const shield = calculateShieldMetrics({
    cycles: shieldCycles,
    currentShieldBalance: shieldGoalBalance,
    shieldFloorMonths: config.shieldFloorMonths,
    shieldTargetMonths: config.shieldTargetMonths,
  });

  const investmentRouting = routeMonthlyInvestments({
    mandatoryGoalAmount: waterfall.mandatoryGoal.mandatoryGoalAmount,
    optionalSurplusToInvest:
      cycleRecord.surplusRouting === 'goals'
        ? Math.max(0, waterfall.closingLedgers.closingSurplus)
        : 0,
    partnerAllowanceSweeps: params.myAllowanceWallet?.sweptToSharedGoals ?? 0,
    goals: params.goals,
    shieldMetrics: shield,
    goalAllocationRules: config.goalAllocationRules,
  });

  return {
    waterfall,
    shield,
    investmentRouting,
    cycleRecord,
    bucketBreakdown,
  };
}

export function buildDualLedgerHistory6M(params: {
  activeCycleId: string;
  householdConfig: HouseholdConfig;
  preferences: V23WorkspacePreferences;
  budgetCyclesMap: Record<string, BudgetCycle>;
  transactions: HouseholdTransaction[];
  legacyExpenses: ExpenseItem[];
  fixedBills: FixedBillAlert[];
  installmentPlans: InstallmentPlan[];
  incomes: IncomeItem[];
  declaredMonthlyIncomeFallback: number;
  shifts: MedicalShiftRecord[];
  sharedAllowanceExpenses: SharedAllowanceExpense[];
  myAllowanceExpenses: AllowanceExpense[];
  myAllowanceWallets: Record<string, AllowanceWallet>;
  goals: Goal[];
  uid: string;
  partnerUid: string;
}): V23DualLedgerHistoryPoint[] {
  const points: V23DualLedgerHistoryPoint[] = [];
  const historicalCycles: Array<{ cycleId: string; newNetIncome: number; cycle?: BudgetCycle }> = [];

  for (let offset = -5; offset <= 0; offset++) {
    const cid = addCyclesToCycleId(params.activeCycleId, offset);
    const mKey = cycleIdToMonthKey(cid);
    const evaluated = computeCycleInputsFromWorkspace({
      cycleId: cid,
      householdConfig: params.householdConfig,
      preferences: params.preferences,
      storedCycle: params.budgetCyclesMap[cid],
      transactions: params.transactions,
      legacyExpenses: params.legacyExpenses,
      fixedBills: params.fixedBills,
      installmentPlans: params.installmentPlans,
      incomes: params.incomes,
      declaredMonthlyIncomeFallback: params.declaredMonthlyIncomeFallback,
      shifts: params.shifts,
      sharedAllowanceExpenses: params.sharedAllowanceExpenses,
      myAllowanceExpenses: params.myAllowanceExpenses,
      myAllowanceWallet: params.myAllowanceWallets[cid],
      goals: params.goals,
      uid: params.uid,
      partnerUid: params.partnerUid,
      historicalCycles,
    });

    historicalCycles.push({
      cycleId: cid,
      newNetIncome: evaluated.waterfall.liquidity.newNetIncome,
      cycle: evaluated.cycleRecord,
    });

    const shortLabel = formatMonthYear(mKey).split(' ')[0].slice(0, 3);
    points.push({
      cycleId: cid,
      monthKey: mKey,
      label: shortLabel.charAt(0).toUpperCase() + shortLabel.slice(1),
      newNetIncome: evaluated.waterfall.liquidity.newNetIncome,
      actualStructureTotal: evaluated.waterfall.guards.structure.actualStructureTotal,
      structureCapAmount: evaluated.waterfall.guards.structure.capAmount,
      savingsBelowCap: evaluated.waterfall.guards.structure.savingsBelowCap,
      commonSurplus: evaluated.waterfall.closingLedgers.closingSurplus,
      personalAllowanceSurplus: evaluated.waterfall.closingLedgers.walletA.closingBalance,
    });
  }

  return points;
}
