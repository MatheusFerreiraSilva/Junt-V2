import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Gift,
  HeartHandshake,
  Lock,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency, formatMonthYear } from '../utils/formatters';
import { MonthSelector } from '../components/MonthSelector';

type MesadaTab = 'shared' | 'solo';

export const CoupleHubScreen: React.FC = () => {
  const {
    state,
    currentUser,
    activeCycleId,
    activeWave,
    v23Preferences,
    waterfallResult,
    myAllowanceWallet,
    myAllowanceExpenses,
    v23SharedAllowanceExpenses,
    v23Goals,
    sendAllowanceBoost,
    sweepAllowanceToGoals,
    toggleAllowanceWave,
    addCascadeTransaction,
  } = useFinance();

  const [activeTab, setActiveTab] = useState<MesadaTab>('shared');

  // Sovereign Action Modals
  const [showBoostModal, setShowBoostModal] = useState(false);
  const [boostAmount, setBoostAmount] = useState('200');
  const [boostBusy, setBoostBusy] = useState(false);

  const [showSweepModal, setShowSweepModal] = useState(false);
  const [sweepGoalId, setSweepGoalId] = useState('');
  const [sweepAmount, setSweepAmount] = useState('250');
  const [sweepBusy, setSweepBusy] = useState(false);

  // Quick add inside Mesada
  const [showQuickAdd, setShowQuickAdd] = useState<'solo_allowance' | 'shared_allowance' | null>(null);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickAmount, setQuickAmount] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);

  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const myName = (
    currentUser?.displayName ||
    state.profile.partner1Name ||
    'Você'
  ).split(' ')[0];

  const partnerName =
    state.profile.partner2Name && state.profile.partner2Name !== 'Aguardando Par...'
      ? state.profile.partner2Name.split(' ')[0]
      : 'Seu Par';

  const sharedInCycle = useMemo(
    () => v23SharedAllowanceExpenses.filter((item) => item.cycleId === activeCycleId),
    [v23SharedAllowanceExpenses, activeCycleId]
  );

  const mySoloInCycle = useMemo(
    () => myAllowanceExpenses.filter((item) => item.cycleId === activeCycleId),
    [myAllowanceExpenses, activeCycleId]
  );

  const selectedGoalId = sweepGoalId || v23Goals[0]?.id || '';

  const handleSendBoost = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedbackMsg(null);
    const amount = parseFloat(boostAmount.replace(',', '.')) || 0;
    if (amount <= 0) {
      setErrorMsg('Informe um valor positivo para enviar o Turbo.');
      return;
    }
    setBoostBusy(true);
    try {
      await sendAllowanceBoost(amount);
      setShowBoostModal(false);
      setFeedbackMsg(`Turbo silencioso de ${formatCurrency(amount)} enviado para ${partnerName}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao enviar Turbo.');
    } finally {
      setBoostBusy(false);
    }
  };

  const handleSweepToGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedbackMsg(null);
    const amount = parseFloat(sweepAmount.replace(',', '.')) || 0;
    if (!selectedGoalId) {
      setErrorMsg('Escolha uma meta para ajudar.');
      return;
    }
    if (amount <= 0) {
      setErrorMsg('Informe um valor maior que zero.');
      return;
    }
    setSweepBusy(true);
    try {
      await sweepAllowanceToGoals(selectedGoalId, amount);
      setShowSweepModal(false);
      const goalTitle = v23Goals.find((g) => g.id === selectedGoalId)?.title || 'Meta do casal';
      setFeedbackMsg(
        `Aporte Extra de ${myName}: ${formatCurrency(amount)} enviado para ${goalTitle}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível transferir para a meta.');
    } finally {
      setSweepBusy(false);
    }
  };

  const handleQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showQuickAdd) return;
    setErrorMsg(null);
    const amount = parseFloat(quickAmount.replace(',', '.')) || 0;
    if (amount <= 0) {
      setErrorMsg('Informe um valor maior que zero.');
      return;
    }
    setQuickBusy(true);
    try {
      await addCascadeTransaction({
        destination: showQuickAdd,
        title:
          quickTitle.trim() ||
          (showQuickAdd === 'shared_allowance' ? 'Programa a dois' : 'Gasto pessoal'),
        amount,
        date: `${state.currentMonth}-10`,
      });
      setQuickTitle('');
      setQuickAmount('');
      setShowQuickAdd(null);
      setFeedbackMsg(
        showQuickAdd === 'shared_allowance'
          ? `Programa a dois registrado (${formatCurrency(amount / 2)} de cada mesada).`
          : 'Gasto registrado exclusivamente na sua carteira privada.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao lançar gasto.');
    } finally {
      setQuickBusy(false);
    }
  };

  const { allowance } = waterfallResult;

  return (
    <div className="space-y-6 pb-8">
      {/* Page Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 inline-flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            Privacidade Blindada · Carteira de {myName}
          </p>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
            Mesada Híbrida
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
            {formatMonthYear(state.currentMonth)} · Autonomia individual sem vigilância e encontros a dois 50/50.
          </p>
        </div>

        <MonthSelector />
      </header>

      {feedbackMsg && (
        <div
          role="status"
          className="clay-card p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2"
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {feedbackMsg}
          </span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="text-emerald-700 dark:text-emerald-300 p-1"
            aria-label="Dispensar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="clay-card p-3.5 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2"
        >
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} aria-label="Fechar erro">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* PRIVATE HEADER CARD (Strictly Own Balance Breakdown) */}
      <section className="clay-card bento-card-lavender p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-violet-900 dark:text-violet-200">
              <Wallet className="w-4 h-4" />
              <span>Saldo Privado Disponível</span>
              <span>·</span>
              <span>
                Onda {activeWave} de 2 ({activeWave === 1 ? 'Piso Garantido' : 'Cota Completa'})
              </span>
            </div>

            <p
              className={`mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums ${
                myAllowanceWallet.closingBalance >= 0
                  ? 'text-slate-900 dark:text-white'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {formatCurrency(myAllowanceWallet.closingBalance)}
            </p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Visível apenas para você ({myName}). O saldo e gastos livres de {partnerName} são privados.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleAllowanceWave()}
              className="btn-outline min-h-[44px] px-3.5 text-xs bg-white/80 dark:bg-slate-900/80"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {activeWave === 1
                ? `Liberar Onda 2 (+${formatCurrency(allowance.pendingWave2ComplementPerPartner)})`
                : `Voltar para Onda 1 (Dia ${v23Preferences.wave2Day})`}
            </button>
          </div>
        </div>

        {/* 6 Explicit Wallet Components */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-4 border-t border-violet-900/10 dark:border-white/10">
          <div className="rounded-2xl bg-white/80 dark:bg-slate-900/70 p-3">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-300 block">
              Rollover Anterior
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
              +{formatCurrency(myAllowanceWallet.rolloverFromPrevious)}
            </span>
          </div>

          <div className="rounded-2xl bg-white/80 dark:bg-slate-900/70 p-3">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-300 block">
              Alocação do Mês
            </span>
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
              +{formatCurrency(myAllowanceWallet.monthlyAllocation)}
            </span>
          </div>

          <div className="rounded-2xl bg-white/80 dark:bg-slate-900/70 p-3">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-300 block">
              Boosts Líquidos
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
              {myAllowanceWallet.boostsNet >= 0 ? '+' : ''}
              {formatCurrency(myAllowanceWallet.boostsNet)}
            </span>
          </div>

          <div className="rounded-2xl bg-white/80 dark:bg-slate-900/70 p-3">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-300 block">
              Só Meu
            </span>
            <span className="text-sm font-bold text-rose-700 dark:text-rose-300 tabular-nums">
              -{formatCurrency(myAllowanceWallet.soloSpent)}
            </span>
          </div>

          <div className="rounded-2xl bg-white/80 dark:bg-slate-900/70 p-3">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-300 block">
              Metade Dos Dois
            </span>
            <span className="text-sm font-bold text-rose-700 dark:text-rose-300 tabular-nums">
              -{formatCurrency(myAllowanceWallet.jointAllowanceShareSpent)}
            </span>
          </div>

          <div className="rounded-2xl bg-white/80 dark:bg-slate-900/70 p-3">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-300 block">
              Aporte em Metas
            </span>
            <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">
              -{formatCurrency(myAllowanceWallet.sweptToSharedGoals)}
            </span>
          </div>
        </div>
      </section>

      {/* 3 SOVEREIGN ACTIONS */}
      <section aria-label="Ações da mesada" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => {
            setErrorMsg(null);
            setShowBoostModal(true);
          }}
          className="clay-card bento-card-pink p-5 text-left flex flex-col justify-between gap-3 cursor-pointer hover:opacity-95"
        >
          <div className="w-10 h-10 rounded-2xl bg-rose-500/15 text-rose-700 dark:text-rose-300 flex items-center justify-center">
            <Gift className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Enviar Turbo para {partnerName}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              Presente silencioso da sua mesada, sem motivo obrigatório e sem criar dívida.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setErrorMsg(null);
            setShowSweepModal(true);
          }}
          className="clay-card bento-card-sage p-5 text-left flex flex-col justify-between gap-3 cursor-pointer hover:opacity-95"
        >
          <div className="w-10 h-10 rounded-2xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Ajudar nas Metas
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              Transfira saldo livre para uma meta do casal como Aporte Extra de {myName}.
            </p>
          </div>
        </button>

        <div className="clay-card p-5 flex flex-col justify-between gap-3">
          <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Rollover Automático
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 tabular-nums">
              O saldo de {formatCurrency(Math.max(0, myAllowanceWallet.closingBalance))} acumula
              automaticamente na sua carteira do próximo mês.
            </p>
          </div>
        </div>
      </section>

      {/* 2 CLEAN TABS: Programas a Dois vs Meus Gastos Livres */}
      <section className="clay-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Visões da Mesada"
            className="inline-flex p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'shared'}
              onClick={() => setActiveTab('shared')}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 ${
                activeTab === 'shared'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Users className="w-4 h-4" />
              Programas a Dois ({sharedInCycle.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'solo'}
              onClick={() => setActiveTab('solo')}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 ${
                activeTab === 'solo'
                  ? 'bg-violet-700 text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Lock className="w-4 h-4" />
              Meus Gastos Livres ({mySoloInCycle.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              setShowQuickAdd(activeTab === 'shared' ? 'shared_allowance' : 'solo_allowance')
            }
            className="btn-accent min-h-[44px] px-4 text-xs"
          >
            <Plus className="w-4 h-4" />
            {activeTab === 'shared' ? 'Novo Programa a Dois' : 'Novo Gasto Só Meu'}
          </button>
        </div>

        {/* Inline quick-add form */}
        {showQuickAdd && (
          <form
            onSubmit={(e) => void handleQuickSubmit(e)}
            className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
          >
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {showQuickAdd === 'shared_allowance'
                  ? 'Descrição (Programa a Dois — 50/50)'
                  : 'Descrição (Só Meu — Privado)'}
              </label>
              <input
                type="text"
                placeholder={
                  showQuickAdd === 'shared_allowance'
                    ? 'Ex: Jantar sexta, Cinema...'
                    : 'Ex: Presente, Café, Hobby...'
                }
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Valor (R$)
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="0,00"
                value={quickAmount}
                onChange={(e) => setQuickAmount(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={quickBusy}
                className="btn-accent flex-1 min-h-[44px] text-xs"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setShowQuickAdd(null)}
                className="btn-outline min-h-[44px] px-3 text-xs"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* TAB 1: Programas a Dois */}
        {activeTab === 'shared' && (
          <div className="space-y-3">
            {sharedInCycle.length === 0 ? (
              <div className="text-center py-10 text-sm text-slate-500 dark:text-slate-300">
                <HeartHandshake className="w-8 h-8 mx-auto mb-2 opacity-60" />
                Nenhum programa a dois registrado neste mês ainda.
              </div>
            ) : (
              sharedInCycle.map((item, idx) => (
                <div
                  key={item.id || `${item.date}-${idx}`}
                  className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-300">
                      {item.date} · {item.category}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white tabular-nums">
                      {formatCurrency(item.totalAmount)}
                    </p>
                    <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 tabular-nums">
                      Sua metade: {formatCurrency(item.splitPerPartner)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 2: Meus Gastos Livres (Strictly Private) */}
        {activeTab === 'solo' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 px-3.5 py-2.5 text-xs text-violet-900 dark:text-violet-200 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>Lista privada de {myName} — nunca exibida na conta de {partnerName}.</span>
            </div>

            {mySoloInCycle.length === 0 ? (
              <div className="text-center py-10 text-sm text-slate-500 dark:text-slate-300">
                Nenhum gasto pessoal registrado neste mês.
              </div>
            ) : (
              mySoloInCycle.map((item, idx) => (
                <div
                  key={item.id || `${item.date}-${idx}`}
                  className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-300">
                      {item.date}
                      {item.installmentInfo
                        ? ` · Parcela ${item.installmentInfo.currentInstallment}/${item.installmentInfo.totalInstallments}`
                        : ''}
                    </p>
                  </div>
                  <p className="text-sm font-extrabold text-violet-700 dark:text-violet-300 tabular-nums shrink-0">
                    {formatCurrency(item.amount)}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* MODAL: Enviar Turbo (Zero Reason / Zero Debt) */}
      {showBoostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="boost-modal-title"
            className="w-full max-w-md clay-card p-6 bg-white dark:bg-slate-900 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 id="boost-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                Enviar Turbo para {partnerName}
              </h2>
              <button
                type="button"
                onClick={() => setShowBoostModal(false)}
                aria-label="Fechar"
                className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Transferência silenciosa da sua mesada para a mesada de {partnerName}. Sem motivo, sem cobrança e sem registro de dívida.
            </p>

            <form onSubmit={(e) => void handleSendBoost(e)} className="space-y-4">
              <div>
                <label
                  htmlFor="boost-amount-input"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                >
                  Valor do Turbo (R$)
                </label>
                <input
                  id="boost-amount-input"
                  type="number"
                  step="0.01"
                  min="1"
                  value={boostAmount}
                  onChange={(e) => setBoostAmount(e.target.value)}
                  className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-lg font-bold tabular-nums"
                />
              </div>

              <div className="flex gap-2">
                {[100, 200, 500].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setBoostAmount(String(v))}
                    className="flex-1 min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold tabular-nums"
                  >
                    R$ {v}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowBoostModal(false)}
                  className="btn-outline min-h-[44px] px-4 text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={boostBusy}
                  className="btn-accent flex-1 min-h-[44px] text-xs"
                >
                  <Gift className="w-4 h-4" />
                  {boostBusy ? 'Enviando...' : 'Enviar Turbo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Ajudar nas Metas (Sweep) */}
      {showSweepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sweep-modal-title"
            className="w-full max-w-md clay-card p-6 bg-white dark:bg-slate-900 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 id="sweep-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                Ajudar nas Metas do Casal
              </h2>
              <button
                type="button"
                onClick={() => setShowSweepModal(false)}
                aria-label="Fechar"
                className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSweepToGoal(e)} className="space-y-4">
              <div>
                <label
                  htmlFor="sweep-goal-select"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                >
                  Meta de destino
                </label>
                <select
                  id="sweep-goal-select"
                  value={selectedGoalId}
                  onChange={(e) => setSweepGoalId(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium"
                >
                  {v23Goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title} ({formatCurrency(g.currentAmount)} / {formatCurrency(g.targetAmount)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="sweep-amount-input"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                >
                  Valor do aporte (disponível: {formatCurrency(Math.max(0, myAllowanceWallet.closingBalance))})
                </label>
                <input
                  id="sweep-amount-input"
                  type="number"
                  step="0.01"
                  min="1"
                  value={sweepAmount}
                  onChange={(e) => setSweepAmount(e.target.value)}
                  className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-lg font-bold tabular-nums"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowSweepModal(false)}
                  className="btn-outline min-h-[44px] px-4 text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={sweepBusy}
                  className="btn-accent flex-1 min-h-[44px] text-xs"
                >
                  <Target className="w-4 h-4" />
                  {sweepBusy ? 'Transferindo...' : `Registrar Aporte Extra de ${myName}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
