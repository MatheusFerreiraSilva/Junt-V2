import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { db } from './firebase';
import type {
  AllowanceExpense,
  AllowanceInstallmentInfo,
  AllowanceWallet,
  BudgetCycle,
  HouseholdConfig,
  HouseholdTransaction,
  InstallmentPlan,
  MedicalShiftRecord,
  SharedAllowanceExpense,
  TransactionBucket,
} from '../types/finance';
import {
  resolveHouseholdConfig,
  roundMoney,
} from '../domain/waterfallEngine';
import {
  reconcileShiftPayment,
  type ReconcileShiftPaymentParams,
} from '../utils/shiftReconciliation';
import type {
  StagedCsvTransaction,
  TriageDestination,
} from '../utils/statementImport';

export interface PersistenceWriter {
  getDocData: <T = Record<string, unknown>>(path: string) => Promise<T | null>;
  setDocData: (path: string, data: Record<string, unknown>) => Promise<void>;
}

export function createFirestoreWriter(firestoreDb: Firestore = db): PersistenceWriter {
  return {
    getDocData: async <T = Record<string, unknown>>(path: string): Promise<T | null> => {
      const segments = path.split('/').filter(Boolean);
      const ref = doc(firestoreDb, segments[0], ...segments.slice(1));
      const snap = await getDoc(ref);
      return snap.exists() ? (snap.data() as T) : null;
    },
    setDocData: async (path: string, data: Record<string, unknown>): Promise<void> => {
      const segments = path.split('/').filter(Boolean);
      const ref = doc(firestoreDb, segments[0], ...segments.slice(1));
      await setDoc(ref, data);
    },
  };
}

export interface ConfirmStagedTransactionParams {
  staged: StagedCsvTransaction;
  destination: TriageDestination;
  uid: string;
  householdId?: string;
  bucket?: TransactionBucket;
  sharedCategory?: string;
  householdConfig?: Partial<HouseholdConfig>;
  reconcileShiftId?: string;
  existingShifts?: MedicalShiftRecord[];
  shiftWaterfallContext?: Omit<
    ReconcileShiftPaymentParams,
    'shifts' | 'shiftId' | 'paidAt' | 'householdConfig'
  >;
  writer?: PersistenceWriter;
}

export interface ConfirmStagedTransactionResult {
  destination: TriageDestination;
  writtenPaths: string[];
  householdTransaction?: HouseholdTransaction;
  installmentPlan?: InstallmentPlan;
  allowanceExpense?: AllowanceExpense;
  updatedWallet?: AllowanceWallet;
  sharedAllowanceExpense?: SharedAllowanceExpense;
  reconciledShift?: MedicalShiftRecord;
  updatedBudgetCycle?: BudgetCycle;
}

