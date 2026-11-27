import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CreditCard,
  Home,
  Lock,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useFinance } from '../../context/FinanceContext';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import {
  CategoryKey,
  ExpenseItem,
  TransactionBucket,
  V23CascadeDestination,
} from '../../types/finance';
import { formatCurrency } from '../../utils/formatters';
import { mapBucketToCategory, mapCategoryToBucket, TRANSACTION_BUCKET_META } from '../../utils/v23Helpers';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultCategory?: CategoryKey;
  defaultDate?: string;
  expenseToEdit?: ExpenseItem | null;
  defaultDivided?: boolean;
}

const BUCKET_ORDER: TransactionBucket[] = [
  'housing',
  'fixed_essential',
  'fixed_cancelable',
  'groceries',
  'routine',
  'buffer',
];

const QUICK_AMOUNTS = [20, 50, 100, 250];

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  onClose,
  defaultCategory,
  defaultDate,
  expenseToEdit,
  defaultDivided,
}) => {
  const {
    state,
    currentUser,
    householdConfig,
    addCascadeTransaction,
    editExpense,
    simulateInstallment,
  } = useFinance();

  const dialogRef = useDialogFocus(isOpen, onClose);
  const draftKey = `expense_modal_draft_${currentUser?.uid || 'guest'}`;

  const defaultToday = useMemo(
    () => defaultDate || new Date().toISOString().slice(0, 10),
    [defaultDate]
  );

  const initialBucket = useMemo<TransactionBucket>(
    () =>
      defaultCategory
        ? mapCategoryToBucket(defaultCategory)
        : 'routine',
    [defaultCategory]
  );

  const [amountInput, setAmountInput] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultToday);
  const [destination, setDestination] = useState<V23CascadeDestination>(
    defaultDivided ? 'shared_allowance' : 'house_routine'
  );
  const [bucket, setBucket] = useState<TransactionBucket>(initialBucket);
  const [sharedCategory, setSharedCategory] = useState('lazer_casal');
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentsCount, setInstallmentsCount] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hydrate draft or expenseToEdit when opened
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);

    if (expenseToEdit) {
      setAmountInput(String(expenseToEdit.amount || ''));
      setTitle(expenseToEdit.description || '');
      setDate(expenseToEdit.date || defaultToday);
      setDestination(
        expenseToEdit.fundingSource === 'personal_allowance'
          ? 'shared_allowance'
          : 'house_routine'
      );
      setBucket(
        mapCategoryToBucket(
          expenseToEdit.category,
          expenseToEdit.nature,
          expenseToEdit.priority
        )
      );
      setIsInstallment(false);
      return;
    }

    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          setAmountInput(typeof parsed.amount === 'string' ? parsed.amount : '');
          setTitle(typeof parsed.description === 'string' ? parsed.description : '');
          setDate(typeof parsed.date === 'string' && parsed.date ? parsed.date : defaultToday);
          if (
            parsed.destination === 'house_routine' ||
            parsed.destination === 'solo_allowance' ||
            parsed.destination === 'shared_allowance' ||
            parsed.destination === 'internal'
          ) {
            setDestination(parsed.destination);
          } else {
            setDestination(defaultDivided ? 'shared_allowance' : 'house_routine');
          }
          if (parsed.bucket && parsed.bucket in TRANSACTION_BUCKET_META) {
            setBucket(parsed.bucket);
          } else {
            setBucket(initialBucket);
          }
          setIsInstallment(Boolean(parsed.isInstallment));
          setInstallmentsCount(
            typeof parsed.installmentsCount === 'number' && parsed.installmentsCount >= 2
              ? parsed.installmentsCount
              : 3
          );
          return;
        }
      }
    } catch {
      // ignore invalid draft
    }

    setAmountInput('');
    setTitle('');
    setDate(defaultToday);
    setDestination(defaultDivided ? 'shared_allowance' : 'house_routine');
    setBucket(initialBucket);
    setIsInstallment(false);
    setInstallmentsCount(3);
  }, [isOpen, expenseToEdit, draftKey, defaultToday, defaultDivided, initialBucket]);

  // Persist draft live for new entries
  useEffect(() => {
    if (!isOpen || expenseToEdit) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          amount: amountInput,
          description: title,
          date,
          destination,
          bucket,
          isInstallment,
          installmentsCount,
        })
      );
    } catch {
      // ignore quota errors
    }
  }, [
    isOpen,
    expenseToEdit,
    draftKey,
    amountInput,
    title,
    date,
    destination,
    bucket,
    isInstallment,
    installmentsCount,
  ]);

  const parsedAmount = useMemo(() => {
    const cleaned = amountInput.replace(',', '.').trim();
    const num = parseFloat(cleaned);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [amountInput]);

  const supportsInstallment =
    !expenseToEdit && (destination === 'house_routine' || destination === 'solo_allowance');

  const installmentPreview = useMemo(() => {
    if (!supportsInstallment || !isInstallment || parsedAmount <= 0) return null;
    return simulateInstallment({
      purchaseAmount: parsedAmount,
      installmentsCount,
      scope: destination === 'solo_allowance' ? 'solo_allowance' : 'house',
    });
  }, [supportsInstallment, isInstallment, parsedAmount, installmentsCount, destination, simulateInstallment]);

  const isBlockedByInstallmentRule = installmentPreview?.verdict === 'blocked';

  if (!isOpen) return null;

  const handleQuickAdd = (delta: number) => {
    const next = parsedAmount + delta;
    setAmountInput(next.toFixed(2));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (parsedAmount <= 0) {
      setErrorMsg('Informe um valor maior que zero.');
      return;
    }

    if (isBlockedByInstallmentRule && installmentPreview) {
      setErrorMsg(installmentPreview.reason);
      return;
    }

    setSubmitting(true);
    try {
      if (expenseToEdit && editExpense) {
        editExpense(expenseToEdit.id, {
          description: title.trim() || expenseToEdit.description || 'Lançamento',
          amount: parsedAmount,
          date,
          category: mapBucketToCategory(bucket),
          nature:
            bucket === 'fixed_essential' || bucket === 'fixed_cancelable' ? 'fixa' : 'variavel',
          priority: bucket === 'fixed_cancelable' ? 'dispensavel' : 'essencial',
          fundingSource:
            destination === 'shared_allowance' ? 'personal_allowance' : 'month_budget',
          isExcludedFromMonthlyBudget: destination === 'shared_allowance',
        });
      } else {
        await addCascadeTransaction({
          destination,
          title:
            title.trim() ||
            (destination === 'house_routine'
              ? TRANSACTION_BUCKET_META[bucket].label
              : destination === 'solo_allowance'
              ? 'Gasto pessoal'
              : destination === 'shared_allowance'
              ? 'Programa a dois'
              : 'Movimentação interna'),
          amount: parsedAmount,
          date: date || `${state.currentMonth}-01`,
          bucket: destination === 'house_routine' ? bucket : undefined,
          sharedCategory: destination === 'shared_allowance' ? sharedCategory : undefined,
          installmentsCount: supportsInstallment && isInstallment ? installmentsCount : 1,
        });
      }

      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível salvar este lançamento.');
    } finally {
      setSubmitting(false);
    }
  };

  const destinations: Array<{
    id: V23CascadeDestination;
    label: string;
    sub: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'house_routine',
      label: 'Casa & Rotina',
      sub: 'Caixa Único',
      icon: <Home className="w-4 h-4" />,
    },
    {
      id: 'solo_allowance',
      label: 'Mesada — Só Minha',
      sub: 'Privado',
      icon: <Lock className="w-4 h-4" />,
    },
    {
      id: 'shared_allowance',
      label: 'Mesada — Dos Dois',
      sub: '50/50',
      icon: <Users className="w-4 h-4" />,
    },
    {
      id: 'internal',
      label: 'Interno',
      sub: 'Sem cascata',
      icon: <ArrowLeftRight className="w-4 h-4" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-modal-title"
        className="w-full sm:max-w-xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2
              id="expense-modal-title"
              className="text-base sm:text-lg font-bold text-slate-900 dark:text-white"
            >
              {expenseToEdit ? 'Editar Lançamento' : 'Lançamento Rápido'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-300">
              Escolha o destino direto na cascata — sem rateio por despesa.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de lançamento"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-5 overflow-y-auto">
          {/* 1. Valor + Quick Pills */}
          <div className="space-y-2.5">
            <label
              htmlFor="expense-amount-input"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              Valor (R$)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
                R$
              </span>
              <input
                id="expense-amount-input"
                type="number"
                step="0.01"
                min="0"
                autoFocus
                placeholder="0,00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="w-full min-h-[56px] pl-12 pr-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums focus:border-slate-900 dark:focus:border-white outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleQuickAdd(val)}
                  className="min-h-[36px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums"
                >
                  +R$ {val}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Título & Data */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label
                htmlFor="expense-title-input"
                className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
              >
                Descrição
              </label>
              <input
                id="expense-title-input"
                type="text"
                placeholder="Ex: Mercado, Jantar, Spotify..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="expense-date-input"
                className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
              >
                Data
              </label>
              <input
                id="expense-date-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white tabular-nums"
              />
            </div>
          </div>

          {/* 3. Seletor Segmentado dos 4 Destinos */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Destino do Lançamento
            </span>
            <div className="grid grid-cols-2 gap-2">
              {destinations.map((dest) => {
                const active = destination === dest.id;
                return (
                  <button
                    key={dest.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDestination(dest.id)}
                    className={`min-h-[52px] p-3 rounded-2xl border text-left transition-colors flex items-center gap-2.5 ${
                      active
                        ? dest.id === 'solo_allowance'
                          ? 'bg-violet-600 text-white border-violet-600'
                          : dest.id === 'shared_allowance'
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="shrink-0">{dest.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold truncate">{dest.label}</span>
                      <span
                        className={`block text-[11px] ${
                          active ? 'opacity-85' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {dest.sub}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contextual panel per destination */}
          {destination === 'house_routine' && (
            <div className="space-y-2">
              <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Sub-envelope da Estrutura (60%)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {BUCKET_ORDER.map((bKey) => {
                  const meta = TRANSACTION_BUCKET_META[bKey];
                  const active = bucket === bKey;
                  return (
                    <button
                      key={bKey}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setBucket(bKey)}
                      className={`min-h-[44px] px-3 py-2 rounded-xl border text-left text-xs transition-colors ${
                        active
                          ? 'bg-sky-700 text-white border-sky-700 font-bold'
                          : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium'
                      }`}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {TRANSACTION_BUCKET_META[bucket].description}
              </p>
            </div>
          )}

          {destination === 'solo_allowance' && (
            <div className="rounded-2xl p-3.5 bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-violet-900 dark:text-violet-200 flex items-start gap-2.5 text-xs">
              <Lock className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  Visível só para você — gravado na sua carteira privada
                </p>
                <p className="mt-0.5 opacity-90">
                  Nunca entra no documento compartilhado do casal nem aparece para o parceiro.
                </p>
              </div>
            </div>
          )}

          {destination === 'shared_allowance' && (
            <div className="rounded-2xl p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 space-y-2.5 text-xs">
              <div className="flex items-start gap-2.5">
                <Users className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">
                    Divide 50/50 entre as duas mesadas sem expor saldos
                  </p>
                  {parsedAmount > 0 && (
                    <p className="mt-0.5 font-semibold tabular-nums">
                      Sua parte: {formatCurrency(parsedAmount / 2)} · Parte do par:{' '}
                      {formatCurrency(parsedAmount / 2)}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label
                  htmlFor="shared-category-select"
                  className="block text-[11px] font-semibold mb-1"
                >
                  Categoria do programa a dois
                </label>
                <select
                  id="shared-category-select"
                  value={sharedCategory}
                  onChange={(e) => setSharedCategory(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-rose-200 dark:border-rose-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-white"
                >
                  <option value="lazer_casal">Lazer & Date Night</option>
                  <option value="jantar_fora">Jantares & Cafés</option>
                  <option value="viagem">Passeios & Viagens</option>
                  <option value="presentes">Presentes & Mimos</option>
                </select>
              </div>
            </div>
          )}

          {destination === 'internal' && (
            <div className="rounded-2xl p-3.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs flex items-start gap-2.5">
              <ArrowLeftRight className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                Movimentação interna entre contas próprias (Pix de mesma titularidade ou pagamento
                de fatura). Sem impacto na cascata mensal.
              </p>
            </div>
          )}

          {/* 4. Toggle compacto Compra Parcelada */}
          {supportsInstallment && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      Compra Parcelada
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {destination === 'solo_allowance'
                        ? `Limite pessoal: até ${formatCurrency(householdConfig.allowanceFloor * 0.5)}/mês`
                        : 'Avalia trava de 10%–20% da renda 3M'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isInstallment}
                  onClick={() => setIsInstallment((prev) => !prev)}
                  className={`min-h-[36px] px-3.5 rounded-xl text-xs font-bold border transition-colors ${
                    isInstallment
                      ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {isInstallment ? 'Parcelado' : 'À vista'}
                </button>
              </div>

              {isInstallment && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor="expense-installments-select"
                      className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      Número de parcelas
                    </label>
                    <select
                      id="expense-installments-select"
                      value={installmentsCount}
                      onChange={(e) => setInstallmentsCount(Number(e.target.value))}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold tabular-nums"
                    >
                      {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                        <option key={n} value={n}>
                          {n}x
                        </option>
                      ))}
                    </select>
                  </div>

                  {installmentPreview && (
                    <div
                      role="status"
                      className={`rounded-xl p-3 text-xs border ${
                        installmentPreview.verdict === 'blocked'
                          ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                          : installmentPreview.verdict === 'caution'
                          ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                          : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                      }`}
                    >
                      <p className="font-bold tabular-nums flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        {installmentsCount}x de {formatCurrency(installmentPreview.monthlyInstallment)}
                      </p>
                      <p className="mt-0.5">{installmentPreview.reason}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Footer CTA */}
          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="btn-outline min-h-[48px] px-4 text-xs sm:text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || isBlockedByInstallmentRule}
              className="btn-accent flex-1 min-h-[48px] text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              {submitting
                ? 'Salvando...'
                : expenseToEdit
                ? 'Salvar Alterações'
                : 'Registrar Lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
