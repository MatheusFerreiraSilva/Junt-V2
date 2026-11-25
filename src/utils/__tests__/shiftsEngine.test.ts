import { describe, it, expect } from 'vitest';
import {
  calculateEstimatedPayDate,
  calculateShiftNetAmount,
  createMedicalShiftRecord,
  transitionShiftStatus,
  summarizeShiftsForCycle,
  findMatchingShiftForCredit,
  calculateShiftMetrics,
  calculateHourlyYieldRanking,
  calculateShiftRecommendations,
  projectCashFlowTimeline,
  findMatchingBankIncomesForShift,
  getSampleMedicalShifts,
} from '../shiftsEngine';
import { reconcileShiftPayment } from '../shiftReconciliation';
import { calculateCycleLiquidity } from '../../domain/waterfallEngine';
import type {
  MedicalShift,
  MedicalShiftRecord,
  IncomeItem,
  HospitalIncomeMappingRule,
} from '../../types/finance';

describe('shiftsEngine v2.3: Competência vs Caixa Realizado & Impostos', () => {
  it('aplica defaultShiftTaxRate (0% na graduação, configurável em PJ/RPA) ao criar plantão', () => {
    const gradShift = createMedicalShiftRecord(
      {
        id: 'sh-grad',
        doctorUid: 'uid-a',
        institution: 'Hospital Universitário',
        shiftDate: '2026-11-05',
        hours: 12,
        grossAmount: 1200,
        status: 'scheduled',
      },
      0
    );
    expect(gradShift.grossAmount).toBe(1200);
    expect(gradShift.netAmount).toBe(1200);
    expect(gradShift.paidAt).toBeNull();

    const pjShift = createMedicalShiftRecord(
      {
        id: 'sh-pj',
        doctorUid: 'uid-a',
        institution: 'Hospital Barra DOr',
        shiftDate: '2026-11-06',
        hours: 12,
        grossAmount: 2000,
        status: 'pending_payment',
      },
      0.06
    );
    expect(calculateShiftNetAmount(2000, 0.06)).toBe(1880);
    expect(pjShift.netAmount).toBe(1880);
    expect(pjShift.paidAt).toBeNull();
  });

  it('NUNCA injeta plantões scheduled ou pending_payment em newNetIncome nem no teto de parcelas', () => {
    const shifts: MedicalShiftRecord[] = [
      {
        id: 'sh-sched',
        doctorUid: 'uid-a',
        institution: 'UPA Tijuca',
        shiftDate: '2026-11-28',
        hours: 12,
        grossAmount: 1500,
        netAmount: 1500,
        status: 'scheduled',
        expectedPayDate: '2026-12-28',
        paidAt: null,
      },
      {
        id: 'sh-pending',
        doctorUid: 'uid-a',
        institution: 'Samaritano',
        shiftDate: '2026-11-05',
        hours: 12,
        grossAmount: 2000,
        netAmount: 1880,
        status: 'pending_payment',
        expectedPayDate: '2026-11-25',
        paidAt: null,
      },
      {
        id: 'sh-paid',
        doctorUid: 'uid-a',
        institution: 'Copa DOr',
        shiftDate: '2026-10-15',
        hours: 12,
        grossAmount: 2000,
        netAmount: 1880,
        status: 'paid',
        expectedPayDate: '2026-11-10',
        paidAt: '2026-11-10',
      },
    ];

    const summary = summarizeShiftsForCycle(shifts, '2026_11');
    expect(summary.paidShiftsNetTotal).toBe(1880);
    expect(summary.scheduledShiftsNetTotal).toBe(1500);
    expect(summary.pendingPaymentShiftsNetTotal).toBe(1880);
    expect(summary.receivableShiftsNetTotal).toBe(3380);

    const liquidity = calculateCycleLiquidity({
      settledIncomesTotal: 4000,
      shifts,
    });
    expect(liquidity.newNetIncome).toBe(5880); // 4000 + 1880 apenas (NUNCA +3380!)
    expect(liquidity.receivableShiftsTotal).toBe(3380);
  });

  it('executa transição scheduled -> pending_payment -> paid via reconcileShiftPayment e recalcula BudgetCycle', () => {
    const scheduled = createMedicalShiftRecord({
      id: 'sh-flow',
      doctorUid: 'uid-a',
      institution: 'Hospital Quinta DOr',
      shiftDate: '2026-11-02',
      hours: 12,
      grossAmount: 2000,
      taxReserveRate: 0.1,
      status: 'scheduled',
    });

    const performed = transitionShiftStatus(scheduled, 'pending_payment');
    expect(performed.status).toBe('pending_payment');
    expect(performed.paidAt).toBeNull();

    const reconciled = reconcileShiftPayment({
      shifts: [performed],
      shiftId: 'sh-flow',
      paidAt: '2026-11-18',
      settledBaseIncomesTotal: 5000,
      housingTotal: 1800,
      essentialFixedTotal: 500,
      groceriesBudget: 900,
      routineBudget: 400,
      householdConfig: {
        allowanceFloor: 600,
        allowanceCap: 3200,
      },
    });

    expect(reconciled.updatedShift.status).toBe('paid');
    expect(reconciled.updatedShift.paidAt).toBe('2026-11-18');
    expect(reconciled.cycleId).toBe('2026_11');
    // 5000 base + 1800 (2000 - 10% imposto) = 6800
    expect(reconciled.budgetCycle.newNetIncome).toBe(6800);
    expect(reconciled.budgetCycle.mandatoryGoalAmount).toBe(680);
    expect(reconciled.budgetCycle.unlockedAllowanceA).toBeGreaterThanOrEqual(600);
  });

  it('encontra plantão pending_payment compatível com crédito do extrato CSV', () => {
    const shifts: MedicalShiftRecord[] = [
      {
        id: 'sh-match',
        doctorUid: 'uid-a',
        institution: 'Hospital Copa Star',
        shiftDate: '2026-10-28',
        hours: 12,
        grossAmount: 2500,
        netAmount: 2350,
        status: 'pending_payment',
        expectedPayDate: '2026-11-15',
        paidAt: null,
      },
    ];

    const match = findMatchingShiftForCredit(
      {
        amount: 2350,
        description: 'TED COPA STAR REPASSE',
        date: '2026-11-15',
      },
      shifts
    );

    expect(match.exactMatch?.id).toBe('sh-match');
    expect(match.candidates[0].exactAmountMatch).toBe(true);
    expect(match.candidates[0].institutionMatch).toBe(true);
  });
});

