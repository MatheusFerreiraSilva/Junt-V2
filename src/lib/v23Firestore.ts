import {
  doc,
  getDoc,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { auth } from './firebase';
import type {
  AllowanceExpense,
  AllowanceWallet,
  BudgetCycle,
  HouseholdTransaction,
  InstallmentPlan,
  MedicalShiftRecord,
  SharedAllowanceExpense,
} from '../types/finance';
import { roundMoney } from '../domain/waterfallEngine';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
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

function handleFirestoreError(
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

function safeDocId(prefix: string, seed?: string | null): string {
  const clean = (seed || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
  if (clean) return `${prefix}_${clean}`.slice(0, 128);
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
): Promise<{ expensePath: string; walletPath: string }> {
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

    const nextSoloSpent = roundMoney((prevWallet.soloSpent || 0) + payload.amount);
    const nextWallet: AllowanceWallet = {
      rolloverFromPrevious: roundMoney(prevWallet.rolloverFromPrevious || 0),
      monthlyAllocation: roundMoney(prevWallet.monthlyAllocation || 0),
      boostsNet: roundMoney(prevWallet.boostsNet || 0),
      soloSpent: nextSoloSpent,
      jointAllowanceShareSpent: roundMoney(prevWallet.jointAllowanceShareSpent || 0),
      sweptToSharedGoals: roundMoney(prevWallet.sweptToSharedGoals || 0),
      closingBalance: roundMoney(
        (prevWallet.rolloverFromPrevious || 0) +
          (prevWallet.monthlyAllocation || 0) +
          (prevWallet.boostsNet || 0) -
          nextSoloSpent -
          (prevWallet.jointAllowanceShareSpent || 0) -
          (prevWallet.sweptToSharedGoals || 0)
      ),
    };
    await setDoc(walletRef, nextWallet);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, walletPath);
  }

  return { expensePath, walletPath };
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
    batch.set(doc(firestore, path), cycleItem.cycle);
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
