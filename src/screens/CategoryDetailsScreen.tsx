import React, { useMemo, useState } from 'react';
import {
  Edit2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Home,
  CreditCard,
} from 'lucide-react';
import { useFinance, CATEGORIES_BASE, getCategoryInfo } from '../context/FinanceContext';
import {
  CategoryKey,
  ExpenseItem,
  FundingSourceType,
  TransactionBucket,
} from '../types/finance';
import { formatCurrency } from '../utils/formatters';
import { MonthSelector } from '../components/MonthSelector';
import {
  TRANSACTION_BUCKET_META,
  mapCategoryToBucket,
  monthKeyToCycleId,
} from '../utils/v23Helpers';

interface CategoryDetailsScreenProps {
  initialCategory?: CategoryKey;
  onOpenExpenseModal: (
    category?: CategoryKey,
    date?: string,
    toEdit?: ExpenseItem | null,
    isDivided?: boolean
  ) => void;
}

const BUCKET_ORDER: TransactionBucket[] = [
  'housing',
  'fixed_essential',
  'fixed_cancelable',
  'groceries',
  'routine',
  'buffer',
];

export const CategoryDetailsScreen: React.FC<CategoryDetailsScreenProps> = ({
  initialCategory,
  onOpenExpenseModal,
}) => {
  const {
    state,
    deleteExpense,
    editExpense,
    bucketBreakdown,
    waterfallResult,
    v23Transactions,
    v23InstallmentPlans,
    reclassifyTransactionBucket,
    activeCycleId,
  } = useFinance();

  const [selectedBucket, setSelectedBucket] = useState<TransactionBucket | 'all'>(() =>
    initialCategory ? mapCategoryToBucket(initialCategory) : 'all'
  );
  const [filterScope, setFilterScope] = useState<'all' | 'routine' | 'planned' | 'exceptional'>(
    'all'
  );
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);
  const [editError, setEditError] = useState<string>('');

  const currentCycleId = monthKeyToCycleId(state.currentMonth || activeCycleId);

  const v23InCycle = useMemo(
    () => v23Transactions.filter((tx) => tx.cycleId === currentCycleId),
    [v23Transactions, currentCycleId]
  );

  const v23Hashes = useMemo(
    () => new Set(v23InCycle.map((tx) => tx.importHash).filter((h): h is string => Boolean(h))),
    [v23InCycle]
  );

  const filteredV23 = useMemo(() => {
    if (filterScope === 'planned' || filterScope === 'exceptional') return [];
    return v23InCycle.filter(
      (tx) => selectedBucket === 'all' || tx.bucket === selectedBucket
    );
  }, [v23InCycle, selectedBucket, filterScope]);

  const monthExpenses = useMemo(() => {
    return state.expenses.filter((e) => {
      if (!e || e.isSplitParent) return false;
      if (!(e.date || '').startsWith(state.currentMonth)) return false;
      if (e.fundingSource === 'personal_allowance') return false;
      if (e.operationId?.startsWith('csv-hash:') && v23Hashes.has(e.operationId.slice('csv-hash:'.length))) {
        return false;
      }
      if (e.operationId?.startsWith('v23:') && v23Hashes.has(e.operationId.slice('v23:'.length))) {
        return false;
      }
      return true;
    });
  }, [state.expenses, state.currentMonth, v23Hashes]);

  const filteredExpenses = useMemo(() => {
    return monthExpenses.filter((item) => {
      const bucket = mapCategoryToBucket(item.category, item.nature, item.priority);
      const matchBucket = selectedBucket === 'all' || bucket === selectedBucket;
      const source = item.fundingSource || 'month_budget';
      const matchScope =
        filterScope === 'all'
          ? true
          : filterScope === 'routine'
          ? source === 'month_budget' && !item.isExcludedFromMonthlyBudget
          : filterScope === 'planned'
          ? source === 'piggy_bank'
          : source === 'reserve_excess' || item.amount >= 500;
      return matchBucket && matchScope;
    });
  }, [monthExpenses, selectedBucket, filterScope]);

  const activePlansInCycle = useMemo(
    () =>
      v23InstallmentPlans.filter(
        (plan) => plan.startCycleId <= currentCycleId && currentCycleId <= plan.endCycleId
      ),
    [v23InstallmentPlans, currentCycleId]
  );

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense) return;
    try {
      setEditError('');
      const syncedAmount = Number(editingExpense.amount) || 0;
      editExpense({
        ...editingExpense,
        paidBy: 'both',
        amount: syncedAmount,
        amountCents: Math.round(syncedAmount * 100),
      });
      setEditingExpense(null);
    } catch (err: unknown) {
      setEditError(
        err instanceof Error ? err.message : 'Não foi possível salvar as alterações deste gasto.'
      );
    }
  };

  const housingPct = Math.round(waterfallResult.guards.housing.ratio * 100);
  const structurePct = Math.round(waterfallResult.guards.structure.ratio * 100);

  return (
    <div className="space-y-6 pb-20">
      <MonthSelector />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Sub-Envelopes da Cascata 60/30/10
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Caixa Único da casa organizado em 6 envelopes estruturais — sem rateio nem acerto entre parceiros.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onOpenExpenseModal()}
          className="btn-accent min-h-[44px] px-4 py-2 text-xs font-bold shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Registrar no Caixa Único</span>
        </button>
      </div>

      {/* Cascade Structure Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="clay-card p-4 sm:p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Estrutura Total (Meta ≤ 60%)
          </span>
          <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(waterfallResult.guards.structure.actualStructureTotal)}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {structurePct}% da renda · Teto {formatCurrency(waterfallResult.guards.structure.capAmount)}
          </p>
        </div>

        <div
          className={`clay-card p-4 sm:p-5 rounded-3xl border space-y-1 ${
            waterfallResult.guards.housing.status !== 'exceeded'
              ? 'bg-teal-50/50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-800'
              : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-teal-800 dark:text-teal-300 flex items-center gap-1.5">
            <Home className="w-3.5 h-3.5" />
            Trava de Moradia (Meta ≤ 30%)
          </span>
          <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(waterfallResult.guards.housing.total)}
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
            {housingPct}% da renda · Teto {formatCurrency(waterfallResult.guards.housing.capAmount)}
          </p>
        </div>

        <div className="clay-card p-4 sm:p-5 rounded-3xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Fixos Canceláveis (Fora da Reserva)
          </span>
          <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(bucketBreakdown.fixed_cancelable || 0)}
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            Excluído do cálculo da base essencial do Escudo
          </p>
        </div>
      </div>

      {/* 6 Sub-Envelopes Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {BUCKET_ORDER.map((bKey) => {
          const meta = TRANSACTION_BUCKET_META[bKey];
          const amount = bucketBreakdown[bKey] || 0;
          const active = selectedBucket === bKey;
          return (
            <button
              key={bKey}
              type="button"
              onClick={() => setSelectedBucket(active ? 'all' : bKey)}
              className={`min-h-[76px] p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                active
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 hover:border-slate-400'
              }`}
            >
              <div className="text-[11px] font-bold opacity-80 truncate">{meta.label}</div>
              <div className="text-base font-black tabular-nums mt-1">{formatCurrency(amount)}</div>
              <div className="text-[10px] opacity-70 mt-0.5 truncate">
                {meta.isEssentialForShield ? 'Escudo' : 'Fora da Reserva'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Bucket & Nature Filter Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setSelectedBucket('all')}
            className={`min-h-[36px] px-3 py-1 rounded-xl font-bold transition-colors cursor-pointer ${
              selectedBucket === 'all'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Todos os Sub-Envelopes
          </button>
          {BUCKET_ORDER.map((bKey) => (
            <button
              key={bKey}
              type="button"
              onClick={() => setSelectedBucket(bKey)}
              className={`min-h-[36px] px-3 py-1 rounded-xl font-bold transition-colors cursor-pointer ${
                selectedBucket === bKey
                  ? 'bg-sky-700 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {TRANSACTION_BUCKET_META[bKey].shortLabel}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            { id: 'all', label: 'Todas as fontes' },
            { id: 'routine', label: 'Caixa Único' },
            { id: 'planned', label: 'Metas' },
            { id: 'exceptional', label: 'Excesso Escudo' },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilterScope(opt.id)}
              className={`min-h-[36px] px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                filterScope === opt.id
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Installment Plans in Cycle */}
      {activePlansInCycle.length > 0 && selectedBucket === 'all' && (
        <div className="bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 rounded-3xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-amber-800 dark:text-amber-400" />
            <h4 className="text-xs font-bold text-amber-900 dark:text-amber-300 uppercase tracking-wider">
              Parcelas da Casa ativas neste ciclo ({activePlansInCycle.length})
            </h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {activePlansInCycle.map((plan, idx) => (
              <div
                key={plan.id || idx}
                className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-amber-200 dark:border-amber-900/60 flex items-center justify-between text-xs"
              >
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 dark:text-white truncate">
                    {plan.title}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {plan.currentInstallment}/{plan.totalInstallments} parcelas · Caixa Único
                  </div>
                </div>
                <div className="font-bold text-amber-900 dark:text-amber-300 tabular-nums shrink-0">
                  {formatCurrency(plan.installmentAmount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Combined Ledger: v2.3 Reclassifiable Transactions + Legacy House Expenses */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="font-bold text-slate-900 dark:text-white text-base font-display">
            Lançamentos da Estrutura ({filteredV23.length + filteredExpenses.length})
          </h3>
          <button
            type="button"
            onClick={() => onOpenExpenseModal()}
            className="flex items-center gap-1 text-xs font-bold text-accent-themed hover:underline cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Gasto
          </button>
        </div>

        {filteredV23.length === 0 && filteredExpenses.length === 0 ? (
          <div className="text-center py-10 space-y-2">
            <Sparkles className="w-7 h-7 mx-auto text-slate-400" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Nenhum lançamento encontrado neste sub-envelope
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Use o botão Registrar para lançar em menos de 5 segundos.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredV23.map((tx) => {
              const meta = TRANSACTION_BUCKET_META[tx.bucket];
              return (
                <div
                  key={tx.id || `${tx.title}-${tx.date}`}
                  className="py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white text-sm truncate">
                      {tx.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                      <span>{tx.date.split('-').reverse().join('/')}</span>
                      <span>·</span>
                      <span>Caixa Único</span>
                      {!meta.isEssentialForShield && (
                        <span className="text-amber-700 dark:text-amber-300 font-semibold">
                          · Fora da Reserva
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {tx.id && (
                      <select
                        aria-label={`Sub-envelope de ${tx.title}`}
                        value={tx.bucket}
                        onChange={(e) =>
                          void reclassifyTransactionBucket(
                            tx.id!,
                            e.target.value as TransactionBucket
                          )
                        }
                        className="min-h-[36px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100"
                      >
                        {BUCKET_ORDER.map((bKey) => (
                          <option key={bKey} value={bKey}>
                            {TRANSACTION_BUCKET_META[bKey].label}
                          </option>
                        ))}
                      </select>
                    )}

                    <div className="font-extrabold text-slate-900 dark:text-white text-sm sm:text-base tabular-nums">
                      {formatCurrency(tx.amount)}
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredExpenses.map((item) => {
              const cat = getCategoryInfo(item.category);
              const bucket = mapCategoryToBucket(item.category, item.nature, item.priority);
              const meta = TRANSACTION_BUCKET_META[bucket];
              return (
                <div
                  key={item.id}
                  className="py-3.5 flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-800 flex items-center justify-center text-lg shrink-0">
                      {cat.emoji}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-white text-sm truncate">
                        {item.description}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {meta.label}
                        </span>
                        <span>·</span>
                        <span>{item.date.split('-').reverse().join('/')}</span>
                        <span>·</span>
                        <span>Caixa Único (Casa)</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="font-extrabold text-slate-900 dark:text-white text-sm sm:text-base tabular-nums">
                      {formatCurrency(item.amount)}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingExpense(item)}
                        className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                        title="Editar lançamento"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteExpense(item.id)}
                        className="w-9 h-9 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/60 text-slate-400 hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
                        title="Excluir lançamento"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Clean Edit Modal (Caixa Único — zero partner split) */}
      {editingExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl space-y-4 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-white text-lg font-display">
                Editar Lançamento da Casa
              </h3>
              <button
                type="button"
                onClick={() => setEditingExpense(null)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              {editError && (
                <p
                  role="alert"
                  className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-800 dark:text-rose-200"
                >
                  {editError}
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Descrição
                </label>
                <input
                  type="text"
                  value={editingExpense.description}
                  onChange={(e) =>
                    setEditingExpense({ ...editingExpense, description: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Valor (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editingExpense.amount}
                  onChange={(e) => {
                    const nextVal = parseFloat(e.target.value) || 0;
                    setEditingExpense({
                      ...editingExpense,
                      amount: nextVal,
                      amountCents: Math.round(nextVal * 100),
                    });
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm tabular-nums"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Categoria / Envelope
                </label>
                <select
                  value={editingExpense.category}
                  onChange={(e) =>
                    setEditingExpense({
                      ...editingExpense,
                      category: e.target.value as CategoryKey,
                    })
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {(Object.keys(CATEGORIES_BASE) as CategoryKey[]).map((key) => (
                    <option key={key} value={key}>
                      {CATEGORIES_BASE[key].emoji} {CATEGORIES_BASE[key].name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Fonte de Financiamento
                </label>
                <select
                  value={editingExpense.fundingSource || 'month_budget'}
                  onChange={(e) => {
                    const src = e.target.value as FundingSourceType;
                    setEditingExpense({
                      ...editingExpense,
                      fundingSource: src,
                      isExcludedFromMonthlyBudget: src !== 'month_budget',
                    });
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="month_budget">Caixa Único (Casa & Rotina)</option>
                  <option value="piggy_bank">Meta / Sonho</option>
                  <option value="reserve_excess">Gordura do Escudo</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingExpense(null);
                    setEditError('');
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-accent px-5 py-2 rounded-xl text-xs font-bold"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
