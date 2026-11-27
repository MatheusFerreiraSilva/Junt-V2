import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Info,
  Lock,
  Plus,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { DuplicateReconciliationCard } from '../components/DuplicateReconciliationCard';
import { StatementAuditModal } from '../components/modals/StatementAuditModal';
import { TransactionTriageBottomSheet } from '../components/modals/TransactionTriageBottomSheet';
import { useFinance } from '../context/FinanceContext';
import {
  CategoryKey,
  ExpenseItem,
  TransactionBucket,
} from '../types/finance';
import { formatCurrency } from '../utils/formatters';
import {
  buildUnifiedLedger,
  normalizeSearchTerm,
  StatementItem,
} from '../utils/unifiedLedger';
import { monthKeyToCycleId, TRANSACTION_BUCKET_META } from '../utils/v23Helpers';

interface TransactionHistoryScreenProps {
  onOpenExpenseModal: (category?: CategoryKey, date?: string, toEdit?: ExpenseItem | null) => void;
  onOpenTriageModal?: (expense: ExpenseItem) => void;
}

type HistoryOriginTab = 'all' | 'house' | 'shared_allowance' | 'solo_allowance' | 'inflow';

const ALL_BUCKETS: TransactionBucket[] = [
  'housing',
  'fixed_essential',
  'fixed_cancelable',
  'groceries',
  'routine',
  'buffer',
];

interface UnifiedHistoryRow {
  id: string;
  date: string;
  title: string;
  amount: number;
  kind: 'house' | 'shared_allowance' | 'solo_allowance' | 'inflow' | 'internal';
  bucket?: TransactionBucket;
  v23TxId?: string;
  subtitle: string;
  badgeLabel: string;
  rawStatementItem?: StatementItem;
}