function buildDocIdFromHash(prefix: string, importHash: string): string {
  const safeHash = (importHash || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return `${prefix}_${safeHash || Date.now().toString(36)}`;
}

/**
 * Persiste uma linha do staging CSV no destino escolhido pelo Protocolo B.4.
 * REGRA DE BLINDAGEM DE PRIVACIDADE (ZERO-SURVEILLANCE):
 * - Quando `destination === "solo_allowance"`, grava EXCLUSIVAMENTE em:
 *   `/users/{uid}/allowance_expenses/{docId}` e `/users/{uid}/allowance_wallets/{cycleId}`.
 *   NUNCA transita por `/households/{hid}/`.
 */
export async function confirmStagedTransactionRoute(
  params: ConfirmStagedTransactionParams
): Promise<ConfirmStagedTransactionResult> {
  const { staged, destination, uid } = params;
  if (!uid || !uid.trim()) {
    throw new Error('Usuário autenticado (uid) é obrigatório para confirmar a triagem.');
  }

  const config = resolveHouseholdConfig(params.householdConfig);
  const writer = params.writer ?? createFirestoreWriter();
  const writtenPaths: string[] = [];
  const safeTitle = staged.description.trim().slice(0, 200) || 'Lançamento';
  const amount = roundMoney(Math.abs(staged.amount));

  // ---------------------------------------------------------------------------
  // DESTINO 2: MESADA — SÓ MINHA (ISOLAMENTO ESTRITO EM /users/{uid}/)
  // ---------------------------------------------------------------------------
  if (destination === 'solo_allowance') {
    let installmentInfo: AllowanceInstallmentInfo | null = null;
    if (staged.installment) {
      const maxPersonalInstallment = roundMoney(config.allowanceFloor * 0.5);
      if (amount > maxPersonalInstallment) {
        throw new Error(
          `Parcela pessoal (R$ ${amount.toFixed(
            2
          )}) excede o teto seguro de 50% do piso da mesada (R$ ${maxPersonalInstallment.toFixed(
            2
          )}).`
        );
      }
      installmentInfo = {
        currentInstallment: staged.installment.currentInstallment,
        totalInstallments: staged.installment.totalInstallments,
        installmentAmount: amount,
      };
    }

    const expenseId = buildDocIdFromHash('solo', staged.importHash);
    const expensePath = `users/${uid.trim()}/allowance_expenses/${expenseId}`;
    const walletPath = `users/${uid.trim()}/allowance_wallets/${staged.cycleId}`;

    const allowanceExpensePayload: AllowanceExpense = {
      title: safeTitle,
      amount,
      installmentInfo,
      date: staged.date,
      cycleId: staged.cycleId,
      importHash: staged.importHash,
    };

    await writer.setDocData(expensePath, {
      title: allowanceExpensePayload.title,
      amount: allowanceExpensePayload.amount,
      installmentInfo: allowanceExpensePayload.installmentInfo ?? null,
      date: allowanceExpensePayload.date,
      cycleId: allowanceExpensePayload.cycleId,
      importHash: allowanceExpensePayload.importHash ?? null,
    });
    writtenPaths.push(expensePath);

    const existingWallet = await writer.getDocData<AllowanceWallet>(walletPath);
    const rolloverFromPrevious = roundMoney(existingWallet?.rolloverFromPrevious ?? 0);
    const monthlyAllocation = Math.max(
      0,
      roundMoney(existingWallet?.monthlyAllocation ?? config.allowanceFloor)
    );
    const boostsNet = roundMoney(existingWallet?.boostsNet ?? 0);
    const soloSpent = roundMoney((existingWallet?.soloSpent ?? 0) + amount);
    const jointAllowanceShareSpent = Math.max(
      0,
      roundMoney(existingWallet?.jointAllowanceShareSpent ?? 0)
    );
    const sweptToSharedGoals = Math.max(
      0,
      roundMoney(existingWallet?.sweptToSharedGoals ?? 0)
    );
    const closingBalance = roundMoney(
      rolloverFromPrevious +
        monthlyAllocation +
        boostsNet -
        soloSpent -
        jointAllowanceShareSpent -
        sweptToSharedGoals
    );

    const updatedWallet: AllowanceWallet = {
      rolloverFromPrevious,
      monthlyAllocation,
      boostsNet,
      soloSpent,
      jointAllowanceShareSpent,
      sweptToSharedGoals,
      closingBalance,
    };

    await writer.setDocData(walletPath, { ...updatedWallet });
    writtenPaths.push(walletPath);

    return {
      destination: 'solo_allowance',
      writtenPaths,
      allowanceExpense: allowanceExpensePayload,
      updatedWallet,
    };
  }

  // ---------------------------------------------------------------------------
  // DESTINO 4: INTERNO (IGNORAR / CONCILIAR PLANTÃO MÉDICO)
  // ---------------------------------------------------------------------------
  if (destination === 'internal') {
    if (params.reconcileShiftId && params.householdId && params.existingShifts) {
      const reconciled = reconcileShiftPayment({
        shifts: params.existingShifts,
        shiftId: params.reconcileShiftId,
        paidAt: staged.date,
        actualNetAmount: staged.type === 'income' ? amount : undefined,
        householdConfig: config,
        ...params.shiftWaterfallContext,
      });

      const shiftPath = `households/${params.householdId}/shifts/${params.reconcileShiftId}`;
      const cyclePath = `households/${params.householdId}/budget_cycles/${reconciled.cycleId}`;

      await writer.setDocData(shiftPath, {
        doctorUid: reconciled.updatedShift.doctorUid,
        institution: reconciled.updatedShift.institution,
        shiftDate: reconciled.updatedShift.shiftDate,
        hours: reconciled.updatedShift.hours,
        grossAmount: reconciled.updatedShift.grossAmount,
        netAmount: reconciled.updatedShift.netAmount,
        status: reconciled.updatedShift.status,
        expectedPayDate: reconciled.updatedShift.expectedPayDate,
        paidAt: reconciled.updatedShift.paidAt ?? null,
      });
      writtenPaths.push(shiftPath);

      await writer.setDocData(cyclePath, { ...reconciled.budgetCycle });
      writtenPaths.push(cyclePath);

      return {
        destination: 'internal',
        writtenPaths,
        reconciledShift: reconciled.updatedShift,
        updatedBudgetCycle: reconciled.budgetCycle,
      };
    }

    return {
      destination: 'internal',
      writtenPaths,
    };
  }

  // Destinos compartilhados exigem householdId
  if (!params.householdId || !params.householdId.trim()) {
    throw new Error('ID do household é obrigatório para lançamentos compartilhados.');
  }
  const hid = params.householdId.trim();

  // ---------------------------------------------------------------------------
  // DESTINO 1: CASA & ROTINA (/households/{hid}/transactions + /installment_plans)
  // ---------------------------------------------------------------------------
  if (destination === 'house_routine') {
    const txId = buildDocIdFromHash('tx', staged.importHash);
    const txPath = `households/${hid}/transactions/${txId}`;
    const bucket = params.bucket ?? staged.suggestedBucket ?? 'routine';

    const householdTransaction: HouseholdTransaction = {
      title: staged.installment?.cleanTitle || safeTitle,
      bucket,
      amount,
      date: staged.date,
      paidByUid: uid.trim(),
      cycleId: staged.cycleId,
      importHash: staged.importHash,
    };

    await writer.setDocData(txPath, {
      title: householdTransaction.title,
      bucket: householdTransaction.bucket,
      amount: householdTransaction.amount,
      date: householdTransaction.date,
      paidByUid: householdTransaction.paidByUid,
      cycleId: householdTransaction.cycleId,
      importHash: householdTransaction.importHash ?? null,
    });
    writtenPaths.push(txPath);

    let installmentPlan: InstallmentPlan | undefined;
    if (staged.installment) {
      const planId = buildDocIdFromHash('plan', staged.importHash);
      const planPath = `households/${hid}/installment_plans/${planId}`;
      installmentPlan = {
        ...staged.installment.draft,
        importHash: staged.importHash,
      };
      await writer.setDocData(planPath, {
        title: installmentPlan.title,
        installmentAmount: installmentPlan.installmentAmount,
        currentInstallment: installmentPlan.currentInstallment,
        totalInstallments: installmentPlan.totalInstallments,
        startCycleId: installmentPlan.startCycleId,
        endCycleId: installmentPlan.endCycleId,
        importHash: installmentPlan.importHash ?? null,
      });
      writtenPaths.push(planPath);
    }

    return {
      destination: 'house_routine',
      writtenPaths,
      householdTransaction,
      installmentPlan,
    };
  }

  // ---------------------------------------------------------------------------
  // DESTINO 3: MESADA — DOS DOIS (/households/{hid}/shared_allowance_expenses)
  // ---------------------------------------------------------------------------
  const sharedId = buildDocIdFromHash('shared', staged.importHash);
  const sharedPath = `households/${hid}/shared_allowance_expenses/${sharedId}`;
  const splitPerPartner = roundMoney(amount / 2);

  const sharedAllowanceExpense: SharedAllowanceExpense = {
    title: safeTitle,
    category: (params.sharedCategory || 'lazer_casal').slice(0, 80),
    totalAmount: amount,
    splitPerPartner,
    paidByUid: uid.trim(),
    date: staged.date,
    cycleId: staged.cycleId,
    importHash: staged.importHash,
  };

  await writer.setDocData(sharedPath, {
    title: sharedAllowanceExpense.title,
    category: sharedAllowanceExpense.category,
    totalAmount: sharedAllowanceExpense.totalAmount,
    splitPerPartner: sharedAllowanceExpense.splitPerPartner,
    paidByUid: sharedAllowanceExpense.paidByUid,
    date: sharedAllowanceExpense.date,
    cycleId: sharedAllowanceExpense.cycleId,
    importHash: sharedAllowanceExpense.importHash ?? null,
  });
  writtenPaths.push(sharedPath);

  return {
    destination: 'shared_allowance',
    writtenPaths,
    sharedAllowanceExpense,
  };
}
