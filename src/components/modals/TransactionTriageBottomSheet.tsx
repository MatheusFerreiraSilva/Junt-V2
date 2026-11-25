import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Check,
  Shield,
  Users,
  User,
  CreditCard,
  Zap,
  Info,
  Lock,
  Home,
  Repeat,
  Stethoscope,
} from 'lucide-react';
import { useFinance, CATEGORIES_BASE } from '../../context/FinanceContext';
import {
  ExpenseItem,
  FundingSourceType,
  TransactionBucket,
} from '../../types/finance';
import { formatCurrency } from '../../utils/formatters';
import { findMatchingShiftForCredit } from '../../utils/shiftsEngine';
import type {
  StagedCsvTransaction,
  TriageDestination,
} from '../../utils/statementImport';

const BUCKET_OPTIONS: Array<{
  key: TransactionBucket;
  label: string;
  hint: string;
}> = [
  { key: 'housing', label: 'Moradia', hint: 'Aluguel, condomínio, luz, internet' },
  { key: 'fixed_essential', label: 'Fixo Essencial', hint: 'Saúde, seguro, escola, tributos' },
  { key: 'fixed_cancelable', label: 'Fixo Cancelável', hint: 'Assinaturas, streaming, academia' },
  { key: 'groceries', label: 'Mercado', hint: 'Supermercado, hortifruti, açougue' },
  { key: 'routine', label: 'Rotina', hint: 'Transporte, farmácia, dia a dia' },
  { key: 'buffer', label: 'Imprevistos', hint: 'Reparos, oficina, emergências' },
];

interface TransactionTriageBottomSheetProps {
  isOpen: boolean;
  expense?: ExpenseItem | null;
  stagedTx?: StagedCsvTransaction | null;
  onConfirmedStaged?: (stagingId: string, destination: TriageDestination) => void;
  onClose: () => void;
}