export const TransactionHistoryScreen: React.FC<TransactionHistoryScreenProps> = ({
  onOpenExpenseModal,
}) => {
  const {
    state,
    v23Transactions,
    v23SharedAllowanceExpenses,
    myAllowanceExpenses,
    reclassifyTransactionBucket,
    deleteExpense,
    deleteIncome,
    reverseFinancialOperation,
    detectedDuplicates,
  } = useFinance();

  const [triageExpense, setTriageExpense] = useState<ExpenseItem | null>(null);
  const [inspectAuditItem, setInspectAuditItem] = useState<StatementItem | null>(null);
  const [actionError, setActionError] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [originTab, setOriginTab] = useState<HistoryOriginTab>('all');
  const [selectedBucket, setSelectedBucket] = useState<TransactionBucket | 'all'>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>(state.currentMonth || 'all');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'>(
    'date-desc'
  );

  // Merge v2.3 streams + non-duplicated legacy inflows/expenses (excluding partner private data)
  const rows = useMemo<UnifiedHistoryRow[]>(() => {
    const out: UnifiedHistoryRow[] = [];
    const seenHashes = new Set<string>();

    // 1. Casa & Rotina (v2.3)
    for (const tx of v23Transactions) {
      if (tx.importHash) seenHashes.add(tx.importHash);
      out.push({
        id: `v23-tx-${tx.id}`,
        v23TxId: tx.id,
        date: tx.date,
        title: tx.title,
        amount: tx.amount,
        kind: 'house',
        bucket: tx.bucket,
        subtitle: TRANSACTION_BUCKET_META[tx.bucket]?.label || tx.bucket,
        badgeLabel: 'Casa & Rotina',
      });
    }

    // 2. Mesada — Dos Dois (50/50)
    for (const shared of v23SharedAllowanceExpenses) {
      if (shared.importHash) seenHashes.add(shared.importHash);
      out.push({
        id: `v23-shared-${shared.id}`,
        date: shared.date,
        title: shared.title,
        amount: shared.totalAmount,
        kind: 'shared_allowance',
        subtitle: `Mesada 50/50 · ${formatCurrency(shared.splitPerPartner)} cada`,
        badgeLabel: 'Dos Dois',
      });
    }

    // 3. Mesada — Só Minha (estritamente privada do usuário autenticado)
    for (const solo of myAllowanceExpenses) {
      if (solo.importHash) seenHashes.add(solo.importHash);
      out.push({
        id: `v23-solo-${solo.id}`,
        date: solo.date,
        title: solo.title,
        amount: solo.amount,
        kind: 'solo_allowance',
        subtitle: solo.installmentInfo
          ? `Parcela ${solo.installmentInfo.currentInstallment}/${solo.installmentInfo.totalInstallments} da sua mesada`
          : 'Gasto livre privado da sua mesada',
        badgeLabel: 'Só Minha',
      });
    }

    // 4. Legacy ledger entries (avoiding duplicates already in v2.3 collections)
    const legacyStream = buildUnifiedLedger(state, 'couple');
    for (const item of legacyStream) {
      const opHash = item.operationId?.startsWith('csv-hash:')
        ? item.operationId.slice('csv-hash:'.length)
        : item.operationId?.startsWith('v23:')
        ? item.operationId.slice('v23:'.length)
        : null;
      if (opHash && seenHashes.has(opHash)) continue;
      if (item.rawExpense?.fundingSource === 'personal_allowance') continue;

      if (item.direction === 'inflow') {
        out.push({
          id: `legacy-${item.id}`,
          date: item.date,
          title: item.title,
          amount: item.amount,
          kind: 'inflow',
          subtitle: item.categoryName,
          badgeLabel: 'Entrada',
          rawStatementItem: item,
        });
      } else if (item.direction === 'internal') {
        out.push({
          id: `legacy-${item.id}`,
          date: item.date,
          title: item.title,
          amount: item.amount,
          kind: 'internal',
          subtitle: 'Transferência interna (impacto zero)',
          badgeLabel: 'Interno',
          rawStatementItem: item,
        });
      } else {
        out.push({
          id: `legacy-${item.id}`,
          date: item.date,
          title: item.title,
          amount: item.amount,
          kind: 'house',
          bucket: 'routine',
          subtitle: item.categoryName,
          badgeLabel: 'Casa & Rotina',
          rawStatementItem: item,
        });
      }
    }

    return out;
  }, [v23Transactions, v23SharedAllowanceExpenses, myAllowanceExpenses, state]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    if (state.currentMonth) set.add(state.currentMonth);
    rows.forEach((r) => {
      if (r.date && r.date.length >= 7) set.add(r.date.slice(0, 7));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [rows, state.currentMonth]);

  const filteredRows = useMemo(() => {
    const { text: termText, numVal: termNumVal } = normalizeSearchTerm(searchTerm);

    return rows
      .filter((row) => {
        if (selectedMonth !== 'all' && !row.date.startsWith(selectedMonth)) return false;
        if (originTab !== 'all' && row.kind !== originTab) return false;
        if (selectedBucket !== 'all') {
          if (row.kind !== 'house' || row.bucket !== selectedBucket) return false;
        }

        if (termText) {
          const titleMatch = row.title.toLowerCase().includes(termText);
          const subMatch = row.subtitle.toLowerCase().includes(termText);
          const amountMatch =
            termNumVal !== undefined
              ? Math.abs(row.amount - termNumVal) < 0.01
              : row.amount.toString().includes(termText);
          if (!titleMatch && !subMatch && !amountMatch) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'date-desc') return b.date.localeCompare(a.date);
        if (sortBy === 'date-asc') return a.date.localeCompare(b.date);
        if (sortBy === 'amount-desc') return b.amount - a.amount;
        return a.amount - b.amount;
      });
  }, [rows, selectedMonth, originTab, selectedBucket, searchTerm, sortBy]);

  const totals = useMemo(() => {
    let inflows = 0;
    let houseOutflow = 0;
    let allowanceOutflow = 0;
    let internal = 0;
    for (const r of filteredRows) {
      if (r.kind === 'inflow') inflows += r.amount;
      else if (r.kind === 'house') houseOutflow += r.amount;
      else if (r.kind === 'shared_allowance' || r.kind === 'solo_allowance') {
        allowanceOutflow += r.amount;
      } else if (r.kind === 'internal') {
        internal += r.amount;
      }
    }
    return {
      inflows,
      houseOutflow,
      allowanceOutflow,
      internal,
      net: inflows - houseOutflow,
      count: filteredRows.length,
    };
  }, [filteredRows]);

  const handleBucketChange = async (row: UnifiedHistoryRow, newBucket: TransactionBucket) => {
    if (!row.v23TxId) return;
    setActionError('');
    try {
      await reclassifyTransactionBucket(row.v23TxId, newBucket);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erro ao reclassificar lançamento.');
    }
  };

  const handleDeleteLegacy = (item: StatementItem) => {
    try {
      setActionError('');
      if (item.entityType === 'expense') deleteExpense(item.entityId);
      else if (item.entityType === 'income') deleteIncome(item.entityId, true);
      else if (item.entityType === 'financial_operation' && item.operationId) {
        reverseFinancialOperation(item.operationId, 'Estorno pelo Extrato');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível estornar este registro.');
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white font-display tracking-tight">
            Extrato por Destino
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Casa & Rotina, Programas a Dois e seus gastos privados da Mesada com reclassificação em 1 toque.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onOpenExpenseModal()}
          className="btn-primary-accent flex items-center gap-2 px-4 py-2.5 rounded-2xl text-white text-xs font-bold shadow-xs shrink-0 self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Lançamento</span>
        </button>
      </div>

      {detectedDuplicates.length > 0 && <DuplicateReconciliationCard />}

      {actionError && (
        <p
          role="alert"
          className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-800 dark:text-rose-200"
        >
          {actionError}
        </p>
      )}

      {/* Summary Bento Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="clay-card bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Saldo Caixa Comum</span>
            <span className="text-[10px] tabular-nums">{totals.count} itens</span>
          </span>
          <div
            className={`text-xl font-black tabular-nums font-display ${
              totals.net >= 0
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-rose-700 dark:text-rose-300'
            }`}
          >
            {totals.net >= 0 ? '+ ' : ''}
            {formatCurrency(totals.net)}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Entradas menos Casa & Rotina</p>
        </div>

        <div className="clay-card bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-1">
          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Entradas
          </span>
          <div className="text-xl font-black text-slate-900 dark:text-white tabular-nums font-display">
            {formatCurrency(totals.inflows)}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Salários e plantões recebidos</p>
        </div>

        <div className="clay-card bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-1">
          <span className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" /> Casa & Rotina
          </span>
          <div className="text-xl font-black text-slate-900 dark:text-white tabular-nums font-display">
            {formatCurrency(totals.houseOutflow)}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Saídas dos 6 envelopes</p>
        </div>

        <div className="clay-card bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-1">
          <span className="text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider flex items-center gap-1.5">
            <ArrowRightLeft className="w-3.5 h-3.5" /> Mesada (Seus + Dois)
          </span>
          <div className="text-xl font-black text-slate-900 dark:text-white tabular-nums font-display">
            {formatCurrency(totals.allowanceOutflow)}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Gastos livres e programas a dois
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 space-y-3.5">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por descrição, envelope ou valor..."
              className="w-full pl-10 pr-10 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-white text-xs"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            aria-label="Filtrar por ciclo"
            className="px-3 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
          >
            <option value="all">Todo o Histórico</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                Ciclo {monthKeyToCycleId(m)} ({m})
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            aria-label="Ordenação"
            className="px-3 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
          >
            <option value="date-desc">Mais recentes</option>
            <option value="date-asc">Mais antigos</option>
            <option value="amount-desc">Maior valor</option>
            <option value="amount-asc">Menor valor</option>
          </select>
        </div>

        {/* 4 Destination Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs font-bold">
          {(
            [
              { id: 'all', label: 'Todos' },
              { id: 'house', label: 'Casa & Rotina' },
              { id: 'shared_allowance', label: 'Mesada — Dos Dois' },
              { id: 'solo_allowance', label: 'Mesada — Só Minha' },
              { id: 'inflow', label: 'Entradas' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setOriginTab(tab.id);
                if (tab.id !== 'house' && tab.id !== 'all') setSelectedBucket('all');
              }}
              className={`px-3.5 py-2 rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
                originTab === tab.id
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 6 Bucket Chips */}
        {(originTab === 'all' || originTab === 'house') && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px] font-bold pt-1 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setSelectedBucket('all')}
              className={`px-2.5 py-1.5 rounded-xl whitespace-nowrap cursor-pointer ${
                selectedBucket === 'all'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              Todos os Envelopes
            </button>
            {ALL_BUCKETS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setSelectedBucket(b)}
                className={`px-2.5 py-1.5 rounded-xl whitespace-nowrap cursor-pointer ${
                  selectedBucket === b
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {TRANSACTION_BUCKET_META[b].label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Stream List */}
      <div className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="font-bold text-slate-900 dark:text-white text-base font-display">
            Lançamentos ({filteredRows.length})
          </h3>
          <span className="text-xs text-slate-400">
            Zero vigilância: gastos privados do parceiro nunca aparecem aqui
          </span>
        </div>

        {filteredRows.length === 0 ? (
          <div className="text-center py-10 space-y-1">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Nenhum lançamento encontrado para esses filtros.
            </p>
            <p className="text-xs text-slate-400">
              Ajuste o período, envelope ou busca acima.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredRows.map((row) => {
              const isInflow = row.kind === 'inflow';
              const isInternal = row.kind === 'internal';

              return (
                <div
                  key={row.id}
                  className="py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 dark:text-white text-sm truncate">
                        {row.title}
                      </span>

                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 ${
                          row.kind === 'solo_allowance'
                            ? 'bg-violet-100 dark:bg-violet-950 text-violet-800 dark:text-violet-200'
                            : row.kind === 'shared_allowance'
                            ? 'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200'
                            : row.kind === 'inflow'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {row.kind === 'solo_allowance' && <Lock className="w-3 h-3" />}
                        {row.kind === 'shared_allowance' && <Users className="w-3 h-3" />}
                        <span>{row.badgeLabel}</span>
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                      <span>{row.subtitle}</span>
                      <span>·</span>
                      <span className="tabular-nums">{row.date.split('-').reverse().join('/')}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {/* 1-Tap Reclassification for v2.3 Casa & Rotina transactions */}
                    {row.v23TxId && row.bucket && (
                      <select
                        aria-label={`Reclassificar envelope de ${row.title}`}
                        value={row.bucket}
                        onChange={(e) =>
                          void handleBucketChange(row, e.target.value as TransactionBucket)
                        }
                        className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        {ALL_BUCKETS.map((b) => (
                          <option key={b} value={b}>
                            {TRANSACTION_BUCKET_META[b].label}
                          </option>
                        ))}
                      </select>
                    )}

                    <div
                      className={`font-black text-sm sm:text-base tabular-nums font-display ${
                        isInflow
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : isInternal
                          ? 'text-sky-700 dark:text-sky-300'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {isInflow ? '+ ' : isInternal ? '' : '- '}
                      {formatCurrency(row.amount)}
                    </div>

                    {row.rawStatementItem && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setInspectAuditItem(row.rawStatementItem!)}
                          className="w-8 h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 flex items-center justify-center"
                          title="Rastreabilidade"
                        >
                          <Info className="w-4 h-4" />
                        </button>
                        {row.rawStatementItem.status !== 'reverted' && (
                          <button
                            type="button"
                            onClick={() => handleDeleteLegacy(row.rawStatementItem!)}
                            className="w-8 h-8 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/60 text-slate-400 hover:text-rose-600 flex items-center justify-center"
                            title="Excluir ou estornar"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <StatementAuditModal
        item={inspectAuditItem}
        onClose={() => setInspectAuditItem(null)}
        onEdit={(item) => {
          if (item.entityType === 'expense' && item.rawExpense) {
            setTriageExpense(item.rawExpense);
          }
        }}
        onDelete={handleDeleteLegacy}
      />

      {triageExpense && (
        <TransactionTriageBottomSheet
          isOpen={!!triageExpense}
          expense={triageExpense}
          onClose={() => setTriageExpense(null)}
        />
      )}
    </div>
  );
};
