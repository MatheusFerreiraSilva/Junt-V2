import React, { useState, useMemo, useRef } from 'react';
import {
  X,
  UploadCloud,
  FileText,
  Check,
  AlertCircle,
  RefreshCw,
  CreditCard,
  Landmark,
  SlidersHorizontal,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  decodeStatementBytes,
  detectInternalTransferPairs,
  findReconciliationCandidates,
  isOfxContent,
  parseCsvStatementV23,
  parseStatement,
  type CsvStatementParseResult,
  type StagedCsvTransaction,
  type StatementBankPreset,
  type StatementMode,
  type TriageDestination,
} from '../utils/statementImport';
import { formatCurrency } from '../utils/formatters';
import { TransactionTriageBottomSheet } from './modals/TransactionTriageBottomSheet';

interface BankSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_OPTIONS: Array<{ value: StatementBankPreset; label: string }> = [
  { value: 'auto', label: 'Detectar automaticamente' },
  { value: 'nubank_conta', label: 'Nubank Conta' },
  { value: 'nubank_cartao', label: 'Nubank Cartão' },
  { value: 'itau', label: 'Itaú' },
  { value: 'inter', label: 'Banco Inter' },
  { value: 'btg', label: 'BTG Pactual' },
  { value: 'bradesco', label: 'Bradesco' },
  { value: 'santander', label: 'Santander' },
  { value: 'generic', label: 'Outro Banco / Genérico' },
];

const DESTINATION_LABELS: Record<TriageDestination, string> = {
  house_routine: 'Casa & Rotina',
  solo_allowance: 'Mesada — Só Minha',
  shared_allowance: 'Mesada — Dos Dois',
  internal: 'Interno',
};

