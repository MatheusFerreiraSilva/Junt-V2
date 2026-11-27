import React, { useMemo, useState } from 'react';
import {
  TrendingUp,
  BarChart3,
  ShieldCheck,
  Sparkles,
  Layers,
  Wallet,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { TransactionBucket } from '../types/finance';
import { formatCurrency, formatCompactCurrency } from '../utils/formatters';
import { TRANSACTION_BUCKET_META } from '../utils/v23Helpers';
import { DonutChart } from '../components/DonutChart';

const BUCKET_COLORS: Record<TransactionBucket, string> = {
  housing: '#0d9488',
  fixed_essential: '#2563eb',
  fixed_cancelable: '#d97706',
  groceries: '#0284c7',
  routine: '#7c3aed',
  buffer: '#e11d48',
};

const BUCKET_ORDER: TransactionBucket[] = [
  'housing',
  'fixed_essential',
  'fixed_cancelable',
  'groceries',
  'routine',
  'buffer',
];

export const TrendsScreen: React.FC = () => {
  const {
    state,
    dualLedgerHistory6M,
    bucketBreakdown,
    waterfallResult,
    shieldMetrics,
    currentAccent,
  } = useFinance();

  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const [selectedMetric, setSelectedMetric] = useState<'cascade' | 'dual_ledger'>('cascade');

  const history = dualLedgerHistory6M || [];
  const maxCascadeValue = Math.max(
    1,
    ...history.map((p) => Math.max(p.actualStructureTotal, p.structureCapAmount, p.newNetIncome))
  );
  const maxLedgerValue = Math.max(
    1,
    ...history.map((p) => Math.max(Math.abs(p.commonSurplus), Math.abs(p.personalAllowanceSurplus)))
  );

  const avgStructurePct =
    history.length > 0
      ? Math.round(
          history.reduce(
            (sum, p) => sum + (p.newNetIncome > 0 ? (p.actualStructureTotal / p.newNetIncome) * 100 : 0),
            0
          ) / history.length
        )
      : 0;

  const total6MSavingsBelowCap = history.reduce((sum, p) => sum + Math.max(0, p.savingsBelowCap), 0);
  const total6MCommonSurplus = history.reduce((sum, p) => sum + Math.max(0, p.commonSurplus), 0);

  const structureDonutData = BUCKET_ORDER.map((bucket) => ({
    label: TRANSACTION_BUCKET_META[bucket].label,
    value: bucketBreakdown[bucket] || 0,
    color: BUCKET_COLORS[bucket],
  }));

  const currentStructurePct = Math.round(waterfallResult.guards.structure.ratio * 100);
  const currentHousingPct = Math.round(waterfallResult.guards.housing.ratio * 100);

  return (
    <div className="space-y-6 pb-20 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-display">
            Tendências da Cascata & Duplo Ledger
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Evolução de 6 ciclos do Caixa Único de {state.profile.partner1Name} &{' '}
            {state.profile.partner2Name} — estrutura 60%, moradia e sobras.
          </p>
        </div>

        <div className="flex items-center p-1 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <button
            type="button"
            onClick={() => setChartType('bar')}
            className={`min-h-[44px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              chartType === 'bar'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Barras
          </button>
          <button
            type="button"
            onClick={() => setChartType('line')}
            className={`min-h-[44px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              chartType === 'line'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Trajetória
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setSelectedMetric('cascade')}
          className={`min-h-[44px] px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            selectedMetric === 'cascade'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          <Layers className="w-4 h-4" />
          Estrutura 60% vs Teto
        </button>
        <button
          type="button"
          onClick={() => setSelectedMetric('dual_ledger')}
          className={`min-h-[44px] px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            selectedMetric === 'dual_ledger'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          <Wallet className="w-4 h-4" />
          Duplo Ledger de Sobras (Casa vs Minha Mesada)
        </button>
      </div>

      {/* Main 6M Chart */}
      <div className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base font-display">
              {selectedMetric === 'cascade'
                ? 'Despesa Estrutural vs Teto de 60% (6 Ciclos)'
                : 'Comparativo do Duplo Ledger de Sobras (6 Ciclos)'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {selectedMetric === 'cascade'
                ? 'Economia abaixo do teto de 60% permanece no Caixa Único e alimenta as ondas de Mesada e metas.'
                : 'Sobra do Caixa Único (casal) separada do saldo acumulado na sua Mesada privada — sem expor gastos do par.'}
            </p>
          </div>
          <div className="text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums">
            Média estrutural: {avgStructurePct}% da renda
          </div>
        </div>

        {chartType === 'bar' ? (
          <div className="grid grid-cols-6 gap-2 sm:gap-4 items-end h-72 pt-6 pb-2 px-3 bg-slate-50/60 dark:bg-slate-800/30 rounded-2xl border border-slate-100 dark:border-slate-800">
            {history.map((point) => {
              if (selectedMetric === 'cascade') {
                const capH = Math.max(12, Math.round((point.structureCapAmount / maxCascadeValue) * 100));
                const actualH = Math.max(10, Math.round((point.actualStructureTotal / maxCascadeValue) * 100));
                const underCap = point.actualStructureTotal <= point.structureCapAmount;

                return (
                  <div
                    key={point.cycleId}
                    className="flex flex-col items-center justify-end h-full gap-1.5"
                  >
                    <div className="text-[10px] sm:text-xs font-black tabular-nums text-slate-800 dark:text-slate-100">
                      {formatCompactCurrency(point.actualStructureTotal)}
                    </div>
                    <div className="w-full max-w-[60px] h-48 flex items-end justify-center gap-1">
                      <div
                        title={`Realizado: ${formatCurrency(point.actualStructureTotal)}`}
                        className={`w-1/2 rounded-t-xl transition-all duration-700 ease-out ${
                          underCap ? 'bg-teal-600 dark:bg-teal-500' : 'bg-rose-500 dark:bg-rose-400'
                        }`}
                        style={{ height: `${actualH}%` }}
                      />
                      <div
                        title={`Teto 60%: ${formatCurrency(point.structureCapAmount)}`}
                        className="w-1/2 rounded-t-xl bg-slate-300 dark:bg-slate-600 transition-all duration-700 ease-out"
                        style={{ height: `${capH}%` }}
                      />
                    </div>
                    <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      {point.label}
                    </div>
                  </div>
                );
              }

              const commonH = Math.max(10, Math.round((Math.abs(point.commonSurplus) / maxLedgerValue) * 100));
              const personalH = Math.max(
                10,
                Math.round((Math.abs(point.personalAllowanceSurplus) / maxLedgerValue) * 100)
              );

              return (
                <div
                  key={point.cycleId}
                  className="flex flex-col items-center justify-end h-full gap-1.5"
                >
                  <div className="text-[10px] sm:text-xs font-black tabular-nums text-slate-800 dark:text-slate-100">
                    {formatCompactCurrency(point.commonSurplus)}
                  </div>
                  <div className="w-full max-w-[60px] h-48 flex items-end justify-center gap-1">
                    <div
                      title={`Sobra Caixa Único: ${formatCurrency(point.commonSurplus)}`}
                      className={`w-1/2 rounded-t-xl transition-all duration-700 ease-out ${
                        point.commonSurplus >= 0 ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-rose-500'
                      }`}
                      style={{ height: `${commonH}%` }}
                    />
                    <div
                      title={`Saldo Minha Mesada: ${formatCurrency(point.personalAllowanceSurplus)}`}
                      className="w-1/2 rounded-t-xl bg-violet-500 dark:bg-violet-400 transition-all duration-700 ease-out"
                      style={{ height: `${personalH}%` }}
                    />
                  </div>
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {point.label}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-4">
            <svg viewBox="0 0 500 200" className="w-full h-56 overflow-visible">
              <line x1="0" y1="40" x2="500" y2="40" stroke="#94A3B8" strokeOpacity="0.25" strokeDasharray="3 3" />
              <line x1="0" y1="100" x2="500" y2="100" stroke="#94A3B8" strokeOpacity="0.25" strokeDasharray="3 3" />
              <line x1="0" y1="160" x2="500" y2="160" stroke="#94A3B8" strokeOpacity="0.25" strokeDasharray="3 3" />
              {(() => {
                const values = history.map((p) =>
                  selectedMetric === 'cascade' ? p.actualStructureTotal : p.commonSurplus
                );
                const maxVal = Math.max(1, ...values) * 1.15;
                const minVal = Math.min(0, ...values);
                const span = Math.max(1, maxVal - minVal);
                const points = values.map((val, idx) => ({
                  x: history.length > 1 ? (idx / (history.length - 1)) * 460 + 20 : 250,
                  y: 175 - ((val - minVal) / span) * 135,
                  val,
                  label: history[idx]?.label || '',
                }));
                const pathD = points.reduce(
                  (acc, pt, idx) => (idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`),
                  ''
                );
                return (
                  <>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={selectedMetric === 'cascade' ? currentAccent.hex : '#059669'}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {points.map((pt, idx) => (
                      <g key={idx}>
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r="5"
                          fill="currentColor"
                          className="text-white dark:text-slate-900"
                          stroke={selectedMetric === 'cascade' ? currentAccent.hex : '#059669'}
                          strokeWidth="3"
                        />
                        <text
                          x={pt.x}
                          y={pt.y - 12}
                          fontSize="10"
                          textAnchor="middle"
                          fill="currentColor"
                          className="text-slate-700 dark:text-slate-200 font-bold"
                        >
                          {formatCompactCurrency(pt.val)}
                        </text>
                        <text
                          x={pt.x}
                          y="196"
                          fontSize="10"
                          textAnchor="middle"
                          fill="currentColor"
                          className="text-slate-500 dark:text-slate-400 font-medium"
                        >
                          {pt.label}
                        </text>
                      </g>
                    ))}
                  </>
                );
              })()}
            </svg>
          </div>
        )}

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="p-3.5 rounded-2xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200/70 dark:border-teal-800/60">
            <span className="text-xs font-semibold text-teal-900 dark:text-teal-300 block">
              Economia abaixo do teto (6M)
            </span>
            <span className="text-lg font-extrabold text-teal-950 dark:text-teal-100 tabular-nums block mt-0.5">
              {formatCurrency(total6MSavingsBelowCap)}
            </span>
          </div>

          <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60">
            <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-300 block">
              Sobra acumulada no Caixa Único (6M)
            </span>
            <span className="text-lg font-extrabold text-emerald-950 dark:text-emerald-100 tabular-nums block mt-0.5">
              {formatCurrency(total6MCommonSurplus)}
            </span>
          </div>

          <div className="p-3.5 rounded-2xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200/70 dark:border-violet-800/60">
            <span className="text-xs font-semibold text-violet-900 dark:text-violet-300 block">
              Saldo da Minha Mesada neste ciclo
            </span>
            <span className="text-lg font-extrabold text-violet-950 dark:text-violet-100 tabular-nums block mt-0.5">
              {formatCurrency(waterfallResult.closingLedgers.walletA.closingBalance)}
            </span>
          </div>
        </div>
      </div>

      {/* 6 Sub-Envelopes Donut + Breakdown */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white font-display">
            Distribuição dos 6 Sub-Envelopes da Cascata
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Visão proporcional dos custos da casa neste ciclo (Fixo Cancelável fica fora do cálculo do Escudo).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className="flex justify-center">
            <DonutChart
              data={structureDonutData}
              size={220}
              thickness={38}
              centerTitle="Estrutura"
              centerSubtitle={`${currentStructurePct}% da renda`}
            />
          </div>

          <div className="space-y-2.5">
            {BUCKET_ORDER.map((bucket) => {
              const meta = TRANSACTION_BUCKET_META[bucket];
              const amount = bucketBreakdown[bucket] || 0;
              return (
                <div
                  key={bucket}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: BUCKET_COLORS[bucket] }}
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-white truncate">
                        {meta.label}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {meta.isEssentialForShield ? 'Compõe base do Escudo' : 'Fora da Reserva (Cancelável)'}
                      </div>
                    </div>
                  </div>
                  <span className="font-extrabold text-slate-900 dark:text-white tabular-nums shrink-0">
                    {formatCurrency(amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Dynamic Insights */}
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
        <div className="flex items-center gap-2 text-slate-900 dark:text-white">
          <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h4 className="font-bold uppercase tracking-wider">Leitura Dinâmica da Cascata</h4>
        </div>
        <p className="leading-relaxed">
          • <strong>Moradia ({currentHousingPct}%):</strong>{' '}
          {waterfallResult.guards.housing.status !== 'exceeded'
            ? `Dentro do limite recomendado de 30% (${formatCurrency(waterfallResult.guards.housing.total)}).`
            : `Acima do teto de 30% (${formatCurrency(waterfallResult.guards.housing.total)} vs ${formatCurrency(waterfallResult.guards.housing.capAmount)}).`}
        </p>
        <p className="leading-relaxed">
          • <strong>Escudo Calibrado:</strong> Base essencial mensal de{' '}
          <span className="tabular-nums font-bold">{formatCurrency(shieldMetrics.essentialMonthlyBase)}</span>{' '}
          (excluindo assinaturas canceláveis), garantindo{' '}
          <span className="tabular-nums font-bold">{shieldMetrics.currentCoverageMonths.toFixed(1)} meses</span> de cobertura.
        </p>
        <p className="leading-relaxed flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>
            Zero exposição individual: os gráficos comparam apenas o Caixa Único e a sua própria Mesada.
          </span>
        </p>
      </div>
    </div>
  );
};
