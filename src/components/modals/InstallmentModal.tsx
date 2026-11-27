import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Lock, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { useFinance } from '../../context/FinanceContext';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { TransactionBucket } from '../../types/finance';
import { formatCurrency, formatMonthYear } from '../../utils/formatters';
import { cycleIdToMonthKey, TRANSACTION_BUCKET_META } from '../../utils/v23Helpers';

interface InstallmentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const HOUSE_BUCKETS: TransactionBucket[] = [
  'routine',
  'housing',
  'groceries',
  'fixed_essential',
  'fixed_cancelable',
  'buffer',
];

export const InstallmentModal: React.FC<InstallmentModalProps> = ({ isOpen, onClose }) => {
  const {
    state,
    householdConfig,
    simulateInstallment,
    addCascadeTransaction,
    triggerCelebration,
  } = useFinance();

  const [scope, setScope] = useState<'house' | 'solo_allowance'>('house');
  const [bucket, setBucket] = useState<TransactionBucket>('routine');
  const [title, setTitle] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [installmentsCount, setInstallmentsCount] = useState(6);
  const [purchaseDate, setPurchaseDate] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);
  const [successCelebration, setSuccessCelebration] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const dialogRef = useDialogFocus(isOpen, onClose);

  const parsedTotal = parseFloat(totalAmount.replace(',', '.')) || 0;
  const simulation = useMemo(
    () =>
      simulateInstallment({
        purchaseAmount: parsedTotal,
        installmentsCount,
        scope,
      }),
    [parsedTotal, installmentsCount, scope, simulateInstallment]
  );

  if (!isOpen) return null;

  const resetAndClose = () => {
    setErrorMsg('');
    setTitle('');
    setTotalAmount('');
    setInstallmentsCount(6);
    setScope('house');
    setBucket('routine');
    setSuccessCelebration(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!title.trim()) {
      setErrorMsg('Informe o nome da compra parcelada.');
      return;
    }
    if (parsedTotal <= 0) {
      setErrorMsg('Informe um valor total maior que zero.');
      return;
    }
    if (simulation.verdict === 'blocked') {
      setErrorMsg(simulation.reason);
      return;
    }

    setSaving(true);
    try {
      await addCascadeTransaction({
        destination: scope === 'house' ? 'house_routine' : 'solo_allowance',
        title: title.trim(),
        amount: parsedTotal,
        date: purchaseDate || `${state.currentMonth}-10`,
        bucket: scope === 'house' ? bucket : undefined,
        installmentsCount,
      });
      setSuccessCelebration(true);
      triggerCelebration();
      setTimeout(() => {
        resetAndClose();
      }, 1100);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível registrar o parcelamento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Registrar parcelamento"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="absolute inset-0" onClick={resetAndClose} />

      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh] text-slate-900 dark:text-white">
        <div className="flex items-center justify-between px-5 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h3 className="font-extrabold text-slate-900 dark:text-white text-base font-display">
              Nova Compra Parcelada
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Simulação automática pela trava 10%–20% (Renda 3M) ou piso da mesada
            </p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="w-10 h-10 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {successCelebration ? (
            <div className="py-10 flex flex-col items-center justify-center text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                <Check className="w-7 h-7 stroke-[3]" />
              </div>
              <h4 className="text-xl font-extrabold font-display">Parcelamento Registrado</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {title}: {installmentsCount}x de {formatCurrency(simulation.monthlyInstallment)} · Quitação em{' '}
                {formatMonthYear(cycleIdToMonthKey(simulation.payoffCycleId))}
              </p>
            </div>
          ) : (
            <>
              {errorMsg && (
                <div
                  role="alert"
                  className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs font-bold flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Escopo */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScope('house')}
                  className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    scope === 'house'
                      ? 'border-slate-900 dark:border-white bg-slate-50 dark:bg-slate-800'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-extrabold">
                    <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Caixa Único (Casa)</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Trava de 10% a 20% da Renda 3M
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setScope('solo_allowance')}
                  className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    scope === 'solo_allowance'
                      ? 'border-violet-600 bg-violet-50/70 dark:bg-violet-950/40'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-extrabold">
                    <Lock className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    <span>Mesada — Só Minha</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                    Privada · até {formatCurrency(householdConfig.allowanceFloor * 0.5)}/mês
                  </p>
                </button>
              </div>

              {/* Descrição & Valor */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Descrição da compra
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: Geladeira Inverter, Passagens, Estetoscópio"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold focus:outline-none focus:border-slate-900 dark:focus:border-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Valor Total (R$)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={totalAmount}
                      onChange={(e) => setTotalAmount(e.target.value)}
                      placeholder="0,00"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-extrabold tabular-nums focus:outline-none focus:border-slate-900 dark:focus:border-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Data da Compra
                    </label>
                    <input
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Parcelas */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Número de parcelas
                  </label>
                  <span className="text-xs font-extrabold tabular-nums text-slate-900 dark:text-white">
                    {installmentsCount}x de {formatCurrency(simulation.monthlyInstallment)}
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {[2, 3, 4, 6, 10, 12].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setInstallmentsCount(count)}
                      className={`py-2 rounded-xl text-xs font-extrabold border transition-colors cursor-pointer ${
                        installmentsCount === count
                          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {count}x
                    </button>
                  ))}
                </div>
              </div>

              {scope === 'house' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                    Sub-envelope da Estrutura
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {HOUSE_BUCKETS.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBucket(b)}
                        className={`px-2.5 py-2 rounded-xl text-[11px] font-bold border text-left transition-colors cursor-pointer ${
                          bucket === b
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-900 dark:text-emerald-200'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {TRANSACTION_BUCKET_META[b].shortLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Guard Result */}
              {parsedTotal > 0 && (
                <div
                  className={`p-3.5 rounded-2xl border text-xs space-y-1 ${
                    simulation.verdict === 'blocked'
                      ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                      : simulation.verdict === 'caution'
                      ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                      : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  }`}
                >
                  <div className="flex items-center justify-between font-extrabold">
                    <span className="flex items-center gap-1.5">
                      {simulation.verdict === 'blocked' ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                      {simulation.verdict === 'blocked'
                        ? 'Parcelamento Bloqueado pela Trava'
                        : simulation.verdict === 'caution'
                        ? 'Zona de Atenção'
                        : 'Aprovado na Trava'}
                    </span>
                    <span className="tabular-nums">
                      {(simulation.projectedInstallmentRatio * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{simulation.reason}</p>
                  {scope === 'house' && simulation.allowanceReductionPerPartner > 0 && (
                    <p className="text-[11px] font-bold tabular-nums">
                      Impacto na mesada de cada um: -{formatCurrency(simulation.allowanceReductionPerPartner)}/mês · Quitação em{' '}
                      {formatMonthYear(cycleIdToMonthKey(simulation.payoffCycleId))}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || parsedTotal <= 0 || !title.trim() || simulation.verdict === 'blocked'}
                  className="btn-primary-accent flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{saving ? 'Registrando...' : 'Confirmar Parcelamento'}</span>
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