export const TransactionTriageBottomSheet: React.FC<TransactionTriageBottomSheetProps> = ({
  isOpen,
  expense = null,
  stagedTx = null,
  onConfirmedStaged,
  onClose,
}) => {
  const {
    state,
    householdConfig,
    v23MedicalShifts,
    emergencyReserveExcessAmount,
    updateExpenseTriage,
    confirmCsvTriage,
    triggerCelebration,
  } = useFinance();

  // State for Protocolo B.4 CSV staged triage
  const [destination, setDestination] = useState<TriageDestination>('house_routine');
  const [selectedBucket, setSelectedBucket] = useState<TransactionBucket>('routine');
  const [sharedCategory, setSharedCategory] = useState<string>('lazer_casal');
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State for legacy ExpenseItem triage
  const [assignedTo, setAssignedTo] = useState<'couple' | 'partner1' | 'partner2'>('couple');
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'debit' | 'credit' | 'cash'>('pix');
  const [fundingSource, setFundingSource] = useState<FundingSourceType>('month_budget');
  const [selectedGoalId, setSelectedGoalId] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const p1Name = state.profile.partner1Name || 'Parceiro 1';
  const p2Name = state.profile.partner2Name || 'Parceiro 2';

  const activePiggyBanks = state.piggyBanks.filter(
    (g) => (!g.archived && !g.isDeleted) || g.id === expense?.fundingGoalId
  );

  const shiftMatchResult = useMemo(() => {
    if (!stagedTx || stagedTx.type !== 'income') {
      return { exactMatch: null, candidates: [] };
    }
    return findMatchingShiftForCredit(
      {
        amount: stagedTx.amount,
        description: stagedTx.description,
        date: stagedTx.date,
      },
      v23MedicalShifts
    );
  }, [stagedTx, v23MedicalShifts]);

  useEffect(() => {
    if (stagedTx) {
      setDestination(stagedTx.suggestedDestination);
      setSelectedBucket(stagedTx.suggestedBucket);
      setSharedCategory('lazer_casal');
      setSelectedShiftId(shiftMatchResult.candidates[0]?.shift.id || '');
      setErrorMsg('');
      return;
    }

    if (expense) {
      if (expense.assignedTo) {
        setAssignedTo(expense.assignedTo === 'casal' ? 'couple' : expense.assignedTo);
      } else if (expense.paidBy === 'partner1') {
        setAssignedTo('partner1');
      } else if (expense.paidBy === 'partner2') {
        setAssignedTo('partner2');
      } else {
        setAssignedTo('couple');
      }

      setPaymentMethod(expense.paymentMethod || (expense.installmentId ? 'credit' : 'pix'));
      setFundingSource(expense.fundingSource || 'month_budget');
      const availableGoals = state.piggyBanks.filter(
        (g) => (!g.archived && !g.isDeleted) || g.id === expense.fundingGoalId
      );
      setSelectedGoalId(expense.fundingGoalId || (availableGoals[0]?.id ?? ''));
      setErrorMsg('');
    }
  }, [stagedTx, expense, state.piggyBanks, shiftMatchResult.candidates]);

  if (!isOpen || (!expense && !stagedTx)) return null;

  // ===========================================================================
  // MODO 1: TRIAGEM CSV v2.3 (PROTOCOLO B.4 — 4 DESTINOS EXCLUSIVOS)
  // ===========================================================================
  if (stagedTx) {
    const maxSoloInstallment = householdConfig.allowanceFloor * 0.5;
    const soloInstallmentBlocked =
      destination === 'solo_allowance' &&
      Boolean(stagedTx.installment) &&
      stagedTx.amount > maxSoloInstallment;

    const handleConfirmStaged = async (overrideShiftId?: string) => {
      setErrorMsg('');
      setIsSubmitting(true);
      try {
        const finalDestination: TriageDestination = overrideShiftId
          ? 'internal'
          : destination;
        await confirmCsvTriage({
          staged: stagedTx,
          destination: finalDestination,
          bucket: finalDestination === 'house_routine' ? selectedBucket : undefined,
          sharedCategory:
            finalDestination === 'shared_allowance' ? sharedCategory : undefined,
          reconcileShiftId:
            finalDestination === 'internal'
              ? overrideShiftId || selectedShiftId || undefined
              : undefined,
        });
        triggerCelebration();
        onConfirmedStaged?.(stagedTx.stagingId, finalDestination);
        onClose();
      } catch (err: unknown) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Não foi possível confirmar o destino deste lançamento.'
        );
      } finally {
        setIsSubmitting(false);
      }
    };

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
        <div
          className="w-full max-w-lg bg-[#FAF7F2] dark:bg-[#121316] text-[#111318] dark:text-[#F8FAFC] rounded-t-[32px] sm:rounded-[32px] border border-stone-200/80 dark:border-stone-800 shadow-2xl p-6 sm:p-7 space-y-5 max-h-[92vh] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="triage-v23-title"
        >
          <div className="w-12 h-1.5 bg-stone-300 dark:bg-stone-700 rounded-full mx-auto sm:hidden" />

          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                Triagem Protocolo B.4 · {stagedTx.accountLabel}
              </p>
              <h2
                id="triage-v23-title"
                className="text-xl font-black font-display tracking-tight"
              >
                Classificar Lançamento do Extrato
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar triagem"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-stone-200/70 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 flex items-center justify-center text-stone-600 dark:text-stone-300 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Transaction Summary Card */}
          <div className="p-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-extrabold text-sm text-[#111318] dark:text-white truncate">
                  {stagedTx.description}
                </h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {stagedTx.date} · Ciclo {stagedTx.cycleId.replace('_', '/')}
                  {stagedTx.installment
                    ? ` · Parcela ${stagedTx.installment.currentInstallment}/${stagedTx.installment.totalInstallments}`
                    : ''}
                </p>
              </div>
              <span
                className={`text-base font-black tabular-nums shrink-0 ${
                  stagedTx.type === 'income'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-stone-900 dark:text-white'
                }`}
              >
                {stagedTx.type === 'income' ? '+' : '-'} {formatCurrency(stagedTx.amount)}
              </span>
            </div>

            {stagedTx.autoExcluded && (
              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 pt-1">
                Filtro automático sugeriu Interno ({stagedTx.exclusionLabel}).
              </p>
            )}
          </div>

          {/* 1-Click Medical Shift Credit Reconciliation */}
          {stagedTx.type === 'income' && shiftMatchResult.candidates.length > 0 && (
            <div className="p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/30 border border-teal-300 dark:border-teal-800 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-extrabold text-teal-900 dark:text-teal-200">
                <Stethoscope className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                <span>Plantão Médico a Receber Compatível Encontrado</span>
              </div>

              {shiftMatchResult.candidates.length > 1 && (
                <select
                  aria-label="Selecionar plantão para vincular"
                  value={selectedShiftId}
                  onChange={(e) => setSelectedShiftId(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-stone-900 border border-teal-300 dark:border-teal-700 text-xs font-semibold"
                >
                  {shiftMatchResult.candidates.map((cand) => (
                    <option key={cand.shift.id} value={cand.shift.id}>
                      {cand.shift.institution} · {cand.shift.shiftDate} ·{' '}
                      {formatCurrency(cand.shift.netAmount)} ({cand.reason})
                    </option>
                  ))}
                </select>
              )}

              {(() => {
                const chosen =
                  shiftMatchResult.candidates.find((c) => c.shift.id === selectedShiftId) ||
                  shiftMatchResult.candidates[0];
                if (!chosen?.shift.id) return null;
                return (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleConfirmStaged(chosen.shift.id)}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      Vincular ao Plantão {chosen.shift.institution} e marcar como Pago
                    </span>
                  </button>
                );
              })()}
            </div>
          )}

          {/* 4 Destinations Segmented Cards */}
          <div className="space-y-2">
            <label className="block text-xs font-black uppercase tracking-wider text-stone-600 dark:text-stone-400">
              Escolha o Destino (1 toque)
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* 1. Casa & Rotina */}
              <button
                type="button"
                onClick={() => setDestination('house_routine')}
                className={`min-h-[76px] p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                  destination === 'house_routine'
                    ? 'border-[#111318] dark:border-white bg-white dark:bg-stone-800 shadow-xs'
                    : 'border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-900/60'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="flex items-center gap-2 font-black text-xs">
                    <Home className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Casa &amp; Rotina
                  </span>
                  {destination === 'house_routine' && <Check className="w-4 h-4" />}
                </div>
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  Caixa único · entra nos 60% de estrutura
                </span>
              </button>

              {/* 2. Mesada — Só Minha */}
              <button
                type="button"
                onClick={() => setDestination('solo_allowance')}
                className={`min-h-[76px] p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                  destination === 'solo_allowance'
                    ? 'border-[#111318] dark:border-white bg-white dark:bg-stone-800 shadow-xs'
                    : 'border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-900/60'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="flex items-center gap-2 font-black text-xs">
                    <Lock className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    Mesada — Só Minha
                  </span>
                  {destination === 'solo_allowance' && <Check className="w-4 h-4" />}
                </div>
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  Privado — só você vê
                </span>
              </button>

              {/* 3. Mesada — Dos Dois */}
              <button
                type="button"
                onClick={() => setDestination('shared_allowance')}
                className={`min-h-[76px] p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                  destination === 'shared_allowance'
                    ? 'border-[#111318] dark:border-white bg-white dark:bg-stone-800 shadow-xs'
                    : 'border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-900/60'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="flex items-center gap-2 font-black text-xs">
                    <Users className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    Mesada — Dos Dois
                  </span>
                  {destination === 'shared_allowance' && <Check className="w-4 h-4" />}
                </div>
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  50/50 entre as mesadas
                </span>
              </button>

              {/* 4. Interno (Ignorar) */}
              <button
                type="button"
                onClick={() => setDestination('internal')}
                className={`min-h-[76px] p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                  destination === 'internal'
                    ? 'border-[#111318] dark:border-white bg-white dark:bg-stone-800 shadow-xs'
                    : 'border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-900/60'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="flex items-center gap-2 font-black text-xs">
                    <Repeat className="w-4 h-4 text-stone-500" />
                    Interno (Ignorar)
                  </span>
                  {destination === 'internal' && <Check className="w-4 h-4" />}
                </div>
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  Pix casal, fatura ou repasse
                </span>
              </button>
            </div>
          </div>

          {/* Sub-options based on chosen destination */}
          {destination === 'house_routine' && (
            <div className="space-y-2.5 p-3.5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
              <label className="block text-xs font-bold text-stone-700 dark:text-stone-300">
                Sub-balde da Estrutura (Casa &amp; Rotina)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {BUCKET_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSelectedBucket(opt.key)}
                    className={`min-h-[44px] p-2 rounded-xl border text-left transition-all cursor-pointer ${
                      selectedBucket === opt.key
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200 font-bold'
                        : 'border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300'
                    }`}
                  >
                    <span className="block text-xs">{opt.label}</span>
                  </button>
                ))}
              </div>
              {stagedTx.installment && (
                <p className="text-[11px] text-teal-700 dark:text-teal-300 font-semibold pt-1">
                  Parcelamento {stagedTx.installment.currentInstallment}/
                  {stagedTx.installment.totalInstallments} detectado: criará plano futuro de{' '}
                  {stagedTx.installment.draft.startCycleId.replace('_', '/')} até{' '}
                  {stagedTx.installment.draft.endCycleId.replace('_', '/')}.
                </p>
              )}
            </div>
          )}

          {destination === 'solo_allowance' && (
            <div className="p-3.5 rounded-2xl bg-violet-50/80 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 text-xs space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-violet-900 dark:text-violet-200">
                <Lock className="w-4 h-4 shrink-0" />
                <span>Blindagem Total (Zero-Surveillance)</span>
              </div>
              <p className="text-[11px] text-violet-800 dark:text-violet-300 leading-relaxed">
                Este lançamento é gravado exclusivamente na sua carteira individual e nunca aparece no extrato ou histórico do seu par.
              </p>
              {soloInstallmentBlocked && (
                <p className="text-[11px] font-bold text-rose-700 dark:text-rose-300 pt-1">
                  Atenção: parcela pessoal ({formatCurrency(stagedTx.amount)}) ultrapassa 50% do piso da mesada ({formatCurrency(maxSoloInstallment)}).
                </p>
              )}
            </div>
          )}

          {destination === 'shared_allowance' && (
            <div className="p-3.5 rounded-2xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-xs space-y-2">
              <div className="flex items-center justify-between font-bold text-sky-900 dark:text-sky-200">
                <span>Divisão igualitária 50/50 entre as mesadas</span>
                <span className="tabular-nums">
                  {formatCurrency(stagedTx.amount / 2)} cada
                </span>
              </div>
              <input
                type="text"
                aria-label="Categoria do programa a dois"
                value={sharedCategory}
                onChange={(e) => setSharedCategory(e.target.value)}
                placeholder="Ex: jantar, cinema, viagem_curta"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-sky-200 dark:border-sky-800 text-xs"
              />
            </div>
          )}

          {errorMsg && (
            <p
              role="alert"
              className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-800 dark:text-rose-200"
            >
              {errorMsg}
            </p>
          )}

          {/* Footer actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-stone-200/80 dark:border-stone-800">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 py-2.5 rounded-2xl text-xs font-bold text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting || soloInstallmentBlocked}
              onClick={() => void handleConfirmStaged()}
              className="min-h-[44px] px-6 py-2.5 rounded-2xl bg-[#111318] hover:bg-black text-white dark:bg-white dark:hover:bg-stone-100 dark:text-[#111318] text-xs font-black tracking-wide shadow-md transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              Confirmar Destino
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // MODO 2: LEGACY EXPENSE ITEM TRIAGE (COMPATIBILIDADE TransactionHistoryScreen)
  // ===========================================================================
  const safeExpense = expense!;
  const catInfo = CATEGORIES_BASE[safeExpense.category];
  const selectedGoal = activePiggyBanks.find((g) => g.id === selectedGoalId);

  const handleSave = () => {
    const isExcluded = fundingSource !== 'month_budget';
    try {
      setErrorMsg('');
      updateExpenseTriage(safeExpense.id, {
        assignedTo,
        paymentMethod,
        fundingSource,
        fundingGoalId: fundingSource === 'piggy_bank' ? selectedGoalId : undefined,
        fundingGoalName: fundingSource === 'piggy_bank' ? selectedGoal?.name : undefined,
        isExcludedFromMonthlyBudget: isExcluded,
      });
      triggerCelebration();
      onClose();
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Não foi possível confirmar a triagem desta despesa.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-[#FAF7F2] dark:bg-[#121316] text-[#111318] dark:text-[#F8FAFC] rounded-t-[32px] sm:rounded-[32px] border border-stone-200/80 dark:border-stone-800 shadow-2xl p-6 sm:p-7 space-y-6 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="triage-title"
      >
        <div className="space-y-3">
          <div className="w-12 h-1.5 bg-stone-300 dark:bg-stone-700 rounded-full mx-auto sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                Triagem Inteligente
              </p>
              <h2 id="triage-title" className="text-xl sm:text-2xl font-black font-display tracking-tight">
                Origem &amp; Fonte do Gasto
              </h2>
            </div>
            <button
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] rounded-xl bg-stone-200/70 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 flex items-center justify-center text-stone-600 dark:text-stone-300 transition-colors cursor-pointer shrink-0"
              aria-label="Fechar triagem"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-3.5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800/80 flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-[#F8F4EC] dark:bg-stone-800 flex items-center justify-center text-2xl shrink-0 shadow-inner">
                {catInfo?.emoji || '🏷️'}
              </div>
              <div className="min-w-0">
                <h3 className="font-extrabold text-sm text-[#111318] dark:text-white truncate">
                  {safeExpense.description}
                </h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {catInfo?.name || 'Gasto'} · {safeExpense.date}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0 pl-2">
              <span className="text-base font-black text-rose-600 dark:text-rose-400 font-display tabular-nums">
                {formatCurrency(safeExpense.amount)}
              </span>
            </div>
          </div>
        </div>

        {/* Pergunta 1 */}
        <div className="space-y-2.5">
          <label className="text-xs font-black uppercase tracking-wider text-stone-600 dark:text-stone-400 flex items-center gap-1.5">
            <span>1. De quem é este gasto?</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setAssignedTo('couple')}
              className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between min-h-[78px] ${
                assignedTo === 'couple'
                  ? 'border-[#111318] dark:border-white bg-[#FAF7F2] dark:bg-stone-800/90 shadow-xs'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <Users className="w-4 h-4 text-stone-700 dark:text-stone-300" />
                {assignedTo === 'couple' && <Check className="w-4 h-4 text-[#111318] dark:text-white" />}
              </div>
              <div>
                <span className="block font-black text-xs text-[#111318] dark:text-white">
                  Casa / Casal
                </span>
                <span className="text-[10px] text-stone-500 dark:text-stone-400">
                  Caixa Único
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setAssignedTo('partner1')}
              className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between min-h-[78px] ${
                assignedTo === 'partner1'
                  ? 'border-[#111318] dark:border-white bg-[#FAF7F2] dark:bg-stone-800/90 shadow-xs'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <User className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                {assignedTo === 'partner1' && <Check className="w-4 h-4 text-[#111318] dark:text-white" />}
              </div>
              <div>
                <span className="block font-black text-xs text-[#111318] dark:text-white truncate">
                  {p1Name}
                </span>
                <span className="text-[10px] text-stone-500 dark:text-stone-400">
                  Mesada Individual
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setAssignedTo('partner2')}
              className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between min-h-[78px] ${
                assignedTo === 'partner2'
                  ? 'border-[#111318] dark:border-white bg-[#FAF7F2] dark:bg-stone-800/90 shadow-xs'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <User className="w-4 h-4 text-rose-500 dark:text-rose-400" />
                {assignedTo === 'partner2' && <Check className="w-4 h-4 text-[#111318] dark:text-white" />}
              </div>
              <div>
                <span className="block font-black text-xs text-[#111318] dark:text-white truncate">
                  {p2Name}
                </span>
                <span className="text-[10px] text-stone-500 dark:text-stone-400">
                  Mesada Individual
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* Pergunta 2 */}
        <div className="space-y-2.5">
          <label className="text-xs font-black uppercase tracking-wider text-stone-600 dark:text-stone-400">
            2. Forma de Pagamento
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaymentMethod('pix')}
              className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer flex items-center gap-3 ${
                paymentMethod !== 'credit'
                  ? 'border-[#111318] dark:border-white bg-[#FAF7F2] dark:bg-stone-800 shadow-xs'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300'
              }`}
            >
              <div className="w-9 h-9 rounded-xl bg-[#B8E0B0] text-[#111318] flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <span className="block font-black text-xs text-[#111318] dark:text-white">
                  À Vista / PIX / Débito
                </span>
                <span className="text-[10px] text-stone-500 dark:text-stone-400">
                  Sai na hora da conta
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('credit')}
              className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer flex items-center gap-3 ${
                paymentMethod === 'credit'
                  ? 'border-[#111318] dark:border-white bg-[#FAF7F2] dark:bg-stone-800 shadow-xs'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300'
              }`}
            >
              <div className="w-9 h-9 rounded-xl bg-[#FFC875] text-[#111318] flex items-center justify-center shrink-0">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <span className="block font-black text-xs text-[#111318] dark:text-white">
                  Cartão de Crédito
                </span>
                <span className="text-[10px] text-stone-500 dark:text-stone-400">
                  Fatura / Parcelado
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* Pergunta 3 */}
        <div className="space-y-2.5">
          <label className="text-xs font-black uppercase tracking-wider text-stone-600 dark:text-stone-400">
            3. De onde sai o dinheiro deste gasto?
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setFundingSource('month_budget')}
              className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer space-y-1.5 ${
                fundingSource === 'month_budget'
                  ? 'border-[#111318] dark:border-white bg-[#FFF9ED] dark:bg-stone-800 shadow-xs'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-black text-xs text-[#111318] dark:text-white">
                  📅 Orçamento do Mês
                </span>
                {fundingSource === 'month_budget' && <Check className="w-4 h-4" />}
              </div>
              <p className="text-[11px] text-stone-600 dark:text-stone-400">
                Rotina diária da casa (moradia, comida, contas do mês).
              </p>
            </button>

            <button
              type="button"
              onClick={() => setFundingSource('reserve_excess')}
              className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer space-y-1.5 ${
                fundingSource === 'reserve_excess'
                  ? 'border-[#111318] dark:border-white bg-[#F0F8FF] dark:bg-sky-950/40 shadow-xs'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-black text-xs text-[#111318] dark:text-white">
                  🛡️ Excesso da Reserva
                </span>
                {fundingSource === 'reserve_excess' && <Check className="w-4 h-4" />}
              </div>
              <p className="text-[11px] text-stone-600 dark:text-stone-400 tabular-nums">
                Acima do piso sagrado ({formatCurrency(emergencyReserveExcessAmount)} livres).
              </p>
            </button>

            <button
              type="button"
              onClick={() => setFundingSource('piggy_bank')}
              className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer space-y-1.5 ${
                fundingSource === 'piggy_bank'
                  ? 'border-[#111318] dark:border-white bg-[#FFF0F7] dark:bg-pink-950/40 shadow-xs'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-black text-xs text-[#111318] dark:text-white">
                  🎯 Caixinha de Objetivo
                </span>
                {fundingSource === 'piggy_bank' && <Check className="w-4 h-4" />}
              </div>
              <p className="text-[11px] text-stone-600 dark:text-stone-400">
                Paga por cofrinho específico guardado previamente.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setFundingSource('personal_allowance')}
              className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer space-y-1.5 ${
                fundingSource === 'personal_allowance'
                  ? 'border-[#111318] dark:border-white bg-[#F6F2FF] dark:bg-purple-950/40 shadow-xs'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-black text-xs text-[#111318] dark:text-white">
                  💼 Mesada Individual
                </span>
                {fundingSource === 'personal_allowance' && <Check className="w-4 h-4" />}
              </div>
              <p className="text-[11px] text-stone-600 dark:text-stone-400">
                Não afeta o caixa único do casal nem o orçamento mensal.
              </p>
            </button>
          </div>

          {fundingSource === 'piggy_bank' && (
            <div className="p-3.5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 space-y-2">
              <label className="text-[11px] font-black uppercase tracking-wider text-stone-600 dark:text-stone-400">
                Escolha a Caixinha Pagadora:
              </label>
              {activePiggyBanks.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Nenhuma caixinha ativa cadastrada ainda.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activePiggyBanks.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        setSelectedGoalId(g.id);
                        if (errorMsg) setErrorMsg('');
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                        selectedGoalId === g.id
                          ? 'border-[#111318] dark:border-white bg-[#FAF7F2] dark:bg-stone-800 font-bold'
                          : 'border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span>{g.emoji}</span>
                        <div className="min-w-0">
                          <span className="text-xs truncate block">{g.name}</span>
                          <span className="text-[10px] text-stone-500 tabular-nums">
                            Saldo: {formatCurrency(g.currentAmount)}
                          </span>
                        </div>
                      </div>
                      {selectedGoalId === g.id && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Impact Banner */}
        <div
          className={`p-4 rounded-2xl border text-xs space-y-1 ${
            fundingSource !== 'month_budget'
              ? 'bg-[#F3FAF1] dark:bg-emerald-950/40 border-[#B8E0B0] dark:border-emerald-700/60 text-emerald-900 dark:text-emerald-200'
              : 'bg-stone-100 dark:bg-stone-900 border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300'
          }`}
        >
          <div className="flex items-center gap-2 font-black">
            {fundingSource !== 'month_budget' ? (
              <>
                <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Blindagem Orçamentária Ativada</span>
              </>
            ) : (
              <>
                <Info className="w-4 h-4 text-stone-500" />
                <span>Alocação no Orçamento da Rotina</span>
              </>
            )}
          </div>
          <p className="text-[11px] leading-relaxed">
            {fundingSource === 'reserve_excess'
              ? `Este gasto de ${formatCurrency(safeExpense.amount)} sairá do Excesso da Reserva.`
              : fundingSource === 'piggy_bank'
              ? `O valor de ${formatCurrency(safeExpense.amount)} será debitado do cofrinho "${selectedGoal?.name || 'Objetivo'}".`
              : fundingSource === 'personal_allowance'
              ? `Gasto pessoal de ${assignedTo === 'partner1' ? p1Name : p2Name}. Não consome o teto compartilhado do casal.`
              : `Este gasto consumirá normalmente o saldo mensal de ${catInfo?.name}.`}
          </p>
        </div>

        {errorMsg && (
          <p
            role="alert"
            className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-800 dark:text-rose-200"
          >
            {errorMsg}
          </p>
        )}

        <div className="pt-2 flex items-center justify-end gap-3 border-t border-stone-200/80 dark:border-stone-800">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-3 rounded-2xl text-xs font-bold text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="min-h-[44px] px-6 py-3 rounded-2xl bg-[#111318] hover:bg-black text-white dark:bg-white dark:hover:bg-stone-100 dark:text-[#111318] text-xs font-black tracking-wide shadow-md transition-all cursor-pointer flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Confirmar Triagem
          </button>
        </div>
      </div>
    </div>
  );
};
