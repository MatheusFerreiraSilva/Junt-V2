import { vi } from 'vitest';
vi.mock('../src/lib/firebase', () => ({ db: null }));

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  type Firestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { DEFAULT_AVATAR } from '../src/avatars/avatarConfig';
import { saveAvatarToCloud } from '../src/avatars/avatarStore';

const sdk = (client: unknown) => client as Firestore;
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const HOUSEHOLD_ID = 'household-ab';
const UID_A = 'uid-partner-a';
const UID_B = 'uid-partner-b';
const UID_INTRUDER = 'uid-intruso';
const CYCLE_ID = '2026_11';

const validHouseholdPayload = {
  id: HOUSEHOLD_ID,
  memberUids: [UID_A, UID_B],
  memberTaxIds: ['111.111.111-11', '222.222.222-22'],
  cycleStartDay: 1,
  mandatoryGoalRate: 0.1,
  housingCapRate: 0.3,
  structureCapRate: 0.6,
  installmentCapMin: 0.1,
  installmentCapMax: 0.2,
  installmentCapTarget: 0.15,
  allowanceFloor: 600,
  allowanceCap: 2500,
  shieldFloorMonths: 4,
  shieldTargetMonths: 10,
  defaultShiftTaxRate: 0,
  goalAllocationRules: [{ goalId: 'goal-shield', weight: 1 }],
};

const validBudgetCyclePayload = {
  newNetIncome: 15000,
  previousMonthCarryOver: 500,
  totalAvailableCash: 15500,
  mandatoryGoalAmount: 1500,
  housingTotal: 4200,
  essentialFixedTotal: 1200,
  cancelableFixedTotal: 300,
  installmentsTotal: 900,
  groceriesBudget: 1600,
  routineBudget: 800,
  unexpectedBufferLimit: 500,
  unexpectedBufferSpent: 0,
  unlockedAllowanceA: 1200,
  unlockedAllowanceB: 1200,
  boostTransfers: [],
  closingSurplus: 2100,
  surplusRouting: 'carry_over',
};

const validTransactionPayload = {
  title: 'Aluguel Apartamento',
  bucket: 'housing',
  amount: 3200,
  date: '2026-11-05T10:00:00.000Z',
  paidByUid: UID_A,
  cycleId: CYCLE_ID,
  importHash: null,
};

const validSharedAllowancePayload = {
  title: 'Jantar Especial',
  category: 'lazer',
  totalAmount: 240,
  splitPerPartner: 120,
  paidByUid: UID_A,
  date: '2026-11-12T21:00:00.000Z',
  cycleId: CYCLE_ID,
};

const validShiftPayload = {
  doctorUid: UID_B,
  institution: 'Hospital Santa Casa',
  shiftDate: '2026-11-10',
  hours: 12,
  grossAmount: 1800,
  netAmount: 1800,
  status: 'paid',
  expectedPayDate: '2026-11-20',
  paidAt: '2026-11-20',
};

const validInstallmentPlanPayload = {
  title: 'Geladeira Inox',
  installmentAmount: 450,
  currentInstallment: 2,
  totalInstallments: 10,
  startCycleId: '2026_10',
  endCycleId: '2027_07',
  importHash: null,
};

const validGoalPayload = {
  title: 'Reserva de Emergência',
  pillar: 'shield',
  targetAmount: 60000,
  currentAmount: 20000,
  deadline: null,
  autoAllocateWeight: 100,
};

const validAllowanceWalletPayload = {
  rolloverFromPrevious: 150,
  monthlyAllocation: 1200,
  boostsNet: 0,
  soloSpent: 320,
  jointAllowanceShareSpent: 120,
  sweptToSharedGoals: 100,
  closingBalance: 810,
};

const validAllowanceExpensePayload = {
  title: 'Presente surpresa',
  amount: 180,
  installmentInfo: null,
  date: '2026-11-14T15:30:00.000Z',
  cycleId: CYCLE_ID,
};

