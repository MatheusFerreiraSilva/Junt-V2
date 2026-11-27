import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  Zap,
} from 'lucide-react';
import { AdvanceInstallmentModal } from '../components/AdvanceInstallmentModal';
import { CATEGORIES_BASE, useFinance } from '../context/FinanceContext';
import { addCyclesToCycleId } from '../domain/waterfallEngine';
import { InstallmentPurchase } from '../types/finance';
import {
  addMonths,
  formatCurrency,
  formatMonthYear,
  formatShortMonthYear,
} from '../utils/formatters';
import { buildInstallmentSchedule, remainingInstallmentValue } from '../utils/installmentMoney';
import { cycleIdToMonthKey, isPlanActiveInCycle } from '../utils/v23Helpers';

interface InstallmentsScreenProps {
  onOpenInstallmentModal: () => void;
}

export const InstallmentsScreen: React.FC<InstallmentsScreenProps> = ({
  onOpenInstallmentModal,
}) => {
  const {
    state,
    activeCycleId,
    householdConfig,
    waterfallResult,
    v23InstallmentPlans,
    activeInstallments,
    simulateInstallment,
    addCascadeTransaction,
    recordInstallmentPayment,
    reverseInstallmentPayment,
    deleteInstallment,
  } = useFinance();

  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [selectedAdvanceInst, setSelectedAdvanceInst] = useState<InstallmentPurchase | null>(null);
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);

  // Interactive "Posso Parcelar?" Simulator
  const [simScope, setSimScope] = useState<'house' | 'solo_allowance'>('house');
  const [simTitle, setSimTitle] = useState('');
  const [simAmount, setSimAmount] = useState('2400');
  const [simCount, setSimCount] = useState(6);
  const [simBusy, setSimBusy] = useState(false);
  const [simMessage, setSimMessage] = useState<string | null>(null);

  const parsedSimAmount = parseFloat(simAmount.replace(',', '.')) || 0;
  const simulation = useMemo(
    () =>
      simulateInstallment({
        purchaseAmount: parsedSimAmount,
        installmentsCount: simCount,
        scope: simScope,
      }),
    [parsedSimAmount, simCount, simScope, simulateInstallment]
  );

  const { referenceIncome3M } = waterfallResult.liquidity;
  const instGuard = waterfallResult.guards.installments;
  const ratioPct = Number((instGuard.ratio * 100).toFixed(1));
  const minPct = Math.round(instGuard.minRate * 100);
  const targetPct = Math.round(instGuard.targetRate * 100);
  const maxPct = Math.round(instGuard.maxRate * 100);
  const trackFillPct = Math.min(100, Math.round((instGuard.ratio / Math.max(0.01, instGuard.maxRate)) * 100));

  const activePlansInCycle = useMemo(
    () => v23InstallmentPlans.filter((plan) => isPlanActiveInCycle(plan, activeCycleId)),
    [v23InstallmentPlans, activeCycleId]
  );

  // 7-month relief timeline over v23InstallmentPlans
  const reliefTimeline = useMemo(() => {
    const baseline = instGuard.total;
    return Array.from({ length: 7 }).map((_, idx) => {
      const cid = addCyclesToCycleId(activeCycleId, idx);
      const monthKey = cycleIdToMonthKey(cid);
      const committed = v23InstallmentPlans
        .filter((plan) => isPlanActiveInCycle(plan, cid))
        .reduce((sum, plan) => sum + (plan.installmentAmount || 0), 0);
      const endingHere = v23InstallmentPlans.filter((plan) => plan.endCycleId === cid);
      const relief = Math.max(0, baseline - committed);
      const pctOf3M =
        referenceIncome3M > 0 ? Number(((committed / referenceIncome3M) * 100).toFixed(1)) : 0;
      return {
        cycleId: cid,
        monthKey,
        committed,
        pctOf3M,
        relief,
        endingCount: endingHere.length,
      };
    });
  }, [activeCycleId, instGuard.total, referenceIncome3M, v23InstallmentPlans]);

  const nextReliefMilestone = useMemo(() => {
    const firstRelief = reliefTimeline.find((item, idx) => idx > 0 && item.relief > 0);
    return firstRelief || null;
  }, [reliefTimeline]);

  const handleRegisterFromSim = async () => {
    if (simulation.verdict === 'blocked' || parsedSimAmount <= 0) return;
    setSimMessage(null);
    setSimBusy(true);
    try {
      await addCascadeTransaction({
        destination: simScope === 'house' ? 'house_routine' : 'solo_allowance',
        title: simTitle.trim() || 'Compra Parcelada Simulada',
        amount: parsedSimAmount,
        date: `${state.currentMonth}-10`,
        bucket: 'routine',
        installmentsCount: simCount,
      });
      setSimTitle('');
      setSimMessage('Parcelamento registrado e aplicado à cascata.');
    } catch (err) {
      setSimMessage(err instanceof Error ? err.message : 'Erro ao registrar parcelamento.');
    } finally {
      setSimBusy(false);
    }
  };

  const completedInstallments = state.installments.filter((i) => !i.active);

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white font-display tracking-tight">
            Trava de Parcelas ({minPct}%–{maxPct}% Renda 3M)
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Medida sobre a média líquida dos últimos 3 ciclos ({formatCurrency(referenceIncome3M)}) com impacto direto na margem do casal.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setSelectedAdvanceInst(null);
              setIsAdvanceModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 transition-all cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            <span>Adiantar Parcelas</span>
          </button>

          <button
            type="button"
            onClick={onOpenInstallmentModal}
            className="btn-primary-accent flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Parcela</span>
          </button>
        </div>
      </div>

      {/* Top 3 Bento Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 1. Janela 10% - 15% - 20% */}
        <div
          className={`p-5 rounded-3xl border flex flex-col justify-between transition-colors ${
            instGuard.status === 'blocked'
              ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-100'
              : instGuard.status === 'warning'
              ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-100'
              : 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-950 dark:text-emerald-100'
          }`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider opacity-85">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                Termômetro 3M
              </span>
              <span>
                {instGuard.status === 'blocked'
                  ? 'Bloqueado'
                  : instGuard.status === 'warning'
                  ? 'Atenção'
                  : 'Zona Saudável'}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black font-display tabular-nums">{ratioPct}%</span>
              <span className="text-xs font-semibold opacity-80 tabular-nums">
                / teto {maxPct}% ({formatCurrency(instGuard.max20Amount)})
              </span>
            </div>

            <div className="text-xs font-bold tabular-nums">
              Comprometido neste ciclo: {formatCurrency(instGuard.total)}
            </div>
            <p className="text-[11px] opacity-85 leading-relaxed">
              Alvo saudável até {targetPct}% ({formatCurrency(instGuard.targetAmount)}). Margem restante antes do bloqueio:{' '}
              <strong className="tabular-nums">{formatCurrency(instGuard.marginToMax)}</strong>.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-black/10 dark:border-white/10 space-y-2">
            <div className="relative h-3 bg-white/80 dark:bg-slate-800 rounded-full overflow-hidden">
              {/* Target marker at 75% of track (15% out of 20%) */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-slate-900/40 dark:bg-white/50 z-10"
                style={{ left: `${Math.round((targetPct / Math.max(1, maxPct)) * 100)}%` }}
              />
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${
                  instGuard.status === 'blocked'
                    ? 'bg-rose-500'
                    : instGuard.status === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${trackFillPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-bold opacity-80 tabular-nums">
              <span>0%</span>
              <span>Piso {minPct}%</span>
              <span>Alvo {targetPct}%</span>
              <span>Teto {maxPct}%</span>
            </div>
          </div>
        </div>

        {/* 2. Compromissos do Ciclo */}
        <div className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5 uppercase tracking-wider">
                <Calendar className="w-4 h-4 text-sky-500" />
                Parcelas no Ciclo
              </span>
              <span className="tabular-nums">{activePlansInCycle.length} planos ativos</span>
            </div>

            <div>
              <div className="text-2xl font-black text-slate-900 dark:text-white font-display tabular-nums">
                {formatCurrency(instGuard.total)}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Debitado do bloco de Estrutura (60%) no Caixa Único
              </p>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {activePlansInCycle.slice(0, 5).map((plan) => (
                <div
                  key={plan.id}
                  className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-bold text-slate-800 dark:text-slate-100 truncate">
                      {plan.title}
                    </div>
                    <div className="text-[10px] text-slate-500 tabular-nums">
                      {plan.currentInstallment}/{plan.totalInstallments} · Fim {formatShortMonthYear(cycleIdToMonthKey(plan.endCycleId))}
                    </div>
                  </div>
                  <span className="font-extrabold text-slate-900 dark:text-white tabular-nums shrink-0">
                    {formatCurrency(plan.installmentAmount)}
                  </span>
                </div>
              ))}
              {activePlansInCycle.length === 0 && (
                <p className="text-xs text-slate-400 py-3">Nenhuma parcela ativa neste ciclo.</p>
              )}
            </div>
          </div>
        </div>

        {/* 3. Próximo Alívio Real */}
        <div className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-emerald-500" />
                Alívio Futuro
              </span>
              <span className="tabular-nums">Base 3M</span>
            </div>

            {nextReliefMilestone ? (
              <>
                <div>
                  <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 font-display tabular-nums">
                    +{formatCurrency(nextReliefMilestone.relief)}/mês
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Em <strong>{formatMonthYear(nextReliefMilestone.monthKey)}</strong> a carga cai para{' '}
                    <strong className="tabular-nums">{formatCurrency(nextReliefMilestone.committed)}</strong> ({nextReliefMilestone.pctOf3M}% da Renda 3M).
                  </p>
                </div>
              </>
            ) : (
              <div>
                <div className="text-xl font-black text-slate-900 dark:text-white font-display">
                  Fluxo estabilizado
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Sem quitações programadas nos próximos 6 ciclos além do compromisso atual.
                </p>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Mesada Pessoal (teto 50%):</span>
            <span className="font-extrabold text-violet-700 dark:text-violet-300 tabular-nums">
              até {formatCurrency(householdConfig.allowanceFloor * 0.5)}/mês
            </span>
          </div>
        </div>
      </div>

      {/* SIMULADOR INTERATIVO "POSSO PARCELAR?" */}
      <section className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200">
              <Calculator className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white font-display">
                Simulador: Posso Parcelar?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Teste o impacto antes de passar o cartão no Caixa Único ou na sua Mesada Pessoal.
              </p>
            </div>
          </div>

          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setSimScope('house')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                simScope === 'house'
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Casal (10%–20% 3M)
            </button>
            <button
              type="button"
              onClick={() => setSimScope('solo_allowance')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                simScope === 'solo_allowance'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Mesada Pessoal (50% piso)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label htmlFor="sim-title" className="block text-[11px] font-bold text-slate-500 mb-1">
              O que pretende comprar?
            </label>
            <input
              id="sim-title"
              type="text"
              value={simTitle}
              onChange={(e) => setSimTitle(e.target.value)}
              placeholder="Ex: MacBook, Sofá, Curso"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            />
          </div>

          <div>
            <label htmlFor="sim-amount" className="block text-[11px] font-bold text-slate-500 mb-1">
              Valor total (R$)
            </label>
            <input
              id="sim-amount"
              type="number"
              min="0"
              step="50"
              value={simAmount}
              onChange={(e) => setSimAmount(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-extrabold tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="sim-count" className="block text-[11px] font-bold text-slate-500 mb-1">
              Parcelas (x)
            </label>
            <select
              id="sim-count"
              value={simCount}
              onChange={(e) => setSimCount(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-extrabold tabular-nums"
            >
              {[2, 3, 4, 5, 6, 8, 10, 12, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n}x
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              disabled={simBusy || parsedSimAmount <= 0 || simulation.verdict === 'blocked'}
              onClick={handleRegisterFromSim}
              className="w-full btn-primary-accent py-2.5 px-4 rounded-xl text-xs font-extrabold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {simBusy ? 'Registrando...' : 'Registrar Parcela'}
            </button>
          </div>
        </div>

        {/* Simulation Verdict Banner */}
        <div
          className={`p-4 rounded-2xl border grid grid-cols-1 sm:grid-cols-4 gap-3 items-center text-xs ${
            simulation.verdict === 'blocked'
              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
              : simulation.verdict === 'caution'
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
              : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
          }`}
        >
          <div>
            <span className="text-[10px] font-bold uppercase opacity-75 block">Veredito</span>
            <strong className="text-sm font-black flex items-center gap-1.5">
              {simulation.verdict === 'blocked' ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {simulation.verdict === 'blocked'
                ? 'Bloqueado'
                : simulation.verdict === 'caution'
                ? 'Cautela'
                : 'Liberado'}
            </strong>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase opacity-75 block">Nova Parcela</span>
            <strong className="text-sm font-black tabular-nums">
              {simCount}x de {formatCurrency(simulation.monthlyInstallment)}
            </strong>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase opacity-75 block">
              {simScope === 'house' ? 'Comprometimento 3M' : 'Uso do Piso da Mesada'}
            </span>
            <strong className="text-sm font-black tabular-nums">
              {(simulation.projectedInstallmentRatio * 100).toFixed(1)}%
            </strong>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase opacity-75 block">
              {simScope === 'house' ? 'Impacto na Mesada / Quitação' : 'Última Parcela'}
            </span>
            <strong className="text-xs font-extrabold tabular-nums">
              {simScope === 'house'
                ? `-${formatCurrency(simulation.allowanceReductionPerPartner)}/par · `
                : ''}
              {formatMonthYear(cycleIdToMonthKey(simulation.payoffCycleId))}
            </strong>
          </div>

          <p className="sm:col-span-4 text-[11px] font-medium opacity-90 pt-1 border-t border-black/10 dark:border-white/10">
            {simulation.reason}
          </p>
        </div>

        {simMessage && (
          <p role="status" className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
            {simMessage}
          </p>
        )}
      </section>

      {/* TRAJETÓRIA DE ALÍVIO (PRÓXIMOS 7 CICLOS) */}
      <section className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-extrabold text-slate-900 dark:text-white text-base font-display flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-emerald-500" />
              <span>Trajetória de Alívio das Parcelas (7 Ciclos)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Projeção mensal de comprometimento e caixa liberado conforme os planos terminam.
            </p>
          </div>
          <span className="text-xs font-bold text-slate-500 tabular-nums">
            Teto {maxPct}% = {formatCurrency(instGuard.max20Amount)}
          </span>
        </div>

        <div className="grid grid-cols-7 gap-2 items-end h-44 bg-slate-50/70 dark:bg-slate-800/40 p-3 sm:p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
          {(() => {
            const maxVal = Math.max(
              ...reliefTimeline.map((p) => p.committed),
              instGuard.max20Amount,
              1000
            );
            return reliefTimeline.map((proj, idx) => {
              const heightPct = Math.min(
                100,
                Math.max(14, Math.round((proj.committed / maxVal) * 100))
              );
              const isBlocked = proj.pctOf3M > maxPct;
              const isWarning = proj.pctOf3M > targetPct && !isBlocked;
              return (
                <div
                  key={proj.cycleId}
                  className="flex flex-col items-center justify-end h-full"
                >
                  <div className="text-[10px] font-extrabold text-slate-800 dark:text-slate-200 tabular-nums mb-1 whitespace-nowrap">
                    {formatCurrency(proj.committed)}
                  </div>
                  <div
                    className={`w-full max-w-[52px] rounded-t-xl transition-all duration-700 ease-out flex items-end justify-center pb-1.5 ${
                      isBlocked
                        ? 'bg-rose-500'
                        : isWarning
                        ? 'bg-amber-500'
                        : idx === 0
                        ? 'bg-slate-800 dark:bg-slate-200'
                        : 'bg-emerald-500'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  >
                    <span
                      className={`text-[10px] font-black tabular-nums ${
                        idx === 0
                          ? 'text-white dark:text-slate-900'
                          : 'text-white'
                      }`}
                    >
                      {proj.pctOf3M}%
                    </span>
                  </div>
                  <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mt-1.5 text-center truncate max-w-full">
                    {formatShortMonthYear(proj.monthKey)}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </section>

      {/* PLANOS PARCELADOS NO CAIXA ÚNICO */}
      <section className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="font-extrabold text-slate-900 dark:text-white text-base font-display">
              Planos Parcelados no Caixa Único ({v23InstallmentPlans.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Todos os parcelamentos comuns impactam igualmente o caixa do casal sem rateio de dívida.
            </p>
          </div>
          <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 tabular-nums">
            Total mensal atual: {formatCurrency(instGuard.total)}
          </span>
        </div>

        {v23InstallmentPlans.length === 0 && activeInstallments.length === 0 ? (
          <div className="text-center py-10 space-y-2">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Nenhuma compra parcelada ativa no momento.
            </p>
            <p className="text-xs text-slate-400">
              100% da margem da trava de parcelas está livre.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {v23InstallmentPlans.map((plan) => {
              const pct = Math.min(
                100,
                Math.round((plan.currentInstallment / Math.max(1, plan.totalInstallments)) * 100)
              );
              const legacyMatch = activeInstallments.find((i) => i.id === plan.id);
              const remainingCount = Math.max(
                0,
                plan.totalInstallments - plan.currentInstallment + 1
              );

              return (
                <div
                  key={plan.id}
                  className="p-4 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-extrabold text-slate-900 dark:text-white text-sm">
                        {plan.title}
                      </h4>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                        Parcela {plan.currentInstallment}/{plan.totalInstallments} · Início{' '}
                        {formatShortMonthYear(cycleIdToMonthKey(plan.startCycleId))} · Término{' '}
                        {formatShortMonthYear(cycleIdToMonthKey(plan.endCycleId))}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-base font-black text-slate-900 dark:text-white tabular-nums">
                        {formatCurrency(plan.installmentAmount)}/mês
                      </div>
                      <div className="text-[11px] font-semibold text-slate-500 tabular-nums">
                        Restante estimado: {formatCurrency(remainingCount * plan.installmentAmount)}
                      </div>
                    </div>
                  </div>

                  <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {legacyMatch && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/60">
                      <button
                        type="button"
                        onClick={() => deleteInstallment(legacyMatch.id)}
                        className="flex items-center gap-1 text-slate-500 hover:text-rose-600 text-xs font-semibold cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Excluir</span>
                      </button>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedScheduleId(
                              expandedScheduleId === legacyMatch.id ? null : legacyMatch.id
                            )
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          <span>Cronograma</span>
                          {expandedScheduleId === legacyMatch.id ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAdvanceInst(legacyMatch);
                            setIsAdvanceModalOpen(true);
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-xs font-bold cursor-pointer"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>Adiantar</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => recordInstallmentPayment(legacyMatch.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Quitar +1</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {legacyMatch && expandedScheduleId === legacyMatch.id && (() => {
                    const occurrences = buildInstallmentSchedule(legacyMatch, state.currentMonth);
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2">
                        {occurrences.map((occ) => {
                          const isSettled = occ.status === 'pago' || occ.status === 'antecipado';
                          return (
                            <div
                              key={occ.occurrenceId}
                              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs space-y-1"
                            >
                              <div className="flex justify-between font-bold">
                                <span>
                                  {occ.installmentNumber}/{legacyMatch.installmentsCount}
                                </span>
                                <span className="uppercase text-[10px] text-slate-500">
                                  {occ.status}
                                </span>
                              </div>
                              <div className="flex justify-between text-[11px] tabular-nums">
                                <span className="text-slate-500">{occ.competenceMonth}</span>
                                <span className="font-extrabold">{formatCurrency(occ.amountR$)}</span>
                              </div>
                              <div className="flex justify-end pt-1">
                                {isSettled ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      reverseInstallmentPayment(legacyMatch.id, occ.installmentNumber)
                                    }
                                    className="flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    Estornar
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      recordInstallmentPayment(legacyMatch.id, occ.installmentNumber)
                                    }
                                    className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 hover:underline cursor-pointer"
                                  >
                                    <Check className="w-3 h-3" />
                                    Quitar
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Quitadas */}
      {completedInstallments.length > 0 && (
        <section className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 space-y-3">
          <h3 className="font-extrabold text-slate-900 dark:text-white text-base font-display">
            Parcelas Quitadas ({completedInstallments.length})
          </h3>
          <div className="space-y-2">
            {completedInstallments.map((item) => {
              const cat = CATEGORIES_BASE[item.category];
              return (
                <div
                  key={item.id}
                  className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">
                      {cat?.emoji} {item.title}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {item.installmentsCount}x quitadas · Total {formatCurrency(item.totalAmount)} · Fim em{' '}
                      {formatMonthYear(addMonths(item.startMonth, item.installmentsCount - 1))}
                    </div>
                  </div>
                  <div className="text-right font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                    +{formatCurrency(remainingInstallmentValue(item) === 0 ? item.installmentAmount : item.installmentAmount)}/mês livre
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <AdvanceInstallmentModal
        isOpen={isAdvanceModalOpen}
        onClose={() => {
          setIsAdvanceModalOpen(false);
          setSelectedAdvanceInst(null);
        }}
        targetInstallment={selectedAdvanceInst}
      />
    </div>
  );
};
