import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from '../HomeScreen';
import { CoupleHubScreen } from '../CoupleHubScreen';
import { InstallmentsScreen } from '../InstallmentsScreen';

vi.mock('../../avatars/AvatarUI', () => ({
  AvatarHero: () => <div data-testid="avatar-hero" />,
}));

vi.mock('../../components/MonthSelector', () => ({
  MonthSelector: () => <div data-testid="month-selector">Novembro 2026</div>,
}));

vi.mock('../../components/AdvanceInstallmentModal', () => ({
  AdvanceInstallmentModal: () => null,
}));

const mockActions = vi.hoisted(() => ({
  closeCycleAndRouteSurplus: vi.fn().mockResolvedValue(undefined),
  simulateInstallment: vi.fn(),
  sendAllowanceBoost: vi.fn().mockResolvedValue(undefined),
  sweepAllowanceToGoals: vi.fn().mockResolvedValue(undefined),
  toggleAllowanceWave: vi.fn().mockResolvedValue(2),
  addCascadeTransaction: vi.fn().mockResolvedValue(undefined),
  recordInstallmentPayment: vi.fn(),
  reverseInstallmentPayment: vi.fn(),
  deleteInstallment: vi.fn(),
  updateProfile: vi.fn(),
}));

const baseMockContext = vi.hoisted(() => ({
  state: {
    appMode: 'casal',
    currentMonth: '2026-11',
    profile: {
      partner1Name: 'Ana',
      partner2Name: 'Bruno',
      partner1Income: 12000,
      partner2Income: 12000,
    },
    pendingConfirmations: [],
    installments: [],
  },
  currentUser: { uid: 'uid-ana', displayName: 'Ana Silva' },
  activeCycleId: '2026-11',
  activeWave: 1 as 1 | 2,
  householdConfig: {
    memberUids: ['uid-ana', 'uid-bruno'],
    memberTaxIds: [],
    cycleStartDay: 1,
    mandatoryGoalRate: 0.1,
    housingCapRate: 0.3,
    structureCapRate: 0.6,
    installmentCapMin: 0.1,
    installmentCapTarget: 0.15,
    installmentCapMax: 0.2,
    allowanceFloor: 600,
    allowanceCap: 2500,
    shieldFloorMonths: 4,
    shieldTargetMonths: 10,
  },
  v23Preferences: {
    wave2Day: 15,
    defaultGroceriesBudget: 2500,
    defaultRoutineBudget: 1800,
    defaultBufferLimit: 1000,
  },
  activeBudgetCycle: {
    id: '2026-11',
    cycleId: '2026-11',
    surplusRouting: 'carry_over' as const,
  },
  waterfallResult: {
    liquidity: {
      newNetIncome: 24000,
      previousMonthCarryOver: 1200,
      totalAvailableCash: 25200,
      referenceIncome3M: 22000,
      paidShiftsNetTotal: 4000,
      scheduledShiftsTotal: 2500,
      pendingPaymentShiftsTotal: 1500,
      receivableShiftsTotal: 4000,
    },
    mandatoryGoal: {
      mandatoryGoalRate: 0.1,
      mandatoryGoalAmount: 2520,
      mandatoryGoalBreakdown: [
        { goalId: 'g-shield', title: 'Escudo do Casal', amount: 1520 },
        { goalId: 'g-trip', title: 'Viagem Japão', amount: 1000 },
      ],
    },
    guards: {
      housing: {
        total: 5200,
        ratio: 5200 / 25200,
        capRate: 0.3,
        capAmount: 7560,
        status: 'ok' as const,
      },
      installments: {
        total: 1800,
        referenceIncome3M: 22000,
        ratio: 1800 / 22000,
        minRate: 0.1,
        targetRate: 0.15,
        maxRate: 0.2,
        minAmount: 2200,
        targetAmount: 3300,
        max20Amount: 4400,
        marginToMax: 2600,
        status: 'ok' as const,
      },
      structure: {
        housingTotal: 5200,
        essentialFixedTotal: 2100,
        cancelableFixedTotal: 350,
        groceriesAmount: 2400,
        routineAmount: 1500,
        bufferAmount: 400,
        actualStructureTotal: 13750,
        capRate: 0.6,
        capAmount: 15120,
        ratio: 13750 / 25200,
        savingsBelowCap: 1370,
        status: 'ok' as const,
      },
    },
    allowance: {
      pendingWave2ComplementPerPartner: 400,
      releasedTotal: 1200,
      perPartnerAmount: 600,
    },
    closingLedgers: {
      closingSurplus: 7730,
    },
  },
  shieldMetrics: {
    currentCoverageMonths: 6.2,
    shieldTargetMonths: 10,
    shieldFloorMonths: 4,
    currentShieldBalance: 48000,
    essentialMonthlyBase: 7700,
  },
  myAllowanceWallet: {
    id: 'uid-ana_2026-11',
    uid: 'uid-ana',
    cycleId: '2026-11',
    rolloverFromPrevious: 300,
    monthlyAllocation: 600,
    boostsNet: 100,
    soloSpent: 150,
    jointAllowanceShareSpent: 200,
    sweptToSharedGoals: 50,
    closingBalance: 600,
  },
  myAllowanceExpenses: [
    {
      id: 'solo-1',
      cycleId: '2026-11',
      title: 'Café especial secreto',
      amount: 150,
      date: '2026-11-04',
    },
  ],
  v23SharedAllowanceExpenses: [
    {
      id: 'shared-1',
      cycleId: '2026-11',
      title: 'Jantar Japonês',
      totalAmount: 400,
      splitPerPartner: 200,
      date: '2026-11-06',
      category: 'jantar_fora',
    },
  ],
  v23Goals: [
    {
      id: 'g-trip',
      title: 'Viagem Japão',
      currentAmount: 12000,
      targetAmount: 30000,
    },
  ],
  v23InstallmentPlans: [
    {
      id: 'plan-1',
      title: 'Sofá Modular',
      installmentAmount: 600,
      currentInstallment: 2,
      totalInstallments: 6,
      startCycleId: '2026-10',
      endCycleId: '2027-03',
    },
  ],
  activeInstallments: [],
  dualLedgerHistory6M: [
    { cycleId: '2026-06', label: 'Jun', commonSurplus: 3000, personalAllowanceSurplus: 120 },
    { cycleId: '2026-07', label: 'Jul', commonSurplus: 4200, personalAllowanceSurplus: 240 },
    { cycleId: '2026-08', label: 'Ago', commonSurplus: 5100, personalAllowanceSurplus: 310 },
    { cycleId: '2026-09', label: 'Set', commonSurplus: 4800, personalAllowanceSurplus: 450 },
    { cycleId: '2026-10', label: 'Out', commonSurplus: 6100, personalAllowanceSurplus: 300 },
    { cycleId: '2026-11', label: 'Nov', commonSurplus: 7730, personalAllowanceSurplus: 600 },
  ],
}));