export const BankSyncModal: React.FC<BankSyncModalProps> = ({ isOpen, onClose }) => {
  const {
    state,
    currentUser,
    householdConfig,
    v23ExistingHashes,
    importStatement,
    confirmCsvTriage,
    updatePushSettings,
    triggerCelebration,
    verifiableCashSummary,
    setCashBalanceAnchor,
    linkCanonicalAccount,
    reconcileBankTransactionWithOperation,
    confirmInternalTransferPair,
  } = useFinance();

  const [statementMode, setStatementMode] = useState<StatementMode>('checking');
  const [preset, setPreset] = useState<StatementBankPreset>('auto');
  const [accountLabel, setAccountLabel] = useState<string>('Nubank');
  const [stagedResult, setStagedResult] = useState<CsvStatementParseResult | null>(null);
  const [confirmedIds, setConfirmedIds] = useState<Record<string, TriageDestination>>({});
  const [activeTriageItem, setActiveTriageItem] = useState<StagedCsvTransaction | null>(null);
  const [anchorBalanceInputs, setAnchorBalanceInputs] = useState<Record<string, string>>({});
  const [anchorCutoffInputs, setAnchorCutoffInputs] = useState<Record<string, string>>({});
  const [selectedReconcileOps, setSelectedReconcileOps] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus(isOpen, onClose);

  const internalTransferPairs = useMemo(
    () =>
      detectInternalTransferPairs(
        state.bankImportedTransactions || [],
        state.linkedAccounts || []
      ),
    [state.bankImportedTransactions, state.linkedAccounts]
  );

  const pendingLegacyTransactions = useMemo(
    () => (state.bankImportedTransactions || []).filter((t) => t.status === 'pending'),
    [state.bankImportedTransactions]
  );

  const checkingAccountsForAnchor = useMemo(
    () =>
      verifiableCashSummary.accounts
        .filter(
          (a) =>
            (a.accountType === 'corrente' || a.accountType === 'poupanca') &&
            a.status !== 'excluded_credit' &&
            a.status !== 'excluded_locked'
        )
        .map((a) => ({
          id: a.sourceAccountIds[0] || a.canonicalAccountId,
          canonicalAccountId: a.canonicalAccountId,
          bankName: a.bankName,
          accountType: a.accountType,
          balance: a.effectiveLiquidCents !== null ? a.effectiveLiquidCents / 100 : 0,
          verificationStatus: a.status === 'known' ? 'verified' : 'unverified',
        })),
    [verifiableCashSummary.accounts]
  );

  if (!isOpen) return null;

  const handleFileProcess = async (file?: File) => {
    setError('');
    setStatusMessage('');
    if (!file) return;

    if (file.size > 8_000_000) {
      setError('O arquivo excede o limite de 8 MB.');
      return;
    }

    setIsProcessing(true);
    try {
      const buffer = await file.arrayBuffer();
      const decodedText = decodeStatementBytes(buffer);

      // Suporte opcional a OFX legado mantendo fluxo 100% local
      if (isOfxContent(decodedText)) {
        const ofxReport = await parseStatement(
          decodedText,
          accountLabel.trim() || 'Conta Bancária',
          'both',
          state.keywordRules
        );
        if (ofxReport.acceptedCount === 0) {
          throw new Error('Nenhum lançamento válido encontrado no arquivo OFX.');
        }
        importStatement(ofxReport.accepted);
        setStatusMessage(
          `${ofxReport.acceptedCount} lançamentos OFX lidos localmente. Revise os pendentes abaixo.`
        );
        return;
      }

      // ZERO escritas no Firestore durante staging: apenas parsing em memoria local!
      const parsed = await parseCsvStatementV23({
        textOrBytes: buffer,
        uid: currentUser?.uid || 'local-user',
        statementMode,
        preset,
        accountLabel: accountLabel.trim() || 'Extrato CSV',
        householdConfig,
        existingHashes: v23ExistingHashes,
      });

      if (parsed.staged.length === 0) {
        throw new Error('Nenhuma linha válida encontrada no CSV. Verifique o cabeçalho e o modo selecionado.');
      }

      setStagedResult(parsed);
      setConfirmedIds({});
      setStatusMessage(
        `${parsed.summary.stagedCount} linhas preparadas em memória (nenhum dado gravado antes da sua confirmação).`
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao ler o arquivo CSV. Confira o formato do banco.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const pendingStagedItems = (stagedResult?.staged || []).filter(
    (item) => !confirmedIds[item.stagingId]
  );

  const actionableNonDuplicates = pendingStagedItems.filter(
    (item) => !item.isDuplicate && item.suggestedDestination !== 'solo_allowance'
  );

  const handleConfirmBatchSuggested = async () => {
    if (actionableNonDuplicates.length === 0) return;
    setError('');
    setIsProcessing(true);
    try {
      const confirmedNow: Record<string, TriageDestination> = {};
      for (const item of actionableNonDuplicates) {
        await confirmCsvTriage({
          staged: item,
          destination: item.suggestedDestination,
          bucket: item.suggestedDestination === 'house_routine' ? item.suggestedBucket : undefined,
        });
        confirmedNow[item.stagingId] = item.suggestedDestination;
      }
      setConfirmedIds((prev) => ({ ...prev, ...confirmedNow }));
      triggerCelebration();
      setStatusMessage(
        `${Object.keys(confirmedNow).length} lançamentos novos confirmados e gravados.`
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Erro ao confirmar lançamentos sugeridos.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="statement-import-title"
        tabIndex={-1}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
      >
        <div className="absolute inset-0" onClick={onClose} />

        <div className="relative z-10 w-full max-w-2xl bg-[#FAF7F2] dark:bg-[#121316] rounded-3xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden flex flex-col max-h-[92vh] text-stone-900 dark:text-white transition-colors">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-stone-200 dark:border-stone-800 shrink-0">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </span>
              <div>
                <h2
                  id="statement-import-title"
                  className="text-base sm:text-lg font-black font-display"
                >
                  Importar Extrato Bancário (CSV Offline)
                </h2>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Processamento 100% no navegador · Zero envio para servidores externos
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] rounded-2xl bg-stone-200/70 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 flex items-center justify-center text-stone-600 dark:text-stone-300 transition-colors shrink-0 cursor-pointer"
              aria-label="Fechar"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="p-6 overflow-y-auto space-y-5 flex-1">
            {/* Mode Toggle: Conta Corrente vs Fatura Cartao */}
            <div className="p-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 space-y-3.5">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStatementMode('checking');
                    setStagedResult(null);
                  }}
                  className={`min-h-[44px] p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                    statementMode === 'checking'
                      ? 'bg-[#111318] dark:bg-white text-white dark:text-[#111318] border-[#111318] dark:border-white'
                      : 'bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700'
                  }`}
                >
                  <Landmark className="w-4 h-4 shrink-0" />
                  <span>Conta Corrente</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatementMode('credit_card');
                    setStagedResult(null);
                  }}
                  className={`min-h-[44px] p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                    statementMode === 'credit_card'
                      ? 'bg-[#111318] dark:bg-white text-white dark:text-[#111318] border-[#111318] dark:border-white'
                      : 'bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700'
                  }`}
                >
                  <CreditCard className="w-4 h-4 shrink-0" />
                  <span>Fatura Cartão</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-stone-500 block mb-1">
                    Banco / Formato CSV
                  </label>
                  <select
                    aria-label="Formato do banco CSV"
                    value={preset}
                    onChange={(e) => {
                      setPreset(e.target.value as StatementBankPreset);
                      setStagedResult(null);
                    }}
                    className="w-full min-h-[44px] px-3 py-2 text-xs font-bold border border-stone-200 dark:border-stone-700 rounded-xl bg-white dark:bg-stone-900"
                  >
                    {PRESET_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-stone-500 block mb-1">
                    Nome da Conta / Cartão
                  </label>
                  <input
                    type="text"
                    value={accountLabel}
                    onChange={(e) => setAccountLabel(e.target.value)}
                    placeholder="Ex: Nubank Ultravioleta, Itaú"
                    className="w-full min-h-[44px] px-3 py-2 text-xs font-bold border border-stone-200 dark:border-stone-700 rounded-xl bg-white dark:bg-stone-900"
                  />
                </div>
              </div>

              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                {statementMode === 'credit_card'
                  ? 'Modo Fatura: valores positivos entram como despesa e negativos como estorno/crédito.'
                  : 'Modo Conta Corrente: valores negativos entram como saída e positivos como entrada.'}
              </p>
            </div>

            {/* Drag & Drop Upload Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFileProcess(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`p-6 rounded-3xl border-2 border-dashed text-center transition-all cursor-pointer ${
                isDragOver
                  ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40'
                  : 'border-stone-300 dark:border-stone-700 hover:border-emerald-500 bg-white dark:bg-stone-900/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.ofx,text/csv,text/plain"
                className="hidden"
                onChange={(e) => void handleFileProcess(e.target.files?.[0])}
              />

              <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mx-auto mb-2.5">
                <UploadCloud className="w-6 h-6" />
              </div>

              <h3 className="text-sm font-extrabold">
                Arraste seu extrato CSV aqui ou toque para escolher
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                Nubank · Itaú · Inter · BTG Pactual · Bradesco · Santander (UTF-8 ou ISO-8859-1)
              </p>
            </div>

            {isProcessing && (
              <div className="p-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 text-xs font-bold flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                <span>Processando extrato localmente...</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs font-bold flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {statusMessage && (
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs font-bold flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 stroke-[3] shrink-0" />
                <span>{statusMessage}</span>
              </div>
            )}

            {/* STAGED CSV TRIAGE LIST */}
            {stagedResult && (
              <section className="space-y-3 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-stone-200 dark:border-stone-800">
                  <div>
                    <h3 className="font-extrabold text-sm">
                      Prévia para Triagem ({pendingStagedItems.length} pendentes)
                    </h3>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
                      {stagedResult.summary.stagedCount} lidos ·{' '}
                      {stagedResult.summary.duplicateCount} duplicados ·{' '}
                      {stagedResult.summary.autoExcludedCount} auto-filtrados ·{' '}
                      {stagedResult.summary.installmentsDetectedCount} parcelas XX/YY
                    </p>
                  </div>

                  {actionableNonDuplicates.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleConfirmBatchSuggested()}
                      disabled={isProcessing}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>Confirmar Novos Sugeridos ({actionableNonDuplicates.length})</span>
                    </button>
                  )}
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {stagedResult.staged.map((item) => {
                    const confirmedDest = confirmedIds[item.stagingId];
                    return (
                      <div
                        key={item.stagingId}
                        className={`p-3 rounded-2xl border text-xs flex items-center justify-between gap-3 ${
                          confirmedDest
                            ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 opacity-75'
                            : item.isDuplicate
                              ? 'bg-stone-100 dark:bg-stone-800/40 border-stone-200 dark:border-stone-800 opacity-65'
                              : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800'
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-stone-400 shrink-0">
                              {item.date}
                            </span>
                            <span className="font-bold truncate">{item.description}</span>
                          </div>
                          <p className="text-[11px] text-stone-500 dark:text-stone-400">
                            {confirmedDest
                              ? `Confirmado em ${DESTINATION_LABELS[confirmedDest]}`
                              : item.isDuplicate
                                ? 'Já importado (duplicado detectado)'
                                : item.autoExcluded
                                  ? `Sugestão: Interno · ${item.exclusionLabel}`
                                  : `Sugestão: ${DESTINATION_LABELS[item.suggestedDestination]}${
                                      item.installment
                                        ? ` · Parcela ${item.installment.currentInstallment}/${item.installment.totalInstallments}`
                                        : ''
                                    }`}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`font-black tabular-nums ${
                              item.type === 'income'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-stone-900 dark:text-white'
                            }`}
                          >
                            {item.type === 'income' ? '+' : '-'} {formatCurrency(item.amount)}
                          </span>

                          {!confirmedDest && !item.isDuplicate && (
                            <button
                              type="button"
                              onClick={() => setActiveTriageItem(item)}
                              className="min-h-[44px] px-3 py-1.5 rounded-xl bg-stone-900 dark:bg-white text-white dark:text-stone-900 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                            >
                              <SlidersHorizontal className="w-3 h-3" />
                              <span>Triar</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 26B: VERIFICAÇÃO DE SALDO E DUPLICIDADES DE CONTA (CONDICIONAL) */}
            {(verifiableCashSummary.duplicateAccountAlerts.length > 0 ||
              checkingAccountsForAnchor.length > 0) && (
              <section className="space-y-3 pt-4 border-t border-stone-200 dark:border-stone-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-extrabold text-sm">
                    Verificação de Caixa &amp; Contas Canônicas
                  </h3>
                  <span className="text-[11px] font-bold text-stone-500">
                    {verifiableCashSummary.status === 'unknown'
                      ? 'Caixa livre não verificável'
                      : verifiableCashSummary.status === 'partial'
                        ? `Parcial: ${formatCurrency(verifiableCashSummary.knownAccountsCashCents / 100)}`
                        : `Verificado: ${formatCurrency(verifiableCashSummary.verifiedLiquidCashR$ ?? 0)}`}
                  </span>
                </div>

                {verifiableCashSummary.duplicateAccountAlerts.map((dup, idx) => (
                  <div
                    key={`${dup.bankName}-${idx}`}
                    className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-bold text-amber-900 dark:text-amber-200">
                        Possível duplicidade: {dup.bankName}
                      </div>
                      <div className="text-[11px] text-amber-800 dark:text-amber-300">
                        {dup.reason}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const canonical = `canon-${dup.accountIds[0]}`;
                        dup.accountIds.forEach((id) => linkCanonicalAccount(id, canonical));
                        setStatusMessage(
                          `Contas espelhadas de ${dup.bankName} vinculadas sob ID canônico.`
                        );
                      }}
                      className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] cursor-pointer"
                    >
                      Vincular conta canônica
                    </button>
                  </div>
                ))}

                {checkingAccountsForAnchor.map((acc) => {
                  const defaultBal = anchorBalanceInputs[acc.id] ?? String(acc.balance ?? 0);
                  const defaultCutoff =
                    anchorCutoffInputs[acc.id] ?? new Date().toISOString().slice(0, 10);
                  return (
                    <div
                      key={acc.id}
                      className="p-3 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold">
                          {acc.bankName} ({acc.accountType})
                        </span>
                        <span className="text-[10px] font-bold text-stone-500">
                          Status: {acc.verificationStatus === 'unverified' ? 'Desconhecido' : 'Verificado'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          aria-label={`Saldo confirmado de ${acc.bankName}`}
                          value={defaultBal}
                          onChange={(e) =>
                            setAnchorBalanceInputs({
                              ...anchorBalanceInputs,
                              [acc.id]: e.target.value,
                            })
                          }
                          className="w-28 px-2.5 py-1.5 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 font-bold text-xs tabular-nums"
                        />
                        <input
                          type="date"
                          aria-label={`Data de corte de ${acc.bankName}`}
                          value={defaultCutoff}
                          onChange={(e) =>
                            setAnchorCutoffInputs({
                              ...anchorCutoffInputs,
                              [acc.id]: e.target.value,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 font-bold text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const parsed = parseFloat(defaultBal.replace(',', '.'));
                            if (!Number.isFinite(parsed)) return;
                            setCashBalanceAnchor({
                              accountId: acc.canonicalAccountId || acc.id,
                              status: 'known',
                              confirmedBalanceR$: parsed,
                              cutoffDate: defaultCutoff,
                            });
                            setStatusMessage(
                              `Saldo de ${acc.bankName} confirmado em ${formatCurrency(parsed)}.`
                            );
                          }}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer"
                        >
                          Confirmar saldo
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCashBalanceAnchor({
                              accountId: acc.canonicalAccountId || acc.id,
                              status: 'unknown',
                              cutoffDate: defaultCutoff,
                            });
                            setStatusMessage(
                              `Saldo de ${acc.bankName} marcado como desconhecido.`
                            );
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-stone-200 hover:bg-stone-300 dark:bg-stone-700 dark:hover:bg-stone-600 text-stone-800 dark:text-stone-200 font-bold text-[11px] cursor-pointer"
                        >
                          Marcar desconhecido
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {/* 26B: PARES CANDIDATOS DE TRANSFERÊNCIA INTERNA (CONDICIONAL) */}
            {internalTransferPairs.length > 0 && (
              <section className="space-y-2.5 pt-4 border-t border-stone-200 dark:border-stone-800">
                <h3 className="font-extrabold text-sm">
                  Transferências Internas Detectadas ({internalTransferPairs.length})
                </h3>
                {internalTransferPairs.map((pair) => (
                  <div
                    key={`${pair.debitTx.id}-${pair.creditTx.id}`}
                    className="p-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-bold">
                        {pair.debitTx.description} ↔ {pair.creditTx.description} (
                        {formatCurrency(pair.amountCents / 100)})
                      </div>
                      <div className="text-[11px] text-stone-600 dark:text-stone-400">
                        {pair.reason}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        confirmInternalTransferPair(pair.debitTx.id, pair.creditTx.id);
                        setStatusMessage(
                          'Par de transferência interna confirmado (impacto zero em gastos/renda).'
                        );
                      }}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] cursor-pointer"
                    >
                      Confirmar Transferência Interna
                    </button>
                  </div>
                ))}
              </section>
            )}

            {/* 26B: CONCILIAÇÃO DE CRÉDITOS LEGADOS COM RESGATE */}
            {pendingLegacyTransactions.some((t) => t.direction === 'credit') && (
              <section className="space-y-2 pt-4 border-t border-stone-200 dark:border-stone-800">
                {pendingLegacyTransactions
                  .filter((t) => t.direction === 'credit')
                  .map((t) => {
                    const reconciliationMatch = findReconciliationCandidates(
                      t,
                      state.financialOperations || [],
                      state.linkedAccounts || []
                    );
                    if (reconciliationMatch.candidates.length === 0) return null;
                    const chosenOpId =
                      selectedReconcileOps[t.id] ||
                      reconciliationMatch.candidates[0]?.operation.id ||
                      '';
                    return (
                      <div
                        key={t.id}
                        className="p-2.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 space-y-1.5 text-xs"
                      >
                        <div className="font-bold text-indigo-900 dark:text-indigo-200 flex items-center justify-between gap-2">
                          <span>
                            Resgate compatível: {t.description} ({formatCurrency(t.amount)})
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`Selecionar resgate para conciliar ${t.description}`}
                            value={chosenOpId}
                            onChange={(e) =>
                              setSelectedReconcileOps({
                                ...selectedReconcileOps,
                                [t.id]: e.target.value,
                              })
                            }
                            className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded-xl bg-white dark:bg-stone-900 border border-indigo-200 dark:border-indigo-700 text-xs font-bold"
                          >
                            {reconciliationMatch.candidates.map((cand) => (
                              <option key={cand.operation.id} value={cand.operation.id}>
                                {cand.operation.sourceRef?.name || cand.operation.id} ({cand.reason})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              if (!chosenOpId) return;
                              try {
                                setError('');
                                reconcileBankTransactionWithOperation(t.id, chosenOpId);
                                setStatusMessage(
                                  'Crédito conciliado com o resgate sem gerar renda fictícia.'
                                );
                              } catch (err: unknown) {
                                setError(
                                  err instanceof Error
                                    ? err.message
                                    : 'Não foi possível conciliar este crédito com o resgate.'
                                );
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs cursor-pointer"
                          >
                            Conciliar com resgate
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </section>
            )}

            {/* Statement Daily Push Reminder Toggle */}
            <div className="p-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <label
                  htmlFor="reminder-check"
                  className="text-xs font-extrabold cursor-pointer block"
                >
                  Lembretes diários de conferência de extratos
                </label>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Lembrete ao almoço (13h) e fechamento do dia (18h) para importar CSVs.
                </p>
              </div>
              <input
                id="reminder-check"
                type="checkbox"
                checked={!!state.pushSettings?.statementReminderEnabled}
                onChange={(e) =>
                  updatePushSettings({ statementReminderEnabled: e.target.checked })
                }
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-4 bg-white dark:bg-stone-900 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between text-xs text-stone-500">
            <span>Importação 100% offline e privada no dispositivo</span>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 font-bold transition-colors cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>

      {/* Sub-modal 1-toque Protocolo B.4 para item em staging */}
      <TransactionTriageBottomSheet
        isOpen={Boolean(activeTriageItem)}
        stagedTx={activeTriageItem}
        onConfirmedStaged={(stagingId, dest) => {
          setConfirmedIds((prev) => ({ ...prev, [stagingId]: dest }));
          setActiveTriageItem(null);
        }}
        onClose={() => setActiveTriageItem(null)}
      />
    </>
  );
};
