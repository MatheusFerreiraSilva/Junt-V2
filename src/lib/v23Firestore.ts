import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type {
  AllowanceExpense,
  AllowanceWallet,
  BoostTransfer,
  BudgetCycle,
  Goal,
  GoalContribution,
  HouseholdConfig,
  HouseholdTransaction,
  InstallmentPlan,
  MedicalShiftRecord,
  SharedAllowanceExpense,
  SurplusRouting,
  TransactionBucket,
} from '../types/finance';
import { resolveHouseholdConfig, roundMoney } from '../domain/waterfallEngine';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(firestoreDb: Firestore = db): Promise<void> {
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

function safeDocId(prefix: string, seed?: string | null): string {
  const clean = (seed || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
  if (clean) return `${prefix}_${clean}`.slice(0, 128);
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function serializeHouseholdPayload(
  householdId: string,
  config: HouseholdConfig
): Record<string, unknown> {
  const resolved = resolveHouseholdConfig(config);
  return {
    id: householdId,
    memberUids: resolved.memberUids.slice(0, 2),
    memberTaxIds: resolved.memberTaxIds.slice(0, 20),
    cycleStartDay: Math.max(1, Math.min(28, Math.trunc(resolved.cycleStartDay))),
    mandatoryGoalRate: resolved.mandatoryGoalRate,
    housingCapRate: resolved.housingCapRate,
    structureCapRate: resolved.structureCapRate,
    installmentCapMin: resolved.installmentCapMin,
    installmentCapMax: resolved.installmentCapMax,
    installmentCapTarget: resolved.installmentCapTarget,
    allowanceFloor: roundMoney(resolved.allowanceFloor),
    allowanceCap: roundMoney(resolved.allowanceCap),
    shieldFloorMonths: resolved.shieldFloorMonths,
    shieldTargetMonths: resolved.shieldTargetMonths,
    defaultShiftTaxRate: resolved.defaultShiftTaxRate,
    goalAllocationRules: resolved.goalAllocationRules.map((rule) => ({
      goalId: rule.goalId,
      weight: rule.weight,
      ...(rule.fixedAmount !== undefined ? { fixedAmount: roundMoney(rule.fixedAmount) } : {}),
    })),
  };
}

function serializeBudgetCyclePayload(cycle: BudgetCycle): BudgetCycle {
  return {
    newNetIncome: roundMoney(cycle.newNetIncome ?? 0),
    previousMonthCarryOver: roundMoney(cycle.previousMonthCarryOver ?? 0),
    totalAvailableCash: roundMoney(cycle.totalAvailableCash ?? 0),
    mandatoryGoalAmount: roundMoney(cycle.mandatoryGoalAmount ?? 0),
    housingTotal: roundMoney(cycle.housingTotal ?? 0),
    essentialFixedTotal: roundMoney(cycle.essentialFixedTotal ?? 0),
    cancelableFixedTotal: roundMoney(cycle.cancelableFixedTotal ?? 0),
    installmentsTotal: roundMoney(cycle.installmentsTotal ?? 0),
    groceriesBudget: roundMoney(cycle.groceriesBudget ?? 0),
    routineBudget: roundMoney(cycle.routineBudget ?? 0),
    unexpectedBufferLimit: roundMoney(cycle.unexpectedBufferLimit ?? 0),
    unexpectedBufferSpent: roundMoney(cycle.unexpectedBufferSpent ?? 0),
    unlockedAllowanceA: roundMoney(cycle.unlockedAllowanceA ?? 0),
    unlockedAllowanceB: roundMoney(cycle.unlockedAllowanceB ?? 0),
    boostTransfers: (cycle.boostTransfers ?? []).map((b) => ({
      fromUid: b.fromUid,
      toUid: b.toUid,
      amount: roundMoney(b.amount),
      createdAt: b.createdAt,
    })),
    closingSurplus: roundMoney(cycle.closingSurplus ?? 0),
    surplusRouting: cycle.surplusRouting === 'goals' ? 'goals' : 'carry_over',
  };
}

function serializeWalletPayload(wallet: AllowanceWallet): AllowanceWallet {
  const rolloverFromPrevious = roundMoney(wallet.rolloverFromPrevious ?? 0);
  const monthlyAllocation = Math.max(0, roundMoney(wallet.monthlyAllocation ?? 0));
  const boostsNet = roundMoney(wallet.boostsNet ?? 0);
  const soloSpent = Math.max(0, roundMoney(wallet.soloSpent ?? 0));
  const jointAllowanceShareSpent = Math.max(0, roundMoney(wallet.jointAllowanceShareSpent ?? 0));
  const sweptToSharedGoals = Math.max(0, roundMoney(wallet.sweptToSharedGoals ?? 0));
  return {
    rolloverFromPrevious,
    monthlyAllocation,
    boostsNet,
    soloSpent,
    jointAllowanceShareSpent,
    sweptToSharedGoals,
    closingBalance: roundMoney(
      rolloverFromPrevious +
        monthlyAllocation +
        boostsNet -
        soloSpent -
        jointAllowanceShareSpent -
        sweptToSharedGoals
    ),
  };
}

export interface HouseholdWorkspaceSnapshotCallbacks {
  onHousehold?: (config: HouseholdConfig | null) => void;
  onBudgetCycles?: (cycles: Record<string, BudgetCycle>) => void;
  onTransactions?: (transactions: HouseholdTransaction[]) => void;
  onSharedAllowanceExpenses?: (expenses: SharedAllowanceExpense[]) => void;
  onInstallmentPlans?: (plans: InstallmentPlan[]) => void;
  onMedicalShifts?: (shifts: MedicalShiftRecord[]) => void;
  onGoals?: (goals: Goal[]) => void;
  onGoalContributions?: (contributions: GoalContribution[]) => void;
  onMyAllowanceWallets?: (wallets: Record<string, AllowanceWallet>) => void;
  onMyAllowanceExpenses?: (expenses: AllowanceExpense[]) => void;
  onError?: (error: Error) => void;
}

/**
 * Inscreve em tempo real nas coleções compartilhadas do household e APENAS na
 * carteira/gastos privados do próprio `uid` autenticado (Zero-Surveillance).
 */
export function subscribeHouseholdWorkspace(
  firestore: Firestore,
  householdId: string,
  uid: string,
  callbacks: HouseholdWorkspaceSnapshotCallbacks
): Unsubscribe {
  const unsubscribers: Unsubscribe[] = [];
  const reportError = (err: unknown, op: OperationType, path: string) => {
    try {
      handleFirestoreError(err, op, path);
    } catch (wrapped) {
      callbacks.onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
    }
  };

  if (householdId) {
    const householdPath = `households/${householdId}`;
    unsubscribers.push(
      onSnapshot(
        doc(firestore, householdPath),
        (snap) => {
          if (!snap.exists()) {
            callbacks.onHousehold?.(null);
            return;
          }
          callbacks.onHousehold?.(resolveHouseholdConfig({ ...(snap.data() as HouseholdConfig), id: snap.id }));
        },
        (err) => reportError(err, OperationType.GET, householdPath)
      )
    );

    const cyclesPath = `households/${householdId}/budget_cycles`;
    unsubscribers.push(
      onSnapshot(
        collection(firestore, cyclesPath),
        (snap) => {
          const map: Record<string, BudgetCycle> = {};
          snap.forEach((d) => {
            map[d.id] = d.data() as BudgetCycle;
          });
          callbacks.onBudgetCycles?.(map);
        },
        (err) => reportError(err, OperationType.LIST, cyclesPath)
      )
    );

    const txPath = `households/${householdId}/transactions`;
    unsubscribers.push(
      onSnapshot(
        collection(firestore, txPath),
        (snap) => {
          const items: HouseholdTransaction[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<HouseholdTransaction, 'id'>),
          }));
          items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          callbacks.onTransactions?.(items);
        },
        (err) => reportError(err, OperationType.LIST, txPath)
      )
    );

    const sharedPath = `households/${householdId}/shared_allowance_expenses`;
    unsubscribers.push(
      onSnapshot(
        collection(firestore, sharedPath),
        (snap) => {
          const items: SharedAllowanceExpense[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SharedAllowanceExpense, 'id'>),
          }));
          items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          callbacks.onSharedAllowanceExpenses?.(items);
        },
        (err) => reportError(err, OperationType.LIST, sharedPath)
      )
    );

    const plansPath = `households/${householdId}/installment_plans`;
    unsubscribers.push(
      onSnapshot(
        collection(firestore, plansPath),
        (snap) => {
          const items: InstallmentPlan[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<InstallmentPlan, 'id'>),
          }));
          callbacks.onInstallmentPlans?.(items);
        },
        (err) => reportError(err, OperationType.LIST, plansPath)
      )
    );

    const shiftsPath = `households/${householdId}/shifts`;
    unsubscribers.push(
      onSnapshot(
        collection(firestore, shiftsPath),
        (snap) => {
          const items: MedicalShiftRecord[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<MedicalShiftRecord, 'id'>),
          }));
          items.sort((a, b) => (b.shiftDate || '').localeCompare(a.shiftDate || ''));
          callbacks.onMedicalShifts?.(items);
        },
        (err) => reportError(err, OperationType.LIST, shiftsPath)
      )
    );

    const goalsPath = `households/${householdId}/goals`;
    unsubscribers.push(
      onSnapshot(
        collection(firestore, goalsPath),
        (snap) => {
          const items: Goal[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Goal, 'id'>),
          }));
          callbacks.onGoals?.(items);
        },
        (err) => reportError(err, OperationType.LIST, goalsPath)
      )
    );

    const contribPath = `households/${householdId}/goal_contributions`;
    unsubscribers.push(
      onSnapshot(
        collection(firestore, contribPath),
        (snap) => {
          const items: GoalContribution[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<GoalContribution, 'id'>),
          }));
          items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          callbacks.onGoalContributions?.(items);
        },
        (err) => reportError(err, OperationType.LIST, contribPath)
      )
    );
  }

  // PRIVACIDADE BLINDADA: nunca ler ou assinar /users/{partnerUid}/allowance_*
  const activeAuthUid = auth?.currentUser?.uid;
  if (uid && (!activeAuthUid || activeAuthUid === uid)) {
    const myWalletsPath = `users/${uid}/allowance_wallets`;
    unsubscribers.push(
      onSnapshot(
        collection(firestore, myWalletsPath),
        (snap) => {
          const map: Record<string, AllowanceWallet> = {};
          snap.forEach((d) => {
            map[d.id] = d.data() as AllowanceWallet;
          });
          callbacks.onMyAllowanceWallets?.(map);
        },
        (err) => reportError(err, OperationType.LIST, myWalletsPath)
      )
    );

    const myExpensesPath = `users/${uid}/allowance_expenses`;
    unsubscribers.push(
      onSnapshot(
        collection(firestore, myExpensesPath),
        (snap) => {
          const items: AllowanceExpense[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<AllowanceExpense, 'id'>),
          }));
          items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          callbacks.onMyAllowanceExpenses?.(items);
        },
        (err) => reportError(err, OperationType.LIST, myExpensesPath)
      )
    );
  }

  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
  };
}