describe.skipIf(!enabled)('Firestore v2.3 security & zero-surveillance rules (emulator only)', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-junto-v23-rules',
      firestore: { rules: await readFile('firestore.rules', 'utf8') },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, `households/${HOUSEHOLD_ID}`), validHouseholdPayload);
      await setDoc(doc(db, `users/${UID_A}`), {
        uid: UID_A,
        email: 'a@junto.app',
        displayName: 'Parceiro A',
        householdId: HOUSEHOLD_ID,
      });
      await setDoc(doc(db, `users/${UID_B}`), {
        uid: UID_B,
        email: 'b@junto.app',
        displayName: 'Parceiro B',
        householdId: HOUSEHOLD_ID,
      });
      await setDoc(doc(db, `users/${UID_INTRUDER}`), {
        uid: UID_INTRUDER,
        email: 'intruso@junto.app',
        displayName: 'Intruso',
        householdId: 'household-outro',
      });
      await setDoc(doc(db, `users/${UID_B}/allowance_wallets/${CYCLE_ID}`), validAllowanceWalletPayload);
      await setDoc(doc(db, `users/${UID_B}/allowance_expenses/priv-tx-1`), validAllowanceExpensePayload);
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('1. Negar leitura e escrita para usuário não autenticado em todas as coleções', async () => {
    const anonDb = env.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(anonDb, `households/${HOUSEHOLD_ID}`)));
    await assertFails(setDoc(doc(anonDb, `households/${HOUSEHOLD_ID}`), validHouseholdPayload));
    await assertFails(getDoc(doc(anonDb, `households/${HOUSEHOLD_ID}/budget_cycles/${CYCLE_ID}`)));
    await assertFails(setDoc(doc(anonDb, `households/${HOUSEHOLD_ID}/transactions/tx-anon`), validTransactionPayload));
    await assertFails(setDoc(doc(anonDb, `households/${HOUSEHOLD_ID}/shared_allowance_expenses/sh-anon`), validSharedAllowancePayload));
    await assertFails(setDoc(doc(anonDb, `households/${HOUSEHOLD_ID}/shifts/s-anon`), validShiftPayload));
    await assertFails(getDoc(doc(anonDb, `users/${UID_B}`)));
    await assertFails(getDoc(doc(anonDb, `users/${UID_B}/allowance_wallets/${CYCLE_ID}`)));
    await assertFails(getDocs(collection(anonDb, `users/${UID_B}/allowance_expenses`)));
    await assertFails(setDoc(doc(anonDb, `users/${UID_B}/allowance_expenses/tx-anon`), validAllowanceExpensePayload));
  });

  it('2. Negar leitura e escrita para uid_intruso em /households/{hid}/**', async () => {
    const intruderDb = env.authenticatedContext(UID_INTRUDER).firestore();

    await assertFails(getDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}`)));
    await assertFails(updateDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}`), { cycleStartDay: 5 }));
    await assertFails(getDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}/budget_cycles/${CYCLE_ID}`)));
    await assertFails(setDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}/budget_cycles/${CYCLE_ID}`), validBudgetCyclePayload));
    await assertFails(getDocs(collection(intruderDb, `households/${HOUSEHOLD_ID}/transactions`)));
    await assertFails(setDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}/transactions/tx-intruder`), validTransactionPayload));
    await assertFails(setDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}/shared_allowance_expenses/sh-intruder`), validSharedAllowancePayload));
    await assertFails(setDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}/installment_plans/ip-intruder`), validInstallmentPlanPayload));
    await assertFails(setDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}/shifts/shf-intruder`), validShiftPayload));
    await assertFails(setDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}/goals/g-intruder`), validGoalPayload));
    await assertFails(
      setDoc(doc(intruderDb, `households/${HOUSEHOLD_ID}/goal_contributions/gc-intruder`), {
        goalId: 'goal-shield',
        amount: 500,
        source: 'cycle_surplus',
        contributorUid: UID_INTRUDER,
        date: '2026-11-25T10:00:00.000Z',
        cycleId: CYCLE_ID,
      })
    );
  });

  it('3. Permitir que parceiros A e B leiam e escrevam coleções do seu household', async () => {
    const dbA = env.authenticatedContext(UID_A).firestore();
    const dbB = env.authenticatedContext(UID_B).firestore();

    await assertSucceeds(getDoc(doc(dbA, `households/${HOUSEHOLD_ID}`)));
    await assertSucceeds(getDoc(doc(dbB, `households/${HOUSEHOLD_ID}`)));

    await assertSucceeds(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/budget_cycles/${CYCLE_ID}`), validBudgetCyclePayload)
    );
    await assertSucceeds(
      getDoc(doc(dbB, `households/${HOUSEHOLD_ID}/budget_cycles/${CYCLE_ID}`))
    );

    await assertSucceeds(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/transactions/tx-1`), validTransactionPayload)
    );
    await assertSucceeds(
      getDoc(doc(dbB, `households/${HOUSEHOLD_ID}/transactions/tx-1`))
    );

    await assertSucceeds(
      setDoc(
        doc(dbB, `households/${HOUSEHOLD_ID}/shared_allowance_expenses/shared-1`),
        validSharedAllowancePayload
      )
    );
    await assertSucceeds(
      getDoc(doc(dbA, `households/${HOUSEHOLD_ID}/shared_allowance_expenses/shared-1`))
    );

    await assertSucceeds(
      setDoc(doc(dbB, `households/${HOUSEHOLD_ID}/shifts/shift-1`), validShiftPayload)
    );
    await assertSucceeds(
      getDoc(doc(dbA, `households/${HOUSEHOLD_ID}/shifts/shift-1`))
    );

    await assertSucceeds(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/installment_plans/plan-1`), validInstallmentPlanPayload)
    );
    await assertSucceeds(
      setDoc(doc(dbB, `households/${HOUSEHOLD_ID}/goals/goal-shield`), validGoalPayload)
    );
  });

  it('4. TESTE CRÍTICO DE PRIVACIDADE DA MESADA: Parceiro A recebe PERMISSION_DENIED ao tentar ler carteira ou gastos individuais do Parceiro B', async () => {
    const dbA = env.authenticatedContext(UID_A).firestore();
    const dbB = env.authenticatedContext(UID_B).firestore();

    // Parceiro A NÃO pode ler nem listar nada privado do Parceiro B
    await assertFails(getDoc(doc(dbA, `users/${UID_B}`)));
    await assertFails(getDoc(doc(dbA, `users/${UID_B}/allowance_wallets/${CYCLE_ID}`)));
    await assertFails(getDocs(collection(dbA, `users/${UID_B}/allowance_wallets`)));
    await assertFails(getDoc(doc(dbA, `users/${UID_B}/allowance_expenses/priv-tx-1`)));
    await assertFails(getDocs(collection(dbA, `users/${UID_B}/allowance_expenses`)));
    await assertFails(
      setDoc(doc(dbA, `users/${UID_B}/allowance_expenses/tamper`), validAllowanceExpensePayload)
    );

    // Somente o próprio dono (Parceiro B) acessa e escreve sua carteira e gastos privados
    await assertSucceeds(getDoc(doc(dbB, `users/${UID_B}/allowance_wallets/${CYCLE_ID}`)));
    await assertSucceeds(getDocs(collection(dbB, `users/${UID_B}/allowance_expenses`)));
    await assertSucceeds(
      setDoc(doc(dbB, `users/${UID_B}/allowance_expenses/priv-tx-2`), validAllowanceExpensePayload)
    );
  });

  it('5. Parceiro B pode enviar sobra anônima de mesada para goal_contributions (partner_allowance_sweep) sem expor carteira privada', async () => {
    const dbA = env.authenticatedContext(UID_A).firestore();
    const dbB = env.authenticatedContext(UID_B).firestore();

    const sweepRef = doc(dbB, `households/${HOUSEHOLD_ID}/goal_contributions/sweep-b-1`);
    await assertSucceeds(
      setDoc(sweepRef, {
        goalId: 'goal-dreams-1',
        amount: 250,
        source: 'partner_allowance_sweep',
        contributorUid: UID_B,
        date: '2026-11-28T18:00:00.000Z',
        cycleId: CYCLE_ID,
      })
    );

    // Parceiro A consegue ler a contribuição no ledger comum do casal
    await assertSucceeds(getDoc(doc(dbA, `households/${HOUSEHOLD_ID}/goal_contributions/sweep-b-1`)));

    // Parceiro B não pode falsificar contributorUid como sendo do Parceiro A
    await assertFails(
      setDoc(doc(dbB, `households/${HOUSEHOLD_ID}/goal_contributions/sweep-spoof`), {
        goalId: 'goal-dreams-1',
        amount: 250,
        source: 'partner_allowance_sweep',
        contributorUid: UID_A,
        date: '2026-11-28T18:00:00.000Z',
        cycleId: CYCLE_ID,
      })
    );
  });

  it('6. Rejeitar amount <= 0, splitPerPartner inconsistente, segredos e coleções legadas bloqueadas', async () => {
    const dbA = env.authenticatedContext(UID_A).firestore();

    // amount <= 0 em transactions
    await assertFails(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/transactions/tx-zero`), {
        ...validTransactionPayload,
        amount: 0,
      })
    );
    await assertFails(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/transactions/tx-neg`), {
        ...validTransactionPayload,
        amount: -50,
      })
    );

    // bucket inválido
    await assertFails(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/transactions/tx-bad-bucket`), {
        ...validTransactionPayload,
        bucket: 'farmacia',
      })
    );

    // shared_allowance_expenses com totalAmount <= 0 ou splitPerPartner inconsistente com totalAmount / 2
    await assertFails(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/shared_allowance_expenses/sh-zero`), {
        ...validSharedAllowancePayload,
        totalAmount: 0,
        splitPerPartner: 0,
      })
    );
    await assertFails(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/shared_allowance_expenses/sh-bad-split`), {
        ...validSharedAllowancePayload,
        totalAmount: 200,
        splitPerPartner: 150,
      })
    );

    // allowance_expenses do próprio dono com amount <= 0
    await assertFails(
      setDoc(doc(dbA, `users/${UID_A}/allowance_expenses/priv-zero`), {
        ...validAllowanceExpensePayload,
        amount: 0,
      })
    );

    // shifts com netAmount > grossAmount ou grossAmount <= 0
    await assertFails(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/shifts/shift-bad`), {
        ...validShiftPayload,
        doctorUid: UID_A,
        grossAmount: 1000,
        netAmount: 1200,
      })
    );

    // segredos e catch-all legado (/couples/* bloqueado)
    await assertFails(
      setDoc(doc(dbA, `households/${HOUSEHOLD_ID}/transactions/tx-secret`), {
        ...validTransactionPayload,
        clientSecret: 'forbidden',
      })
    );
    await assertFails(getDoc(doc(dbA, 'couples/legacy-couple')));
  });

  describe('avatars and private accountPreferences under v2.3 household binding', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, `avatars/${UID_A}`), {
          ownerUid: UID_A,
          revision: 1,
          config: DEFAULT_AVATAR,
        });
        await setDoc(doc(db, `avatars/${UID_B}`), {
          ownerUid: UID_B,
          revision: 1,
          config: { ...DEFAULT_AVATAR, skin: 'cocoa' },
        });
      });
    });

    it('lets household members read and update each other avatars and denies intruders/anonymous', async () => {
      const dbA = env.authenticatedContext(UID_A).firestore();
      const dbB = env.authenticatedContext(UID_B).firestore();
      const intruderDb = env.authenticatedContext(UID_INTRUDER).firestore();
      const anonA = env
        .authenticatedContext(UID_A, { firebase: { sign_in_provider: 'anonymous' } })
        .firestore();

      await assertSucceeds(getDoc(doc(dbA, `avatars/${UID_B}`)));
      await assertSucceeds(getDoc(doc(dbB, `avatars/${UID_A}`)));
      await assertFails(getDoc(doc(intruderDb, `avatars/${UID_A}`)));
      await assertFails(getDoc(doc(anonA, `avatars/${UID_A}`)));

      const customized = { ...DEFAULT_AVATAR, hair: 'fade' as const, outfit: 'labcoat' as const };
      const saved = await saveAvatarToCloud(UID_A, customized, 1, () => true, sdk(dbA));
      expect(saved.revision).toBe(2);
    });

    it('keeps accountPreferences strictly owner-only with monotonic revisions', async () => {
      const ownerDb = env.authenticatedContext(UID_A).firestore();
      const partnerDb = env.authenticatedContext(UID_B).firestore();
      const ref = doc(ownerDb, `accountPreferences/${UID_A}`);
      const record = {
        ownerUid: UID_A,
        version: 1,
        revision: 1,
        preferences: {
          themeMode: 'dark',
          accentTheme: 'emerald',
          coupleTheme: 'emerald',
          partner1Theme: 'sapphire',
          partner2Theme: 'rose',
        },
      };

      await assertSucceeds(setDoc(ref, record));
      await assertSucceeds(getDoc(ref));
      await assertSucceeds(setDoc(ref, { ...record, revision: 2 }));
      await assertFails(setDoc(ref, { ...record, revision: 1 }));
      await assertFails(getDoc(doc(partnerDb, `accountPreferences/${UID_A}`)));
      await assertFails(deleteDoc(ref));
    });
  });
});