vi.mock('../../context/FinanceContext', () => ({
  CATEGORIES_BASE: {
    moradia: { key: 'moradia', name: 'Moradia', emoji: '🏠', colorHex: '#0ea5e9' },
  },
  useFinance: () => ({
    ...baseMockContext,
    ...mockActions,
  }),
}));

describe('v2.3 Screens Integration (Cascata 60/30/10, Mesada Híbrida & Trava de Parcelas)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActions.simulateInstallment.mockImplementation(({ purchaseAmount, installmentsCount }) => {
      const monthly = purchaseAmount / Math.max(1, installmentsCount);
      const projectedRatio = (1800 + monthly) / 22000;
      if (projectedRatio > 0.2) {
        return {
          verdict: 'blocked' as const,
          monthlyInstallment: monthly,
          projectedInstallmentRatio: projectedRatio,
          allowanceReductionPerPartner: monthly / 2,
          payoffCycleId: '2027-04',
          reason: 'Bloqueado: ultrapassa o teto de 20% da renda 3M.',
        };
      }
      if (projectedRatio > 0.15) {
        return {
          verdict: 'caution' as const,
          monthlyInstallment: monthly,
          projectedInstallmentRatio: projectedRatio,
          allowanceReductionPerPartner: monthly / 2,
          payoffCycleId: '2027-04',
          reason: 'Cautela: entra na zona entre 15% e 20% da renda 3M.',
        };
      }
      return {
        verdict: 'approved' as const,
        monthlyInstallment: monthly,
        projectedInstallmentRatio: projectedRatio,
        allowanceReductionPerPartner: monthly / 2,
        payoffCycleId: '2027-04',
        reason: 'Liberado: dentro do alvo saudável até 15% da renda 3M.',
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('HomeScreen renders Cascata 60/30/10, Moradia 30%, Trava de Parcelas, 6M Dual Ledger SVG, Plantões a Receber, and routes surplus', async () => {
    const onNavigate = vi.fn();
    render(
      <HomeScreen
        onNavigate={onNavigate}
        onOpenExpenseModal={() => {}}
        onOpenIncomeModal={() => {}}
        onOpenInstallmentModal={() => {}}
        onOpenDepositModal={() => {}}
      />
    );

    expect(screen.getByText('Cascata Financeira do Casal')).toBeInTheDocument();
    expect(screen.getByText(/Dinheiro Disponível no Mês/i)).toBeInTheDocument();
    expect(screen.getByText(/Bloco 1 · Meta Obrigatória \(10%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Bloco 2 · Estrutura de Vida \(Teto 60%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Bloco 3 · Trava de Parcelas/i)).toBeInTheDocument();
    expect(screen.getByText(/Moradia/i)).toBeInTheDocument();
    expect(screen.getByText(/Fixos Canceláveis/i)).toBeInTheDocument();
    expect(screen.getByText(/Fora da Reserva/i)).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Gráfico de evolução de 6 meses do Duplo Ledger de Sobras/i })
    ).toBeInTheDocument();

    // Plantões a Receber shortcut navigates to shifts screen
    fireEvent.click(screen.getByRole('button', { name: /Plantões a Receber/i }));
    expect(onNavigate).toHaveBeenCalledWith('shifts');

    // Cycle closing routing action
    fireEvent.click(screen.getByRole('button', { name: /Enviar sobra para Metas/i }));
    await waitFor(() => {
      expect(mockActions.closeCycleAndRouteSurplus).toHaveBeenCalledWith('goals');
    });

    // Zero legacy split/settlement jargon
    expect(screen.queryByText(/Divisão de Gastos/i)).toBeNull();
    expect(screen.queryByText(/Acerto do mês/i)).toBeNull();
  });

  it('CoupleHubScreen isolates private wallet, supports Turbo, Sweep & Wave toggle, and hides partner solo expenses', async () => {
    render(<CoupleHubScreen />);

    expect(screen.getByText('Mesada Híbrida')).toBeInTheDocument();
    expect(screen.getByText(/Programas a Dois \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('Jantar Japonês')).toBeInTheDocument();

    // Wave toggle calls toggleAllowanceWave
    fireEvent.click(screen.getByRole('button', { name: /Liberar Onda 2/i }));
    await waitFor(() => {
      expect(mockActions.toggleAllowanceWave).toHaveBeenCalledOnce();
    });

    // Turbo modal submits sendAllowanceBoost without reason or debt
    fireEvent.click(screen.getByRole('button', { name: /Enviar Turbo para Bruno/i }));
    fireEvent.change(screen.getByLabelText(/Valor do Turbo/i), { target: { value: '350' } });
    fireEvent.click(screen.getByRole('button', { name: /^Enviar Turbo$/i }));
    await waitFor(() => {
      expect(mockActions.sendAllowanceBoost).toHaveBeenCalledWith(350);
    });

    // Sweep to shared goal submits sweepAllowanceToGoals
    fireEvent.click(screen.getByRole('button', { name: /Ajudar nas Metas/i }));
    fireEvent.change(screen.getByLabelText(/Valor do aporte/i), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: /Registrar Aporte Extra de Ana/i }));
    await waitFor(() => {
      expect(mockActions.sweepAllowanceToGoals).toHaveBeenCalledWith('g-trip', 200);
    });

    // Switch to private tab shows own solo expenses only
    fireEvent.click(screen.getByRole('tab', { name: /Meus Gastos Livres/i }));
    expect(screen.getByText('Café especial secreto')).toBeInTheDocument();
    expect(screen.getByText(/Lista privada de Ana — nunca exibida na conta de Bruno/i)).toBeInTheDocument();
    expect(screen.queryByText(/Saldo de Bruno/i)).toBeNull();
  });

  it('InstallmentsScreen Posso Parcelar simulator transitions across approved, caution, and blocked verdicts', () => {
    render(<InstallmentsScreen onOpenInstallmentModal={() => {}} />);

    expect(screen.getByText(/Trava de Parcelas \(10%–20% Renda 3M\)/i)).toBeInTheDocument();
    expect(screen.getByText('Simulador: Posso Parcelar?')).toBeInTheDocument();

    const amountInput = screen.getByLabelText('Valor total (R$)');
    const countSelect = screen.getByLabelText('Parcelas (x)');

    // 1. Approved: +R$ 600/mês => (1800 + 600) / 22000 = 10.9% <= 15%
    fireEvent.change(amountInput, { target: { value: '3600' } });
    fireEvent.change(countSelect, { target: { value: '6' } });
    expect(screen.getByText('Liberado')).toBeInTheDocument();

    // 2. Caution: +R$ 2.000/mês => (1800 + 2000) / 22000 = 17.3% (15% < x <= 20%)
    fireEvent.change(amountInput, { target: { value: '12000' } });
    fireEvent.change(countSelect, { target: { value: '6' } });
    expect(screen.getByText('Cautela')).toBeInTheDocument();

    // 3. Blocked: +R$ 3.500/mês => (1800 + 3500) / 22000 = 24.1% > 20%
    fireEvent.change(amountInput, { target: { value: '21000' } });
    fireEvent.change(countSelect, { target: { value: '6' } });
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Registrar Parcela/i })).toBeDisabled();
  });
});