export async function saveHouseholdConfigRemote(
  firestore: Firestore,
  householdId: string,
  config: HouseholdConfig
): Promise<void> {
  const path = `households/${householdId}`;
  try {
    await setDoc(doc(firestore, path), serializeHouseholdPayload(householdId, config));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertBudgetCycleRemote(
  firestore: Firestore,
  householdId: string,
  cycleId: string,
  cycle: BudgetCycle
): Promise<void> {
  const path = `households/${householdId}/budget_cycles/${cycleId}`;
  try {
    await setDoc(doc(firestore, path), serializeBudgetCyclePayload(cycle));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function persistHouseholdTransactionRemote(
  firestore: Firestore,
  householdId: string,
  tx: Omit<HouseholdTransaction, 'id'>,
  txId?: string
): Promise<string> {
  const id = txId || safeDocId('tx', tx.importHash);
  const path = `households/${householdId}/transactions/${id}`;
  try {
    await setDoc(doc(firestore, path), {
      title: tx.title.slice(0, 200),
      bucket: tx.bucket,
      amount: roundMoney(tx.amount),
      date: tx.date,
      paidByUid: tx.paidByUid,
      cycleId: tx.cycleId,
      importHash: tx.importHash ?? null,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
  return id;
}

export async function updateHouseholdTransactionBucketRemote(
  firestore: Firestore,
  householdId: string,
  txId: string,
  bucket: TransactionBucket
): Promise<void> {
  const path = `households/${householdId}/transactions/${txId}`;
  try {
    await updateDoc(doc(firestore, path), { bucket });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function persistSharedAllowanceExpenseRemote(
  firestore: Firestore,
  householdId: string,
  expense: Omit<SharedAllowanceExpense, 'id'>,
  docId?: string
): Promise<string> {
  const id = docId || safeDocId('shared', expense.importHash);
  const path = `households/${householdId}/shared_allowance_expenses/${id}`;
  const totalAmount = roundMoney(expense.totalAmount);
  try {
    await setDoc(doc(firestore, path), {
      title: expense.title.slice(0, 200),
      category: (expense.category || 'dos_dois').slice(0, 80),
      totalAmount,
      splitPerPartner: roundMoney(totalAmount / 2),
      paidByUid: expense.paidByUid,
      date: expense.date,
      cycleId: expense.cycleId,
      importHash: expense.importHash ?? null,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
  return id;
}

export async function persistInstallmentPlanRemote(
  firestore: Firestore,
  householdId: string,
  plan: Omit<InstallmentPlan, 'id'>,
  docId?: string
): Promise<string> {
  const id = docId || safeDocId('plan', plan.importHash);
  const path = `households/${householdId}/installment_plans/${id}`;
  try {
    await setDoc(doc(firestore, path), {
      title: plan.title.slice(0, 200),
      installmentAmount: roundMoney(plan.installmentAmount),
      currentInstallment: Math.max(1, Math.trunc(plan.currentInstallment)),
      totalInstallments: Math.max(1, Math.trunc(plan.totalInstallments)),
      startCycleId: plan.startCycleId,
      endCycleId: plan.endCycleId,
      importHash: plan.importHash ?? null,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
  return id;
}

export async function persistGoalRemote(
  firestore: Firestore,
  householdId: string,
  goal: Goal,
  goalId?: string
): Promise<string> {
  const id = goalId || goal.id || safeDocId('goal');
  const path = `households/${householdId}/goals/${id}`;
  try {
    await setDoc(doc(firestore, path), {
      title: goal.title.slice(0, 160),
      pillar: goal.pillar,
      targetAmount: roundMoney(goal.targetAmount),
      currentAmount: roundMoney(goal.currentAmount),
      deadline: goal.deadline ?? null,
      autoAllocateWeight: Number.isFinite(goal.autoAllocateWeight) ? goal.autoAllocateWeight : 1,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
  return id;
}

export async function sendAllowanceBoostRemote(
  firestore: Firestore,
  params: {
    householdId: string;
    cycleId: string;
    currentCycle: BudgetCycle;
    transfer: BoostTransfer;
  }
): Promise<void> {
  const cyclePath = `households/${params.householdId}/budget_cycles/${params.cycleId}`;
  const nextCycle = serializeBudgetCyclePayload({
    ...params.currentCycle,
    boostTransfers: [...(params.currentCycle.boostTransfers ?? []), params.transfer],
  });
  try {
    await setDoc(doc(firestore, cyclePath), nextCycle);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, cyclePath);
  }
}

export async function sweepAllowanceToGoalsRemote(
  firestore: Firestore,
  params: {
    householdId: string;
    uid: string;
    cycleId: string;
    goal: Goal;
    amount: number;
    date: string;
    currentWallet: AllowanceWallet;
  }
): Promise<string> {
  const amt = roundMoney(params.amount);
  const contribId = safeDocId('sweep');
  const contribPath = `households/${params.householdId}/goal_contributions/${contribId}`;
  const goalId = params.goal.id || safeDocId('goal');
  const goalPath = `households/${params.householdId}/goals/${goalId}`;
  const walletPath = `users/${params.uid}/allowance_wallets/${params.cycleId}`;

  const batch = writeBatch(firestore);
  batch.set(doc(firestore, contribPath), {
    goalId,
    amount: amt,
    source: 'partner_allowance_sweep',
    contributorUid: params.uid,
    date: params.date,
    cycleId: params.cycleId,
  });
  batch.set(doc(firestore, goalPath), {
    title: params.goal.title.slice(0, 160),
    pillar: params.goal.pillar,
    targetAmount: roundMoney(params.goal.targetAmount),
    currentAmount: roundMoney((params.goal.currentAmount || 0) + amt),
    deadline: params.goal.deadline ?? null,
    autoAllocateWeight: Number.isFinite(params.goal.autoAllocateWeight)
      ? params.goal.autoAllocateWeight
      : 1,
  });
  batch.set(
    doc(firestore, walletPath),
    serializeWalletPayload({
      ...params.currentWallet,
      sweptToSharedGoals: roundMoney((params.currentWallet.sweptToSharedGoals || 0) + amt),
    })
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, contribPath);
  }
  return contribId;
}

export async function closeCycleAndRouteSurplusRemote(
  firestore: Firestore,
  params: {
    householdId: string;
    cycleId: string;
    nextCycleId: string;
    currentCycle: BudgetCycle;
    nextCycleBase: BudgetCycle;
    routing: SurplusRouting;
    goals?: Goal[];
    goalContributions?: Array<Omit<GoalContribution, 'id'>>;
  }
): Promise<void> {
  const batch = writeBatch(firestore);
  const currentPath = `households/${params.householdId}/budget_cycles/${params.cycleId}`;
  const nextPath = `households/${params.householdId}/budget_cycles/${params.nextCycleId}`;

  batch.set(
    doc(firestore, currentPath),
    serializeBudgetCyclePayload({
      ...params.currentCycle,
      surplusRouting: params.routing,
    })
  );
  batch.set(doc(firestore, nextPath), serializeBudgetCyclePayload(params.nextCycleBase));

  if (params.routing === 'goals') {
    for (const contrib of params.goalContributions ?? []) {
      const id = safeDocId('surplus');
      batch.set(doc(firestore, `households/${params.householdId}/goal_contributions/${id}`), {
        goalId: contrib.goalId,
        amount: roundMoney(contrib.amount),
        source: 'cycle_surplus',
        contributorUid: contrib.contributorUid ?? null,
        date: contrib.date,
        cycleId: contrib.cycleId,
      });
    }
    for (const g of params.goals ?? []) {
      if (!g.id) continue;
      batch.set(doc(firestore, `households/${params.householdId}/goals/${g.id}`), {
        title: g.title.slice(0, 160),
        pillar: g.pillar,
        targetAmount: roundMoney(g.targetAmount),
        currentAmount: roundMoney(g.currentAmount),
        deadline: g.deadline ?? null,
        autoAllocateWeight: Number.isFinite(g.autoAllocateWeight) ? g.autoAllocateWeight : 1,
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, currentPath);
  }
}

/**
 * PRIVACIDADE BLINDADA (ZERO-SURVEILLANCE):
 * Esta função aceita EXCLUSIVAMENTE `uid` (NUNCA `householdId`) e grava apenas em:
 *   /users/{uid}/allowance_expenses/{txId}
 *   /users/{uid}/allowance_wallets/{cycleId}
 */
export async function persistPrivateAllowanceExpense(
  firestore: Firestore,
  uid: string,
  expense: Omit<AllowanceExpense, 'id'>,
  allowanceFloorFallback: number = 600
): Promise<{ expensePath: string; walletPath: string; expenseId: string; wallet: AllowanceWallet }> {
  if (!uid) throw new Error('UID obrigatório para gravar despesa da mesada privada.');
  const txId = safeDocId('priv', expense.importHash);
  const expensePath = `users/${uid}/allowance_expenses/${txId}`;
  const walletPath = `users/${uid}/allowance_wallets/${expense.cycleId}`;

  const payload: Omit<AllowanceExpense, 'id'> = {
    title: expense.title.slice(0, 200),
    amount: roundMoney(expense.amount),
    installmentInfo: expense.installmentInfo ?? null,
    date: expense.date,
    cycleId: expense.cycleId,
    importHash: expense.importHash ?? null,
  };

  try {
    await setDoc(doc(firestore, expensePath), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, expensePath);
  }

  let nextWallet: AllowanceWallet = {
    rolloverFromPrevious: 0,
    monthlyAllocation: allowanceFloorFallback,
    boostsNet: 0,
    soloSpent: payload.amount,
    jointAllowanceShareSpent: 0,
    sweptToSharedGoals: 0,
    closingBalance: roundMoney(allowanceFloorFallback - payload.amount),
  };

  try {
    const walletRef = doc(firestore, walletPath);
    const snap = await getDoc(walletRef);
    const prevWallet: AllowanceWallet = snap.exists()
      ? (snap.data() as AllowanceWallet)
      : {
          rolloverFromPrevious: 0,
          monthlyAllocation: allowanceFloorFallback,
          boostsNet: 0,
          soloSpent: 0,
          jointAllowanceShareSpent: 0,
          sweptToSharedGoals: 0,
          closingBalance: allowanceFloorFallback,
        };

    nextWallet = serializeWalletPayload({
      ...prevWallet,
      soloSpent: roundMoney((prevWallet.soloSpent || 0) + payload.amount),
    });
    await setDoc(walletRef, nextWallet);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, walletPath);
  }

  return { expensePath, walletPath, expenseId: txId, wallet: nextWallet };
}

export async function persistHouseholdTriageBatch(
  firestore: Firestore,
  householdId: string,
  params: {
    transactions?: Array<Omit<HouseholdTransaction, 'id'>>;
    installmentPlans?: Array<Omit<InstallmentPlan, 'id'>>;
    sharedAllowanceExpenses?: Array<Omit<SharedAllowanceExpense, 'id'>>;
    shiftUpdates?: Array<{ shiftId: string; shift: MedicalShiftRecord }>;
    budgetCycleUpdates?: Array<{ cycleId: string; cycle: BudgetCycle }>;
  }
): Promise<string[]> {
  if (!householdId) throw new Error('Household ID obrigatório.');
  const batch = writeBatch(firestore);
  const paths: string[] = [];

  for (const tx of params.transactions ?? []) {
    const id = safeDocId('tx', tx.importHash);
    const path = `households/${householdId}/transactions/${id}`;
    batch.set(doc(firestore, path), {
      title: tx.title.slice(0, 200),
      bucket: tx.bucket,
      amount: roundMoney(tx.amount),
      date: tx.date,
      paidByUid: tx.paidByUid,
      cycleId: tx.cycleId,
      importHash: tx.importHash ?? null,
    });
    paths.push(path);
  }

  for (const plan of params.installmentPlans ?? []) {
    const id = safeDocId('plan', plan.importHash);
    const path = `households/${householdId}/installment_plans/${id}`;
    batch.set(doc(firestore, path), {
      title: plan.title.slice(0, 200),
      installmentAmount: roundMoney(plan.installmentAmount),
      currentInstallment: Math.max(1, Math.trunc(plan.currentInstallment)),
      totalInstallments: Math.max(1, Math.trunc(plan.totalInstallments)),
      startCycleId: plan.startCycleId,
      endCycleId: plan.endCycleId,
      importHash: plan.importHash ?? null,
    });
    paths.push(path);
  }

  for (const shared of params.sharedAllowanceExpenses ?? []) {
    const id = safeDocId('shared', shared.importHash);
    const path = `households/${householdId}/shared_allowance_expenses/${id}`;
    const total = roundMoney(shared.totalAmount);
    batch.set(doc(firestore, path), {
      title: shared.title.slice(0, 200),
      category: shared.category.slice(0, 80) || 'dos_dois',
      totalAmount: total,
      splitPerPartner: roundMoney(total / 2),
      paidByUid: shared.paidByUid,
      date: shared.date,
      cycleId: shared.cycleId,
      importHash: shared.importHash ?? null,
    });
    paths.push(path);
  }

  for (const item of params.shiftUpdates ?? []) {
    const path = `households/${householdId}/shifts/${item.shiftId}`;
    batch.set(doc(firestore, path), {
      doctorUid: item.shift.doctorUid,
      institution: item.shift.institution.slice(0, 160),
      shiftDate: item.shift.shiftDate,
      hours: item.shift.hours,
      grossAmount: roundMoney(item.shift.grossAmount),
      netAmount: roundMoney(item.shift.netAmount),
      status: item.shift.status,
      expectedPayDate: item.shift.expectedPayDate,
      paidAt: item.shift.paidAt ?? null,
    });
    paths.push(path);
  }

  for (const cycleItem of params.budgetCycleUpdates ?? []) {
    const path = `households/${householdId}/budget_cycles/${cycleItem.cycleId}`;
    batch.set(doc(firestore, path), serializeBudgetCyclePayload(cycleItem.cycle));
    paths.push(path);
  }

  if (paths.length === 0) return [];

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, paths[0] || `households/${householdId}`);
  }
  return paths;
}
