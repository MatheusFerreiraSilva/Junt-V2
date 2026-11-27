import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Lock,
  Plus,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react';
import { AvatarHero } from '../avatars/AvatarUI';
import { ActiveIncomeConfirmationModal } from '../components/ActiveIncomeConfirmationModal';
import { CollegeModeView } from '../components/CollegeModeView';
import { MonthSelector } from '../components/MonthSelector';
import { ScreenId } from '../components/Navigation';
import { useFinance } from '../context/FinanceContext';
import { CategoryKey, ExpenseItem, PendingIncomeConfirmation, SurplusRouting } from '../types/finance';
import { formatCurrency, formatMonthYear } from '../utils/formatters';

interface HomeScreenProps {
  onNavigate: (screen: ScreenId, categoryKey?: CategoryKey) => void;
  onOpenExpenseModal: (
    categoryKey?: CategoryKey,
    date?: string,
    toEdit?: ExpenseItem | null,
    isDivided?: boolean
  ) => void;
  onOpenIncomeModal: () => void;
  onOpenInstallmentModal: () => void;
  onOpenDepositModal: (bankId: string) => void;
  onOpenAIOnboardingModal?: () => void;
  onOpenBankSyncModal?: () => void;
  onOpenWeeklyPulse?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onNavigate,
  onOpenExpenseModal,
  onOpenIncomeModal,
  onOpenBankSyncModal,
}) => {
  const {
    state,
    waterfallResult,
    shieldMetrics,
    myAllowanceWallet,
    activeWave,
    v23Preferences,
    dualLedgerHistory6M,
    activeBudgetCycle,
    closeCycleAndRouteSurplus,
    simulateInstallment,
    householdConfig,
    currentUser,
    verifiableCashSummary,
  } = useFinance();

  const [structureExpanded, setStructureExpanded] = useState(true);
  const [selectedConfirmation, setSelectedConfirmation] =
    useState<PendingIncomeConfirmation | null>(null);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingMessage, setRoutingMessage] = useState<string | null>(null);

  // Quick pre-purchase simulator drawer state
  const [showQuickSimulator, setShowQuickSimulator] = useState(false);
  const [simAmount, setSimAmount] = useState('1200');
  const [simInstallments, setSimInstallments] = useState('6');

  const quickSimResult = useMemo(() => {
    const val = parseFloat(simAmount.replace(',', '.')) || 0;
    const count = parseInt(simInstallments, 10) || 1;
    return simulateInstallment({
      purchaseAmount: val,
      installmentsCount: count,
      scope: 'house',
    });
  }, [simAmount, simInstallments, simulateInstallment]);

  if (state.appMode === 'faculdade') {
    return <CollegeModeView onOpenExpenseModal={() => onOpenExpenseModal()} />;
  }

  const { liquidity, mandatoryGoal, guards, allowance, closingLedgers } = waterfallResult;
  const { housing, installments, structure } = guards;
  const pendingConfirmations = state.pendingConfirmations || [];

  const structurePct = Math.min(100, Math.round((structure.ratio / Math.max(0.01, structure.capRate)) * 100));
  const housingPct = Math.min(100, Math.round((housing.ratio / Math.max(0.01, housing.capRate)) * 100));
  const installmentTrackPct = Math.min(
    100,
    Math.round((installments.ratio / Math.max(0.01, installments.maxRate)) * 100)
  );

  const subEnvelopes = [
    {
      key: 'housing',
      label: 'Moradia',
      amount: structure.housingTotal,
      sub: `${(housing.ratio * 100).toFixed(1)}% da renda · Teto ${(housing.capRate * 100).toFixed(0)}% (${formatCurrency(housing.capAmount)})`,
      ratio: housingPct,
      status: housing.status,
      note: null as string | null,
    },
    {
      key: 'fixed_essential',
      label: 'Fixos Essenciais',
      amount: structure.essentialFixedTotal,
      sub: 'Luz, água, internet, planos e seguros',
      ratio:
        structure.capAmount > 0
          ? Math.min(100, Math.round((structure.essentialFixedTotal / structure.capAmount) * 100))
          : 0,
      status: 'ok' as const,
      note: null,
    },
    {
      key: 'fixed_cancelable',
      label: 'Fixos Canceláveis',
      amount: structure.cancelableFixedTotal,
      sub: 'Assinaturas e streamings',
      ratio:
        structure.capAmount > 0
          ? Math.min(100, Math.round((structure.cancelableFixedTotal / structure.capAmount) * 100))
          : 0,
      status: 'ok' as const,
      note: 'Fora da Reserva',
    },
    {
      key: 'groceries',
      label: 'Compra do Mês',
      amount: structure.groceriesAmount,
      sub: 'Supermercado, feira e abastecimento',
      ratio:
        structure.capAmount > 0
          ? Math.min(100, Math.round((structure.groceriesAmount / structure.capAmount) * 100))
          : 0,
      status: 'ok' as const,
      note: null,
    },
    {
      key: 'routine',
      label: 'Rotina',
      amount: structure.routineAmount,
      sub: 'Mobilidade, farmácia e dia a dia',
      ratio:
        structure.capAmount > 0
          ? Math.min(100, Math.round((structure.routineAmount / structure.capAmount) * 100))
          : 0,
      status: 'ok' as const,
      note: null,
    },
    {
      key: 'buffer',
      label: 'Buffer de Imprevistos',
      amount: structure.bufferAmount,
      sub: 'Colchão rápido antes de acionar o Escudo',
      ratio:
        structure.capAmount > 0
          ? Math.min(100, Math.round((structure.bufferAmount / structure.capAmount) * 100))
          : 0,
      status: 'ok' as const,
      note: null,
    },
  ];

  // Dual-ledger 6M SVG geometry
  const svgWidth = 560;
  const svgHeight = 164;
  const padX = 28;
  const padY = 20;
  const allChartValues = dualLedgerHistory6M.flatMap((pt) => [
    pt.commonSurplus,
    pt.personalAllowanceSurplus,
    0,
  ]);
  const maxVal = Math.max(500, ...allChartValues);
  const minVal = Math.min(0, ...allChartValues);
  const span = Math.max(100, maxVal - minVal);
  const xAt = (idx: number) =>
    dualLedgerHistory6M.length <= 1
      ? svgWidth / 2
      : padX + (idx / (dualLedgerHistory6M.length - 1)) * (svgWidth - padX * 2);
  const yAt = (val: number) =>
    padY + (1 - (val - minVal) / span) * (svgHeight - padY * 2);

  const commonPolyline = dualLedgerHistory6M
    .map((pt, i) => `${xAt(i)},${yAt(pt.commonSurplus)}`)
    .join(' ');
  const allowancePolyline = dualLedgerHistory6M
    .map((pt, i) => `${xAt(i)},${yAt(pt.personalAllowanceSurplus)}`)
    .join(' ');

  const handleCloseCycle = async (routing: SurplusRouting) => {
    setRoutingBusy(true);
    setRoutingMessage(null);
    try {
      await closeCycleAndRouteSurplus(routing);
      setRoutingMessage(
        routing === 'carry_over'
          ? 'Sobra encaminhada para o caixa do próximo mês.'
          : 'Sobra distribuída automaticamente para as metas do casal.'
      );
    } finally {
      setRoutingBusy(false);
    }
  };

  const firstName =
    (currentUser?.displayName || state.profile.partner1Name || 'Você').split(' ')[0];

  return (
    <div className="space-y-6 pb-8">
      {/* Top Bar */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <AvatarHero />
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-300">
              Caixa Único · {formatMonthYear(state.currentMonth)}
            </p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Cascata Financeira do Casal
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <MonthSelector />
          {onOpenBankSyncModal && (
            <button
              type="button"
              onClick={onOpenBankSyncModal}
              className="btn-outline min-h-[44px] px-3.5 text-xs sm:text-sm"
            >
              <Upload className="w-4 h-4" />
              Importar CSV
            </button>
          )}
          <button
            type="button"
            onClick={onOpenIncomeModal}
            className="btn-outline min-h-[44px] px-3.5 text-xs sm:text-sm"
          >
            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Entrada
          </button>
          <button
            type="button"
            onClick={() => onOpenExpenseModal()}
            className="btn-accent min-h-[44px] px-4 text-xs sm:text-sm"
          >
            <Plus className="w-4 h-4" />
            Lançar Gasto
          </button>
        </div>
      </header>

      {/* Pending income confirmation alert (bank/shift) */}
      {pendingConfirmations.length > 0 && (
        <div className="clay-card p-4 bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {pendingConfirmations.length}{' '}
                {pendingConfirmations.length === 1
                  ? 'recebimento aguardando classificação'
                  : 'recebimentos aguardando classificação'}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Confirme se é renda líquida do mês ou transferência interna para manter a cascata exata.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedConfirmation(pendingConfirmations[0])}
            className="btn-outline min-h-[44px] px-4 text-xs shrink-0"
          >
            Revisar agora
          </button>
        </div>
      )}

      {/* HERO CARD — Dinheiro Disponível no Mês + Plantões a Receber */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 clay-card p-6 sm:p-7 bg-slate-900 text-white dark:bg-slate-900 border-slate-800 relative overflow-hidden">
          <div className="flex flex-col justify-between h-full gap-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                  Dinheiro Disponível no Mês
                </span>
                <span className="text-xs text-slate-300">
                  Escudo: {shieldMetrics.currentCoverageMonths.toFixed(1)}m /{' '}
                  {shieldMetrics.shieldTargetMonths}m
                </span>
              </div>
              <p className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums">
                {formatCurrency(liquidity.totalAvailableCash)}
              </p>
              <p className="mt-1.5 text-sm text-slate-300 tabular-nums">
                {formatCurrency(liquidity.newNetIncome)} de renda líquida +{' '}
                {formatCurrency(liquidity.previousMonthCarryOver)} de sobra do último mês
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-white/10 text-xs">
              <div>
                <span className="text-slate-400 block">Base 3M (Parcelas)</span>
                <span className="font-semibold text-white tabular-nums text-sm">
                  {formatCurrency(liquidity.referenceIncome3M)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Plantões Pagos</span>
                <span className="font-semibold text-emerald-300 tabular-nums text-sm">
                  {formatCurrency(liquidity.paidShiftsNetTotal)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Sobra Comum Atual</span>
                <span
                  className={`font-semibold tabular-nums text-sm ${
                    closingLedgers.closingSurplus >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {formatCurrency(closingLedgers.closingSurplus)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Conciliação Bancária</span>
                <span className="font-semibold text-slate-200 tabular-nums text-xs">
                  {!verifiableCashSummary || verifiableCashSummary.status === 'unknown'
                    ? 'Caixa livre não verificável'
                    : verifiableCashSummary.status === 'partial'
                    ? `Caixa livre verificável: ${formatCurrency((verifiableCashSummary.knownAccountsCashCents || 0) / 100, true)}`
                    : `Caixa livre verificável: ${formatCurrency(verifiableCashSummary.verifiedLiquidCashR$ ?? 0, true)}`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Shortcut Card: Plantões a Receber */}
        <button
          type="button"
          onClick={() => onNavigate('shifts')}
          className="clay-card bento-card-ochre p-6 text-left flex flex-col justify-between gap-4 hover:opacity-95 transition-opacity min-h-[160px]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-800 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Stethoscope className="w-5 h-5" />
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-900 dark:text-amber-200">
              Abrir Escala <ArrowUpRight className="w-3.5 h-3.5" />
            </span>
          </div>

          <div>
            <p className="text-xs font-semibold text-amber-900/80 dark:text-amber-200/80">
              Plantões a Receber
            </p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
              {formatCurrency(liquidity.receivableShiftsTotal)}
            </p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
              {formatCurrency(liquidity.scheduledShiftsTotal)} agendados ·{' '}
              {formatCurrency(liquidity.pendingPaymentShiftsTotal)} a receber
            </p>
            <p className="mt-1 text-[11px] font-medium text-amber-900/75 dark:text-amber-200/75">
              Fora do caixa até cair na conta
            </p>
          </div>
        </button>
      </section>

      {/* CASCATA 60/30/10 — BENTO GRID */}
      <section aria-label="Cascata 60/30/10" className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Bloco 1: Meta Obrigatória 10% */}
        <div className="lg:col-span-5 clay-card bento-card-sage p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                Bloco 1 · Meta Obrigatória ({(mandatoryGoal.mandatoryGoalRate * 100).toFixed(0)}%)
              </p>
              <p className="mt-1 text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                {formatCurrency(mandatoryGoal.mandatoryGoalAmount)}
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                Pague-se Primeiro · separado no topo antes dos gastos
              </p>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

          <div className="space-y-2.5">
            {mandatoryGoal.mandatoryGoalBreakdown.length === 0 ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Cadastre metas em Objetivos para dividir automaticamente este aporte.
              </p>
            ) : (
              mandatoryGoal.mandatoryGoalBreakdown.slice(0, 4).map((item) => {
                const sharePct =
                  mandatoryGoal.mandatoryGoalAmount > 0
                    ? Math.round((item.amount / mandatoryGoal.mandatoryGoalAmount) * 100)
                    : 0;
                return (
                  <div key={item.goalId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-100 truncate pr-2">
                        {item.title}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white tabular-nums shrink-0">
                        {formatCurrency(item.amount)} · {sharePct}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-emerald-950/10 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400 transition-all duration-700 ease-out"
                        style={{ width: `${Math.min(100, sharePct)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-2 border-t border-emerald-900/10 dark:border-white/10 flex items-center justify-between">
            <span className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
              Escudo atual: {formatCurrency(shieldMetrics.currentShieldBalance)}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('goals')}
              className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 inline-flex items-center gap-1 min-h-[36px]"
            >
              Ver Metas <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Bloco 3: Trava de Parcelas 10%-20% + Card Minha Mesada */}
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Bloco 3 — Trava de Parcelas */}
          <div className="clay-card p-5 sm:p-6 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Bloco 3 · Trava de Parcelas
                  </p>
                  <p className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                    {formatCurrency(installments.total)}
                  </p>
                </div>
                <CreditCard className="w-5 h-5 text-slate-500 dark:text-slate-300 shrink-0" />
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                {(installments.ratio * 100).toFixed(1)}% da média 3M (
                {formatCurrency(installments.referenceIncome3M)})
              </p>
            </div>

            {/* 10% - 15% - 20% markers track */}
            <div className="space-y-1.5">
              <div className="relative h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    installments.status === 'blocked'
                      ? 'bg-rose-500'
                      : installments.status === 'warning'
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${installmentTrackPct}%` }}
                />
                {/* 10% and 15% marker ticks relative to 20% max */}
                <span
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 w-0.5 bg-slate-900/25 dark:bg-white/40"
                  style={{ left: '50%' }}
                />
                <span
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 w-0.5 bg-slate-900/40 dark:bg-white/60"
                  style={{ left: '75%' }}
                />
              </div>
              <div className="flex justify-between text-[11px] font-medium text-slate-500 dark:text-slate-300 tabular-nums">
                <span>0%</span>
                <span>10% ({formatCurrency(installments.minAmount)})</span>
                <span>15% alvo</span>
                <span>20% máx</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowQuickSimulator((prev) => !prev)}
                className="btn-outline min-h-[44px] flex-1 text-xs px-3"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Simular Compra Parcelada
              </button>
              <button
                type="button"
                onClick={() => onNavigate('installments')}
                className="btn-ghost min-h-[44px] text-xs px-3"
              >
                Detalhes
              </button>
            </div>
          </div>

          {/* Card Resumo Minha Mesada Híbrida (Zero-Surveillance) */}
          <div className="clay-card bento-card-lavender p-5 sm:p-6 flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-violet-900 dark:text-violet-200 inline-flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  Minha Mesada · {firstName}
                </p>
                <p
                  className={`mt-1 text-2xl font-extrabold tabular-nums ${
                    myAllowanceWallet.closingBalance >= 0
                      ? 'text-slate-900 dark:text-white'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {formatCurrency(myAllowanceWallet.closingBalance)}
                </p>
              </div>
              <Wallet className="w-5 h-5 text-violet-700 dark:text-violet-300 shrink-0" />
            </div>

            <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200 tabular-nums">
              <p className="font-semibold">
                Onda {activeWave} de 2 ·{' '}
                {activeWave === 1
                  ? `Piso liberado (Onda 2 dia ${v23Preferences.wave2Day})`
                  : 'Cota completa liberada'}
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                Só meu: {formatCurrency(myAllowanceWallet.soloSpent)} · Metade dos dois:{' '}
                {formatCurrency(myAllowanceWallet.jointAllowanceShareSpent)}
              </p>
              {activeWave === 1 && allowance.pendingWave2ComplementPerPartner > 0 && (
                <p className="text-violet-800 dark:text-violet-200 font-medium">
                  +{formatCurrency(allowance.pendingWave2ComplementPerPartner)} previsto na Onda 2
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => onNavigate('couple_hub')}
              className="btn-accent min-h-[44px] w-full text-xs"
            >
              Abrir Carteira de Mesada
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Quick Simulator Drawer when opened */}
        {showQuickSimulator && (
          <div className="lg:col-span-12 clay-card p-5 border-slate-200 dark:border-slate-700 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Simulador Rápido: Posso Parcelar?
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-300">
                  Verifica o impacto sobre a trava de 10%–20% da renda 3M e sobre a mesada.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('installments')}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-300"
              >
                Abrir simulador completo →
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Valor total da compra (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={simAmount}
                  onChange={(e) => setSimAmount(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm font-semibold tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Parcelas
                </label>
                <select
                  value={simInstallments}
                  onChange={(e) => setSimInstallments(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm font-semibold"
                >
                  {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      {n}x
                    </option>
                  ))}
                </select>
              </div>
              <div
                className={`rounded-xl p-3 border text-xs ${
                  quickSimResult.verdict === 'blocked'
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                    : quickSimResult.verdict === 'caution'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                }`}
              >
                <p className="font-bold tabular-nums">
                  {formatCurrency(quickSimResult.monthlyInstallment)}/mês · Impacto{' '}
                  {(quickSimResult.projectedInstallmentRatio * 100).toFixed(1)}%
                </p>
                <p className="mt-0.5">{quickSimResult.reason}</p>
              </div>
            </div>
          </div>
        )}

        {/* Bloco 2: Estrutura de Vida <= 60% (Expandable 6 Sub-envelopes) */}
        <div className="lg:col-span-12 clay-card bento-card-skyblue p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-sky-900 dark:text-sky-200">
                Bloco 2 · Estrutura de Vida (Teto {(structure.capRate * 100).toFixed(0)}%)
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                  {formatCurrency(structure.actualStructureTotal)}
                </span>
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                  de {formatCurrency(structure.capAmount)} · {(structure.ratio * 100).toFixed(1)}% da renda
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {structure.savingsBelowCap > 0 && (
                <div className="rounded-xl bg-emerald-600/10 dark:bg-emerald-500/20 px-3.5 py-2 text-xs">
                  <span className="block text-emerald-800 dark:text-emerald-200 font-semibold">
                    Economia preservada no caixa
                  </span>
                  <span className="font-bold text-emerald-900 dark:text-emerald-100 tabular-nums text-sm">
                    {formatCurrency(structure.savingsBelowCap)}
                  </span>
                </div>
              )}

              <button
                type="button"
                aria-expanded={structureExpanded}
                onClick={() => setStructureExpanded((prev) => !prev)}
                className="btn-outline min-h-[44px] px-3.5 text-xs"
              >
                {structureExpanded ? (
                  <>
                    Ocultar 6 sub-envelopes <ChevronUp className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Ver 6 sub-envelopes <ChevronDown className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="h-3 rounded-full bg-slate-900/10 dark:bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${
                  structure.status === 'exceeded'
                    ? 'bg-rose-500'
                    : structure.status === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-sky-600 dark:bg-sky-400'
                }`}
                style={{ width: `${structurePct}%` }}
              />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              60% é teto máximo, nunca meta de gasto — o que não for usado fica livre no caixa comum.
            </p>
          </div>

          {structureExpanded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
              {subEnvelopes.map((env) => (
                <div
                  key={env.key}
                  className="rounded-2xl bg-white/85 dark:bg-slate-900/75 border border-slate-200/80 dark:border-slate-700/70 p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {env.label}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-300">
                        {env.sub}
                        {env.note ? ` · ${env.note}` : ''}
                      </p>
                    </div>
                    <span className="text-sm font-extrabold text-slate-900 dark:text-white tabular-nums shrink-0">
                      {formatCurrency(env.amount)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${
                        env.status === 'exceeded'
                          ? 'bg-rose-500'
                          : env.status === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-sky-600 dark:bg-sky-400'
                      }`}
                      style={{ width: `${Math.min(100, env.ratio)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* EVOLUÇÃO 6 MESES DO DUPLO LEDGER DE SOBRAS + FECHAMENTO DO CICLO */}
      <section className="clay-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              Duplo Ledger de Sobras (Últimos 6 Meses)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-300">
              Evolução paralela da Sobra do Caixa Comum e da Sobra da Minha Mesada (privada).
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Caixa Comum
            </span>
            <span className="inline-flex items-center gap-1.5 text-violet-700 dark:text-violet-300">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />
              Minha Mesada
            </span>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-44 min-w-[340px]"
            role="img"
            aria-label="Gráfico de evolução de 6 meses do Duplo Ledger de Sobras"
          >
            {/* Zero baseline */}
            <line
              x1={padX}
              x2={svgWidth - padX}
              y1={yAt(0)}
              y2={yAt(0)}
              stroke="currentColor"
              strokeOpacity="0.15"
              strokeDasharray="4 4"
            />
            {dualLedgerHistory6M.length > 1 && (
              <>
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={commonPolyline}
                />
                <polyline
                  fill="none"
                  stroke="#8b5cf6"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={allowancePolyline}
                />
              </>
            )}
            {dualLedgerHistory6M.map((pt, idx) => (
              <g key={pt.cycleId}>
                <circle
                  cx={xAt(idx)}
                  cy={yAt(pt.commonSurplus)}
                  r="4.5"
                  fill="#10b981"
                />
                <circle
                  cx={xAt(idx)}
                  cy={yAt(pt.personalAllowanceSurplus)}
                  r="4.5"
                  fill="#8b5cf6"
                />
                <text
                  x={xAt(idx)}
                  y={svgHeight - 4}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-300 text-[11px] font-semibold"
                >
                  {pt.label}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* Cycle closing action bar */}
        <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">
              Fechamento de {formatMonthYear(state.currentMonth)} · Destino atual:{' '}
              {activeBudgetCycle.surplusRouting === 'goals'
                ? 'Metas do Casal'
                : 'Caixa do Próximo Mês'}
            </p>
            <p className="text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
              Sobra do Caixa Comum: {formatCurrency(closingLedgers.closingSurplus)} · Sobra da Minha
              Mesada: {formatCurrency(myAllowanceWallet.closingBalance)} (rollover automático)
            </p>
            {routingMessage && (
              <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {routingMessage}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              disabled={routingBusy}
              onClick={() => void handleCloseCycle('carry_over')}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold border transition-colors ${
                activeBudgetCycle.surplusRouting === 'carry_over'
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
              }`}
            >
              Levar para o próximo mês
            </button>
            <button
              type="button"
              disabled={routingBusy}
              onClick={() => void handleCloseCycle('goals')}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold border transition-colors ${
                activeBudgetCycle.surplusRouting === 'goals'
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
              }`}
            >
              Enviar sobra para Metas
            </button>
          </div>
        </div>
      </section>

      {selectedConfirmation && (
        <ActiveIncomeConfirmationModal
          confirmation={selectedConfirmation}
          onClose={() => setSelectedConfirmation(null)}
        />
      )}

      {/* Subtle footer note reminding privacy guarantee */}
      {householdConfig.memberUids.length > 0 && (
        <p className="text-center text-[11px] text-slate-400 dark:text-slate-400">
          Privacidade Blindada: apenas os saldos e metas compartilhadas aparecem aqui; sua mesada individual permanece visível só para você.
        </p>
      )}
    </div>
  );
};
