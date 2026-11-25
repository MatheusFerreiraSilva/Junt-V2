import { describe, expect, it } from 'vitest';
import {
  calculateAllowanceWave,
  calculateClosingLedgers,
  calculateCycleLiquidity,
  calculateMandatoryGoalAllocation,
  evaluateWaterfall,
  simulateInstallmentPurchase,
} from '../waterfallEngine';
import type { Goal, MedicalShiftRecord } from '../../types/finance';

describe('waterfallEngine (Protocolos B.1 a B.4)', () => {
  it('Cenário Real Tijuca (R$ 26.000 líquidos): cascata 60/30/10, plantões a receber fora do caixa, mesada com teto R$ 3.200 e sobra R$ 5.000', () => {
    const shifts: MedicalShiftRecord[] = [
      {
        id: 'shift-paid-1',
        doctorUid: 'uid-a',
        institution: 'Hospital Tijuca',
        shiftDate: '2026-11-03',
        hours: 24,
        grossAmount: 10000,
        netAmount: 10000,
        status: 'paid',
        expectedPayDate: '2026-11-10',
        paidAt: '2026-11-10',
      },
      {
        id: 'shift-paid-2',
        doctorUid: 'uid-b',
        institution: 'UPA Centro',
        shiftDate: '2026-11-08',
        hours: 24,
        grossAmount: 8000,
        netAmount: 8000,
        status: 'paid',
        expectedPayDate: '2026-11-15',
        paidAt: '2026-11-15',
      },
      {
        id: 'shift-pending',
        doctorUid: 'uid-a',
        institution: 'Hospital Barra',
        shiftDate: '2026-11-18',
        hours: 12,
        grossAmount: 2400,
        netAmount: 2400,
        status: 'pending_payment',
        expectedPayDate: '2026-12-05',
      },
      {
        id: 'shift-scheduled',
        doctorUid: 'uid-b',
        institution: 'Clínica Zona Sul',
        shiftDate: '2026-11-28',
        hours: 12,
        grossAmount: 1800,
        netAmount: 1800,
        status: 'scheduled',
        expectedPayDate: '2026-12-15',
      },
    ];

    const goals: Goal[] = [
      {
        id: 'goal-shield',
        title: 'Escudo de Emergência',
        pillar: 'shield',
        targetAmount: 117500,
        currentAmount: 50000,
        autoAllocateWeight: 50,
      },
      {
        id: 'goal-dreams',
        title: 'Troca de Carro',
        pillar: 'dreams',
        targetAmount: 80000,
        currentAmount: 15000,
        autoAllocateWeight: 30,
      },
      {
        id: 'goal-wealth',
        title: 'Carteira FIIs & ETFs',
        pillar: 'wealth',
        targetAmount: 500000,
        currentAmount: 40000,
        autoAllocateWeight: 20,
      },
    ];

    const result = evaluateWaterfall({
      householdConfig: {
        allowanceFloor: 600,
        allowanceCap: 3200,
        mandatoryGoalRate: 0.1,
        housingCapRate: 0.3,
        structureCapRate: 0.6,
        installmentCapMin: 0.1,
        installmentCapMax: 0.2,
        installmentCapTarget: 0.15,
        defaultShiftTaxRate: 0,
      },
      liquidity: {
        settledIncomes: [{ amount: 8000 }], // Bolsa residência líquida
        shifts,
        previousMonthCarryOver: 0,
      },
      housingTotal: 4500,
      essentialFixedTotal: 1750,
      cancelableFixedTotal: 250,
      installmentsTotal: 2100,
      groceriesAmount: 1800,
      routineAmount: 1100,
      bufferAmount: 500,
      wave: 2,
      goals,
    });

    // Disponibilidade real: apenas R$ 8.000 + R$ 18.000 = R$ 26.000 (R$ 4.200 a receber ficam fora)
    expect(result.liquidity.settledBaseIncomesTotal).toBe(8000);
    expect(result.liquidity.paidShiftsNetTotal).toBe(18000);
    expect(result.liquidity.newNetIncome).toBe(26000);
    expect(result.liquidity.receivableShiftsTotal).toBe(4200);
    expect(result.liquidity.totalAvailableCash).toBe(26000);

    // Degrau 1: 10% obrigatórios no topo = R$ 2.600 (50% / 30% / 20%)
    expect(result.mandatoryGoal.mandatoryGoalAmount).toBe(2600);
    expect(result.mandatoryGoal.mandatoryGoalBreakdown).toEqual([
      { goalId: 'goal-shield', title: 'Escudo de Emergência', pillar: 'shield', amount: 1300, weightUsed: 50 },
      { goalId: 'goal-dreams', title: 'Troca de Carro', pillar: 'dreams', amount: 780, weightUsed: 30 },
      { goalId: 'goal-wealth', title: 'Carteira FIIs & ETFs', pillar: 'wealth', amount: 520, weightUsed: 20 },
    ]);

    // Degrau 2: Moradia 17,3% (<= 30%) e Parcelas 8,1% (<= 15%)
    expect(result.guards.housing.ratio).toBeCloseTo(4500 / 26000, 4);
    expect(result.guards.housing.status).toBe('ok');
    expect(result.guards.installments.ratio).toBeCloseTo(2100 / 26000, 4);
    expect(result.guards.installments.status).toBe('ok');

    // Degrau 3 (B.4): Total Estrutura R$ 12.000 = 46,2% < 60% (economia fica no caixa)
    expect(result.guards.structure.actualStructureTotal).toBe(12000);
    expect(result.guards.structure.capAmount).toBe(15600);
    expect(result.guards.structure.ratio).toBeCloseTo(12000 / 26000, 4);
    expect(result.guards.structure.savingsBelowCap).toBe(3600);
    expect(result.guards.structure.status).toBe('ok');

    // Degrau 4: Mesada Híbrida travada no teto de R$ 3.200/cada
    expect(result.allowance.safeAllowancePool).toBe(11400);
    expect(result.allowance.fullMonthlyAllocationPerPartner).toBe(3200);
    expect(result.allowance.unlockedAllowanceA).toBe(3200);
    expect(result.allowance.unlockedAllowanceB).toBe(3200);
    expect(result.allowance.retainedAboveCapSurplus).toBe(5000);

    // Degrau 5: Sobra do Caixa Comum = R$ 5.000/mês
    expect(result.closingLedgers.closingSurplus).toBe(5000);
    expect(result.closingLedgers.isCashDeficit).toBe(false);
  });

  it('Desconta defaultShiftTaxRate quando plantão pago informa apenas valor bruto equivalente', () => {
    const liquidity = calculateCycleLiquidity({
      settledIncomesTotal: 8000,
      defaultShiftTaxRate: 0.06,
      shifts: [
        {
          id: 'pj-1',
          doctorUid: 'uid-a',
          institution: 'Einstein',
          shiftDate: '2026-11-05',
          hours: 12,
          grossAmount: 2000,
          netAmount: 2000, // ainda sem desconto explícito
          status: 'paid',
          expectedPayDate: '2026-11-15',
          paidAt: '2026-11-15',
        },
      ],
      historicalNetIncomes: [12000, 9000],
    });

    expect(liquidity.paidShiftsNetTotal).toBe(1880);
    expect(liquidity.newNetIncome).toBe(9880);
    // Média móvel de 3 ciclos: (12000 + 9000 + 9880) / 3 = 10293.33
    expect(liquidity.referenceIncome3M).toBe(10293.33);
  });

  it('Mês Apertado: aciona allowanceFloor e usa previousMonthCarryOver para honrar o piso sem negativar o caixa', () => {
    const result = evaluateWaterfall({
      householdConfig: {
        allowanceFloor: 600,
        allowanceCap: 3200,
        mandatoryGoalRate: 0.1,
      },
      liquidity: {
        settledIncomesTotal: 8000,
        previousMonthCarryOver: 500, // Sobra do mês anterior absorve complemento do piso
      },
      housingTotal: 2400,
      essentialFixedTotal: 1100,
      cancelableFixedTotal: 150,
      installmentsTotal: 1150,
      groceriesAmount: 1000,
      routineAmount: 500,
      bufferAmount: 100, // Estrutura = 6400
      wave: 2,
    });

    // newNetIncome = 8000; meta 10% = 800; estrutura = 6400 -> safeAllowancePool = 800
    // Piso individual = 600 -> 1200 total (faltariam 400 na renda nova, cobertos pelos 500 de carry-over)
    expect(result.liquidity.totalAvailableCash).toBe(8500);
    expect(result.allowance.safeAllowancePool).toBe(800);
    expect(result.allowance.fullMonthlyAllocationPerPartner).toBe(600);
    expect(result.allowance.floorComplementRequired).toBe(400);
    expect(result.closingLedgers.carryOverAbsorbedForAllowanceFloor).toBe(400);
    expect(result.closingLedgers.closingSurplus).toBe(100);
    expect(result.closingLedgers.isCashDeficit).toBe(false);
  });

  it('Liberação em 2 Ondas: Onda 1 libera apenas allowanceFloor e guarda complemento até Onda 2', () => {
    const wave1 = calculateAllowanceWave({
      newNetIncome: 26000,
      mandatoryGoalAmount: 2600,
      actualStructureTotal: 12000,
      allowanceFloor: 600,
      allowanceCap: 3200,
      wave: 1,
    });

    expect(wave1.unlockedAllowanceA).toBe(600);
    expect(wave1.unlockedAllowanceB).toBe(600);
    expect(wave1.fullMonthlyAllocationPerPartner).toBe(3200);
    expect(wave1.pendingWave2ComplementPerPartner).toBe(2600);

    const wave2 = calculateAllowanceWave({
      newNetIncome: 26000,
      mandatoryGoalAmount: 2600,
      actualStructureTotal: 12000,
      allowanceFloor: 600,
      allowanceCap: 3200,
      wave: 2,
    });

    expect(wave2.unlockedAllowanceA).toBe(3200);
    expect(wave2.unlockedAllowanceB).toBe(3200);
    expect(wave2.pendingWave2ComplementPerPartner).toBe(0);
  });

  it('Mesada Híbrida + Duplo Ledger: desconta 100% solo, 50/50 Dos Dois, Enviar Turbo e Ajudar nas Metas', () => {
    const ledgers = calculateClosingLedgers({
      totalAvailableCash: 26000,
      mandatoryGoalAmount: 2600,
      actualStructureTotal: 12000,
      unlockedAllowanceA: 3200,
      unlockedAllowanceB: 3200,
      allowanceFloor: 600,
      sharedAllowanceExpensesTotal: 500, // Jantar romântico Dos Dois -> R$ 250 de cada
      boostTransfers: [
        {
          fromUid: 'uid-a',
          toUid: 'uid-b',
          amount: 300, // Enviar Turbo silencioso de A para B
          createdAt: '2026-11-18T12:00:00.000Z',
        },
      ],
      partnerA: {
        uid: 'uid-a',
        rolloverFromPrevious: 200,
        soloSpent: 900,
        personalInstallments: 250, // <= 50% de 600 (300)
        sweptToSharedGoals: 400, // Ajudar nas Metas
      },
      partnerB: {
        uid: 'uid-b',
        rolloverFromPrevious: 100,
        soloSpent: 1200,
        personalInstallments: 350, // > 50% de 600 (300) -> alerta de limite
        sweptToSharedGoals: 0,
      },
    });

    // Parceiro A: 200 + 3200 - 300 (turbo enviado) - 900 (solo) - 250 (parcela) - 250 (dos dois) - 400 (meta) = 1300
    expect(ledgers.walletA.boostsNet).toBe(-300);
    expect(ledgers.walletA.jointAllowanceShareSpent).toBe(250);
    expect(ledgers.walletA.closingBalance).toBe(1300);
    expect(ledgers.walletA.isPersonalInstallmentWithinLimit).toBe(true);

    // Parceiro B: 100 + 3200 + 300 (turbo recebido) - 1200 (solo) - 350 (parcela) - 250 (dos dois) - 0 = 1800
    expect(ledgers.walletB.boostsNet).toBe(300);
    expect(ledgers.walletB.jointAllowanceShareSpent).toBe(250);
    expect(ledgers.walletB.closingBalance).toBe(1800);
    expect(ledgers.walletB.isPersonalInstallmentWithinLimit).toBe(false);

    // Sobra do Caixa Comum permanece inalterada pelos gastos privados da mesada
    expect(ledgers.closingSurplus).toBe(5000);
  });

  it('Respeita fixedAmount e pesos de goalAllocationRules na distribuição dos 10% obrigatórios', () => {
    const res = calculateMandatoryGoalAllocation({
      newNetIncome: 10000,
      mandatoryGoalRate: 0.1,
      goals: [
        { id: 'g1', title: 'Escudo', pillar: 'shield', targetAmount: 50000, currentAmount: 10000, autoAllocateWeight: 10 },
        { id: 'g2', title: 'Apartamento', pillar: 'dreams', targetAmount: 200000, currentAmount: 20000, autoAllocateWeight: 10 },
      ],
      goalAllocationRules: [
        { goalId: 'g1', weight: 1, fixedAmount: 400 },
        { goalId: 'g2', weight: 3 },
      ],
    });

    // R$ 1.000 total: g1 recebe R$ 400 fixo + 1/4 dos R$ 600 restantes = R$ 550; g2 recebe 3/4 de R$ 600 = R$ 450
    expect(res.mandatoryGoalAmount).toBe(1000);
    expect(res.mandatoryGoalBreakdown[0].amount).toBe(550);
    expect(res.mandatoryGoalBreakdown[1].amount).toBe(450);
  });

  it('Simulador "Posso Parcelar?": aprovação (<= 15%), cautela (15%-20%) e bloqueio (> 20%)', () => {
    const approved = simulateInstallmentPurchase({
      purchaseAmount: 3000,
      installmentsCount: 6, // R$ 500/mês
      currentInstallmentsTotal: 2000, // total 2500 / 20000 = 12,5%
      referenceIncome3M: 20000,
      startCycleId: '2026_11',
      currentNewNetIncome: 20000,
      currentActualStructureTotal: 11000, // pool=7000 -> 3500 > teto 3200 (amortecido pelo excesso)
      householdConfig: { allowanceFloor: 600, allowanceCap: 3200 },
    });

    expect(approved.monthlyInstallment).toBe(500);
    expect(approved.projectedInstallmentRatio).toBeCloseTo(0.125, 4);
    expect(approved.verdict).toBe('approved');
    expect(approved.payoffCycleId).toBe('2027_04');
    expect(approved.allowanceReductionPerPartner).toBe(0);

    // Dentro da banda ativa [floor=600, cap=3200], R$ 500/mês reduz R$ 250 da mesada de cada parceiro
    const activeBandImpact = simulateInstallmentPurchase({
      purchaseAmount: 3000,
      installmentsCount: 6, // R$ 500/mês
      currentInstallmentsTotal: 1500, // total 2000 / 15000 = 13,3%
      referenceIncome3M: 15000,
      startCycleId: '2026_11',
      currentNewNetIncome: 15000,
      currentActualStructureTotal: 8500, // meta=1500 -> pool=5000 (2500/cada) -> com +500 fica 4500 (2250/cada)
      householdConfig: { allowanceFloor: 600, allowanceCap: 3200 },
    });

    expect(activeBandImpact.verdict).toBe('approved');
    expect(activeBandImpact.allowanceReductionPerPartner).toBe(250);

    const caution = simulateInstallmentPurchase({
      purchaseAmount: 6000,
      installmentsCount: 4, // R$ 1.500/mês -> total 3500 / 20000 = 17,5%
      currentInstallmentsTotal: 2000,
      referenceIncome3M: 20000,
      startCycleId: '2026_11',
    });

    expect(caution.verdict).toBe('caution');
    expect(caution.projectedInstallmentRatio).toBeCloseTo(0.175, 4);

    const blocked = simulateInstallmentPurchase({
      purchaseAmount: 12000,
      installmentsCount: 4, // R$ 3.000/mês -> total 5000 / 20000 = 25%
      currentInstallmentsTotal: 2000,
      referenceIncome3M: 20000,
      startCycleId: '2026_11',
    });

    expect(blocked.verdict).toBe('blocked');
    expect(blocked.projectedInstallmentRatio).toBeCloseTo(0.25, 4);
  });
});
