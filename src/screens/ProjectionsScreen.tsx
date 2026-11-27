import React, { useCallback, useState, useMemo } from 'react';
import { Sparkles, Shield, Activity, Layers } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency, formatCompactCurrency } from '../utils/formatters';
import { selectAnnualYield, selectTotalProtectedAssets } from '../utils/domainSelectors';

export const ProjectionsScreen: React.FC = () => {
  const {
    state,
    totalSavedInPiggyBanks,
    totalMonthlyPiggyDeposits,
    waterfallResult,
    shieldMetrics,
    investmentRouting,
    v23MedicalShifts,
  } = useFinance();

  const [extraMonthlyDeposit, setExtraMonthlyDeposit] = useState<number>(0);
  const [selectedHorizon, setSelectedHorizon] = useState<number>(10);

  const mandatoryDeposit = waterfallResult.mandatoryGoal.mandatoryGoalAmount;
  const baseMonthlyContribution =
    totalMonthlyPiggyDeposits > 0 ? totalMonthlyPiggyDeposits : mandatoryDeposit;
  const totalMonthlySavings = baseMonthlyContribution + extraMonthlyDeposit;

  const totalProtectedAssets = useMemo(
    () => selectTotalProtectedAssets(state, 'casal').totalProtected,
    [state]
  );
  const initialCapital = totalProtectedAssets > 0 ? totalProtectedAssets : totalSavedInPiggyBanks;

  const annualYieldPct = selectAnnualYield(state);
  const annualYield = annualYieldPct / 100;
  const monthlyYield = annualYield > -1 ? Math.pow(1 + annualYield, 1 / 12) - 1 : -0.01;

  const horizons = useMemo(() => [5, 10, 20, 30], []);

  const calculateFutureValue = useCallback(
    (years: number, monthly: number, currentInitial: number) => {
      const totalMonths = years * 12;
      let total = currentInitial * Math.pow(1 + monthlyYield, totalMonths);
      if (monthlyYield > 0) {
        total += monthly * ((Math.pow(1 + monthlyYield, totalMonths) - 1) / monthlyYield);
      } else {
        total += monthly * totalMonths;
      }
      return Math.round(total);
    },
    [monthlyYield]
  );

  const projections = useMemo(() => {
    return horizons.map((yrs) => {
      const fv = calculateFutureValue(yrs, totalMonthlySavings, initialCapital);
      const totalDeposited = initialCapital + totalMonthlySavings * yrs * 12;
      const earnings = Math.max(0, fv - totalDeposited);
      const passiveIncomeMonth = Math.round(fv * (annualYield / 12));

      return {
        years: yrs,
        futureValue: fv,
        totalDeposited,
        earnings,
        passiveIncomeMonth,
      };
    });
  }, [horizons, totalMonthlySavings, initialCapital, annualYield, calculateFutureValue]);

  const activeProj = projections.find((p) => p.years === selectedHorizon) || projections[1];
  const maxFV = projections[projections.length - 1].futureValue || 1;

  const scheduledShifts = v23MedicalShifts.filter((s) => s.status === 'scheduled');
  const pendingPayShifts = v23MedicalShifts.filter((s) => s.status === 'pending_payment');

  return (
    <div className="space-y-6 pb-20 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-display">
            Projeções, Escudo & Fluxo Médico
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Separação entre caixa disponível hoje, plantões a receber e construção patrimonial de{' '}
            {state.profile.partner1Name} & {state.profile.partner2Name}.
          </p>
        </div>
      </div>

      {/* Main Vision Banner */}
      <div className="bg-gradient-to-br from-indigo-950 via-purple-900 to-slate-950 text-white rounded-3xl p-6 sm:p-8 shadow-sm">
        <div className="max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
            Horizonte de {selectedHorizon} anos juntos
          </span>
          <div className="text-3xl sm:text-5xl font-black tabular-nums font-display my-2 text-white">
            {formatCurrency(activeProj.futureValue)}
          </div>
          <div className="text-xs sm:text-sm text-purple-100/90 leading-relaxed mt-1">
            Com aporte de{' '}
            <strong className="tabular-nums text-white">{formatCurrency(totalMonthlySavings)}/mês</strong>, esse
            patrimônio gera cerca de{' '}
            <strong className="text-emerald-300 font-extrabold text-base tabular-nums">
              {formatCurrency(activeProj.passiveIncomeMonth)}/mês
            </strong>{' '}
            de renda passiva real.
          </div>
        </div>
      </div>

      {/* Plantões a Receber (Fluxo Futuro) + Calibração do Escudo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-2xl bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </span>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base font-display">
                Plantões a Receber (Fluxo Futuro)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Regime de competência — não entra no caixa livre antes do pagamento.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800">
              <span className="text-[11px] text-emerald-800 dark:text-emerald-300 block">
                Caixa Livre Hoje
              </span>
              <strong className="text-sm font-extrabold text-emerald-950 dark:text-emerald-100 tabular-nums mt-0.5 block">
                {formatCurrency(waterfallResult.liquidity.totalAvailableCash)}
              </strong>
            </div>

            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800">
              <span className="text-[11px] text-amber-800 dark:text-amber-300 block">
                Realizados a Receber
              </span>
              <strong className="text-sm font-extrabold text-amber-950 dark:text-amber-100 tabular-nums mt-0.5 block">
                {formatCurrency(waterfallResult.liquidity.pendingPaymentShiftsTotal)}
              </strong>
              <span className="text-[10px] text-amber-700 dark:text-amber-400">
                {pendingPayShifts.length} plantão(ões)
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200/70 dark:border-sky-800">
              <span className="text-[11px] text-sky-800 dark:text-sky-300 block">
                Agendados na Escala
              </span>
              <strong className="text-sm font-extrabold text-sky-950 dark:text-sky-100 tabular-nums mt-0.5 block">
                {formatCurrency(waterfallResult.liquidity.scheduledShiftsTotal)}
              </strong>
              <span className="text-[10px] text-sky-700 dark:text-sky-400">
                {scheduledShifts.length} plantão(ões)
              </span>
            </div>
          </div>
        </section>

        <section className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </span>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base font-display">
                Calibração do Escudo & 3 Pilares
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Piso 4m ({formatCurrency(shieldMetrics.shieldFloorAmount)}) e Teto 10m (
                {formatCurrency(shieldMetrics.shieldTargetAmount)}) sem Fixos Canceláveis.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                Cobertura Atual
              </span>
              <strong className="text-sm font-extrabold text-slate-900 dark:text-white tabular-nums mt-0.5 block">
                {shieldMetrics.currentCoverageMonths.toFixed(1)} meses
              </strong>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                Base Essencial/mês
              </span>
              <strong className="text-sm font-extrabold text-slate-900 dark:text-white tabular-nums mt-0.5 block">
                {formatCurrency(shieldMetrics.essentialMonthlyBase)}
              </strong>
            </div>

            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800">
              <span className="text-[11px] text-emerald-800 dark:text-emerald-300 block">
                Gordura p/ Sonhos
              </span>
              <strong className="text-sm font-extrabold text-emerald-950 dark:text-emerald-100 tabular-nums mt-0.5 block">
                {formatCurrency(shieldMetrics.usableFatAmount)}
              </strong>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
              <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              Roteamento mensal nos 3 Pilares ({formatCurrency(investmentRouting.totalInvestableAmount)})
            </span>
            <span className="font-bold text-slate-900 dark:text-white tabular-nums">
              {investmentRouting.goalAllocations.length} meta(s)
            </span>
          </div>
        </section>
      </div>

      {/* Horizon Selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {horizons.map((yrs) => {
          const isSelected = selectedHorizon === yrs;
          const p = projections.find((item) => item.years === yrs);
          return (
            <button
              key={yrs}
              type="button"
              onClick={() => setSelectedHorizon(yrs)}
              className={`min-h-[48px] p-3.5 rounded-2xl border-2 text-center transition-all cursor-pointer ${
                isSelected
                  ? 'border-purple-600 bg-purple-50 dark:bg-purple-950/50 text-purple-950 dark:text-purple-100 shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
              }`}
            >
              <div className="text-xs font-bold uppercase tracking-wider opacity-75">{yrs} anos</div>
              <div className="text-sm sm:text-base font-extrabold tabular-nums mt-0.5">
                {formatCompactCurrency(p?.futureValue || 0)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Visual Future Growth Chart */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-slate-900 dark:text-white text-base font-display">
            Curva de Crescimento Patrimonial
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            Rendimento real estimado: {annualYieldPct}% a.a.
          </span>
        </div>

        <div className="grid grid-cols-4 gap-3 pt-6 pb-2 items-end h-56">
          {projections.map((item) => {
            const heightPct = Math.max(12, Math.round((item.futureValue / maxFV) * 100));
            const isSelected = item.years === selectedHorizon;

            return (
              <button
                key={item.years}
                type="button"
                onClick={() => setSelectedHorizon(item.years)}
                className="flex flex-col items-center h-full justify-end cursor-pointer group"
              >
                <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 tabular-nums mb-2 text-center">
                  {formatCompactCurrency(item.futureValue)}
                </div>

                <div
                  className={`w-full max-w-[64px] rounded-2xl transition-all duration-700 ease-out relative overflow-hidden flex flex-col justify-end p-1 ${
                    isSelected
                      ? 'bg-purple-600 shadow-md shadow-purple-600/30'
                      : 'bg-slate-200 dark:bg-slate-700 group-hover:bg-slate-300 dark:group-hover:bg-slate-600'
                  }`}
                  style={{ height: `${heightPct}%` }}
                >
                  <div className="w-full bg-white/20 rounded-xl h-2 mb-1" />
                </div>

                <div className="mt-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                  {item.years} anos
                </div>
              </button>
            );
          })}
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-slate-500 dark:text-slate-400 block">Aportado pelo casal:</span>
            <span className="font-extrabold text-slate-900 dark:text-white text-sm tabular-nums">
              {formatCurrency(activeProj.totalDeposited)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400 block">Juros compostos gerados:</span>
            <span className="font-extrabold text-emerald-700 dark:text-emerald-400 text-sm tabular-nums">
              +{formatCurrency(activeProj.earnings)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400 block">Renda passiva estimada:</span>
            <span className="font-extrabold text-purple-700 dark:text-purple-400 text-sm tabular-nums">
              {formatCurrency(activeProj.passiveIncomeMonth)}/mês
            </span>
          </div>
        </div>
      </div>

      {/* Extra Deposit Simulator */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <h3 className="font-bold text-slate-900 dark:text-white text-base font-display">
            Simulador de Aporte Extra nos 3 Pilares
          </h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Base atual de aportes:{' '}
          <strong className="tabular-nums text-slate-800 dark:text-slate-200">
            {formatCurrency(baseMonthlyContribution)}/mês
          </strong>
          . Ajuste o aporte extra mensal para projetar o impacto composto:
        </p>

        <div className="p-4 rounded-2xl bg-purple-50/50 dark:bg-purple-950/30 border border-purple-200/70 dark:border-purple-800 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-purple-900 dark:text-purple-200 tabular-nums">
              Aporte extra mensal: +{formatCurrency(extraMonthlyDeposit)}
            </span>
            <span className="text-purple-950 dark:text-purple-100 font-bold tabular-nums">
              Total mensal: {formatCurrency(totalMonthlySavings)}
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="5000"
            step="100"
            value={extraMonthlyDeposit}
            onChange={(e) => setExtraMonthlyDeposit(parseInt(e.target.value, 10))}
            aria-label="Aporte extra mensal"
            className="w-full accent-purple-600"
          />

          <div className="flex items-center gap-2 flex-wrap pt-1">
            {[0, 500, 1000, 2000, 3000].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setExtraMonthlyDeposit(val)}
                className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-bold tabular-nums transition-colors cursor-pointer ${
                  extraMonthlyDeposit === val
                    ? 'bg-purple-700 text-white'
                    : 'bg-white dark:bg-slate-900 text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-700 hover:bg-purple-100 dark:hover:bg-purple-950'
                }`}
              >
                +{formatCurrency(val)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