describe('shiftsEngine: Adaptadores de Transição Legada (Etapa 4)', () => {
  it('calcula data estimada de pagamento somando o delay de dias', () => {
    expect(calculateEstimatedPayDate('2026-10-10', 30)).toBe('2026-11-09');
  });

  it('calcula métricas mensais e ranking R$/hora sem dados inventados', () => {
    const shifts: MedicalShift[] = [
      {
        id: 's1',
        partner: 'partner1',
        title: 'UTI 12h',
        hospitalName: "Hospital Copa D'Or",
        sector: 'uti',
        contractType: 'pj_privado',
        dateWorked: '2026-10-05',
        durationHours: 12,
        grossAmount: 1800,
        estimatedPayDate: '2026-11-20',
        status: 'pending',
      },
      {
        id: 's2',
        partner: 'partner2',
        title: 'Porta 12h',
        hospitalName: 'RioSaúde CER',
        sector: 'porta',
        contractType: 'clt',
        dateWorked: '2026-10-12',
        durationHours: 12,
        grossAmount: 1500,
        netAmount: 1400,
        estimatedPayDate: '2026-10-20',
        status: 'received',
      },
    ];

    const metrics = calculateShiftMetrics(shifts, '2026-10');
    expect(metrics.totalHours).toBe(24);
    expect(metrics.totalGross).toBe(3300);
    expect(metrics.totalReceived).toBe(1400);
    expect(metrics.totalPending).toBe(1800);

    const ranking = calculateHourlyYieldRanking(shifts);
    expect(ranking[0].hospitalName).toBe("Hospital Copa D'Or");

    const rec = calculateShiftRecommendations(5000, 8000, 15000, 1500, '2026-11', 'Novembro');
    expect(rec.shiftsToCoverFixed).toBe(2);

    const timeline = projectCashFlowTimeline(getSampleMedicalShifts('2026-10'), 8000, 16000, '2026-10', 4);
    expect(timeline.length).toBe(4);
  });

  it('concilia plantão legado apenas com depósito do mesmo médico', () => {
    const shift: MedicalShift = {
      id: 'shift-1',
      partner: 'partner1',
      title: 'Plantão UPA',
      hospitalName: 'UPA 24h Tijuca / OSS',
      sector: 'porta',
      contractType: 'pj_oss',
      dateWorked: '2026-08-10',
      durationHours: 12,
      grossAmount: 1350,
      estimatedPayDate: '2026-10-10',
      status: 'pending',
    };
    const rules: HospitalIncomeMappingRule[] = [
      {
        id: 'r1',
        hospitalName: 'UPA 24h Tijuca / OSS',
        keywordPattern: 'VIVA RIO',
        createdAt: '2026-10-01',
      },
    ];
    const incomes: IncomeItem[] = [
      {
        id: 'inc-1',
        description: 'TED VIVA RIO REPASSE MEDICO',
        amount: 1350,
        date: '2026-10-09',
        recipient: 'partner1',
        type: 'salario',
      },
      {
        id: 'inc-other',
        description: 'TED VIVA RIO REPASSE MEDICO',
        amount: 1350,
        date: '2026-10-09',
        recipient: 'partner2',
        type: 'salario',
      },
    ];

    const res = findMatchingBankIncomesForShift(shift, incomes, rules);
    expect(res.exactMatches).toHaveLength(1);
    expect(res.exactMatches[0].id).toBe('inc-1');
  });
});
