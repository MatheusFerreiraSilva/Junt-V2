import { AvatarSettings, MemberAvatar } from '../avatars/AvatarUI';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Users,
  AlertTriangle,
  RefreshCw,
  Save,
  Check,
  X,
  RotateCcw,
  Trash2,
  Palette,
  Tag,
  Bell,
  Copy,
  UploadCloud,
  Lock,
  Unlock,
  Calendar,
  Shield,
  Layers,
  Stethoscope,
  Sparkles,
  Plus,
} from 'lucide-react';
import { useFinance, CATEGORIES_BASE, ACCENT_THEMES } from '../context/FinanceContext';
import { CategoryKey, DestinationKey, AccentTheme } from '../types/finance';
import { formatCurrency } from '../utils/formatters';
import { BankSyncModal } from '../components/BankSyncModal';
import { MedicalCareerSettings } from '../components/MedicalCareerSettings';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { BudgetRebalanceModal } from '../components/modals/BudgetRebalanceModal';
import {
  rebalanceBudget,
  computeCompetenceBudgetSnapshot,
  previewFutureMonthsScope,
  DESTINATION_NAMES,
  type RebalanceResult,
} from '../utils/rebalanceBudgetEngine';
import {
  requestPushPermission,
  sendTestNotification,
  getBrowserPermissionStatus,
} from '../utils/pushNotificationEngine';
import {
  parseExplicitYieldInput,
  parseReserveMonthsInput,
  parseDeclaredIncomeInput,
  serializeFinancialParametersBackup,
  parseFinancialParametersBackup,
  type CoupleHeaderSyncKey,
} from '../lib/coupleSnapshot';

class AvatarSettingsBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

type SettingsBlock = 'all' | 'casal' | 'cascata' | 'escudo' | 'medico';

export const SettingsScreen: React.FC = () => {
  const {
    state,
    totalIncome,
    patchCoupleProfile,
    headerSaveError,
    syncConflict,
    headerConflicts,
    resolveHeaderConflict,
    categoryLocks,
    applyBudgetRebalanceProposal,
    appearanceSyncStatus,
    retryAppearanceSync,
    saveCurrentAppearance,
    setModeTheme,
    clearAllData,
    triggerCelebration,
    keywordRules,
    addKeywordRule,
    removeKeywordRule,
    autoCategorizeDescription,
    detectedSubscriptions,
    dismissSubscription,
    confirmSubscriptionAsExpense,
    coupleAccount,
    generateNewInviteCode,
    joinCoupleWithInviteCode,
    pushSettings,
    updatePushSettings,
    householdConfig,
    v23Preferences,
    shieldMetrics,
    waterfallResult,
    saveHouseholdConfig,
    updateV23Preferences,
  } = useFinance();

  const [activeBlock, setActiveBlock] = useState<SettingsBlock>('all');
  const dirtyBudget = useRef(new Set<string>());
  const budgetBaseline = useRef<Record<string, number | boolean>>({});
  const dirtyProfile = useRef(new Set<string>());
  const [backupPreview, setBackupPreview] = useState<ReturnType<
    typeof parseFinancialParametersBackup
  > | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const backupBaseline = useRef<Record<string, unknown>>({});
  const draftBaseline = useRef<Record<string, unknown>>({});

  const markProfileDirty = (key: keyof typeof state.profile) => {
    if (!dirtyProfile.current.has(key)) draftBaseline.current[key] = state.profile[key];
    dirtyProfile.current.add(key);
  };
  const profileDraftConflicts = (keys: readonly string[]) =>
    keys.filter(
      (key) =>
        dirtyProfile.current.has(key) &&
        state.profile[key as keyof typeof state.profile] !== draftBaseline.current[key]
    );

  // ==========================================
  // BLOCO 1 — CASAL & PAREAMENTO STATE
  // ==========================================
  const [partner1Name, setPartner1Name] = useState(state.profile.partner1Name);
  const [partner2Name, setPartner2Name] = useState(state.profile.partner2Name);
  const [taxIdsInput, setTaxIdsInput] = useState(() =>
    (householdConfig.memberTaxIds || []).join(', ')
  );
  const [inputInviteCode, setInputInviteCode] = useState('');
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // ==========================================
  // BLOCO 2 — PARÂMETROS DA CASCATA 60/30/10
  // ==========================================
  const [cycleStartDay, setCycleStartDay] = useState(String(householdConfig.cycleStartDay));
  const [wave2Day, setWave2Day] = useState(String(v23Preferences.wave2Day));
  const [mandatoryGoalPct, setMandatoryGoalPct] = useState(
    String(Math.round(householdConfig.mandatoryGoalRate * 100))
  );
  const [housingCapPct, setHousingCapPct] = useState(
    String(Math.round(householdConfig.housingCapRate * 100))
  );
  const [structureCapPct, setStructureCapPct] = useState(
    String(Math.round(householdConfig.structureCapRate * 100))
  );
  const [installmentMinPct, setInstallmentMinPct] = useState(
    String(Math.round(householdConfig.installmentCapMin * 100))
  );
  const [installmentTargetPct, setInstallmentTargetPct] = useState(
    String(Math.round(householdConfig.installmentCapTarget * 100))
  );
  const [installmentMaxPct, setInstallmentMaxPct] = useState(
    String(Math.round(householdConfig.installmentCapMax * 100))
  );
  const [allowanceFloor, setAllowanceFloor] = useState(String(householdConfig.allowanceFloor));
  const [allowanceCap, setAllowanceCap] = useState(String(householdConfig.allowanceCap));
  const [groceriesDefault, setGroceriesDefault] = useState(
    String(v23Preferences.defaultGroceriesBudget)
  );
  const [routineDefault, setRoutineDefault] = useState(
    String(v23Preferences.defaultRoutineBudget)
  );
  const [bufferDefault, setBufferDefault] = useState(
    String(v23Preferences.defaultBufferLimit)
  );
  const [cascadeSavedMsg, setCascadeSavedMsg] = useState<string | null>(null);

  const [partner1Income, setPartner1Income] = useState(state.profile.partner1Income.toString());
  const [partner2Income, setPartner2Income] = useState(state.profile.partner2Income.toString());
  const numP1 = parseFloat(partner1Income.replace(',', '.')) || 0;
  const numP2 = parseFloat(partner2Income.replace(',', '.')) || 0;
  const currentIncome = numP1 + numP2 > 0 ? numP1 + numP2 : totalIncome;

  // Competence & Rebalance table (kept for granular envelope adjustments & test parity)
  const [selectedCompetence, setSelectedCompetence] = useState<string>(
    state.currentMonth || new Date().toISOString().slice(0, 7)
  );
  const [applyToFutureMonths, setApplyToFutureMonths] = useState<boolean>(false);
  const [overwriteApprovedFutureMonths, setOverwriteApprovedFutureMonths] =
    useState<boolean>(false);

  const liveCompetenceSnapshot = useMemo(
    () => computeCompetenceBudgetSnapshot(state, selectedCompetence),
    [state, selectedCompetence]
  );

  const [pctMoradia, setPctMoradia] = useState<number>(
    liveCompetenceSnapshot.currentPercentages.moradia ?? 30
  );
  const [pctTransporte, setPctTransporte] = useState<number>(
    liveCompetenceSnapshot.currentPercentages.transporte ?? 10
  );
  const [pctComida, setPctComida] = useState<number>(
    liveCompetenceSnapshot.currentPercentages.comida ?? 15
  );
  const [pctLazer, setPctLazer] = useState<number>(
    liveCompetenceSnapshot.currentPercentages.lazer ?? 15
  );
  const [pctProtecao, setPctProtecao] = useState<number>(
    liveCompetenceSnapshot.currentPercentages.protecao ?? 10
  );
  const [pctProfissional, setPctProfissional] = useState<number>(
    liveCompetenceSnapshot.currentPercentages.profissional ?? 10
  );
  const [pctInvestimentos, setPctInvestimentos] = useState<number>(
    liveCompetenceSnapshot.currentPercentages.investimentos ?? 10
  );

  const [localLocks, setLocalLocks] = useState<Record<DestinationKey, boolean>>(() => ({
    ...liveCompetenceSnapshot.locks,
  }));

  const defaultFloors: Record<DestinationKey, number> = {
    ...liveCompetenceSnapshot.floorsR$,
    investimentos:
      liveCompetenceSnapshot.plannedNetIncome > 0
        ? (liveCompetenceSnapshot.floorsR$.investimentos / liveCompetenceSnapshot.plannedNetIncome) *
          100
        : state.categoryFloors?.investimentos ?? 0,
  };

  const [pisoMoradia, setPisoMoradia] = useState<number>(defaultFloors.moradia ?? 0);
  const [pisoTransporte, setPisoTransporte] = useState<number>(defaultFloors.transporte ?? 0);
  const [pisoComida, setPisoComida] = useState<number>(defaultFloors.comida ?? 0);
  const [pisoLazer, setPisoLazer] = useState<number>(defaultFloors.lazer ?? 0);
  const [pisoProtecao, setPisoProtecao] = useState<number>(defaultFloors.protecao ?? 0);
  const [pisoProfissional, setPisoProfissional] = useState<number>(defaultFloors.profissional ?? 0);
  const [pisoInvestimentosPct] = useState<number>(defaultFloors.investimentos ?? 0);

  const [rebalanceProposal, setProposedRebalance] = useState<RebalanceResult | null>(null);
  const [previewSignature, setPreviewSignature] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState<number>(0);
  const [rebalanceMessage, setRebalanceMessage] = useState<string | null>(null);
  const [isRebalanceModalOpen, setIsRebalanceModalOpen] = useState(false);

  // ==========================================
  // BLOCO 3 — PARÂMETROS DO ESCUDO & PATRIMÔNIO
  // ==========================================
  const [shieldFloorMonthsInput, setShieldFloorMonthsInput] = useState(
    String(householdConfig.shieldFloorMonths)
  );
  const [shieldTargetMonthsInput, setShieldTargetMonthsInput] = useState(
    String(householdConfig.shieldTargetMonths)
  );
  const [reserveMonths, setReserveMonths] = useState<string>(
    String(state.profile.emergencyReserveMonthsTarget ?? 6)
  );
  const [expectedYield, setExpectedYield] = useState<string>(
    state.profile.expectedYieldAnnual !== undefined && state.profile.expectedYieldAnnual !== null
      ? String(state.profile.expectedYieldAnnual)
      : '6.5'
  );
  const [profileSectionError, setProfileSectionError] = useState<string | null>(null);
  const [patrimonialSectionError, setPatrimonialSectionError] = useState<string | null>(null);

  // ==========================================
  // BLOCO 4 — PERFIL MÉDICO, CSV & REGRAS
  // ==========================================
  const [defaultShiftTaxPct, setDefaultShiftTaxPct] = useState(
    String(Math.round(householdConfig.defaultShiftTaxRate * 100))
  );
  const [newHospitalInput, setNewHospitalInput] = useState('');
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newKeyCategory, setNewKeyCategory] = useState<CategoryKey>('comida');
  const [newKeySubcat, setNewKeySubcat] = useState('');
  const [testDescription, setTestDescription] = useState('');
  const [pushStatusMsg, setPushStatusMsg] = useState<string | null>(null);

  // Clear / Reset Data
  const [showClearDataModal, setShowClearDataModal] = useState(false);
  const [isClearingData, setIsClearingData] = useState(false);
  const [clearSuccessMsg, setClearSuccessMsg] = useState<string | null>(null);
  const [clearErrorMsg, setClearErrorMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);

  // Keep editable competence values synchronized
  useEffect(() => {
    if (!dirtyBudget.current.has('pct.moradia'))
      setPctMoradia(liveCompetenceSnapshot.currentPercentages.moradia ?? 30);
    if (!dirtyBudget.current.has('pct.transporte'))
      setPctTransporte(liveCompetenceSnapshot.currentPercentages.transporte ?? 10);
    if (!dirtyBudget.current.has('pct.comida'))
      setPctComida(liveCompetenceSnapshot.currentPercentages.comida ?? 15);
    if (!dirtyBudget.current.has('pct.lazer'))
      setPctLazer(liveCompetenceSnapshot.currentPercentages.lazer ?? 15);
    if (!dirtyBudget.current.has('pct.protecao'))
      setPctProtecao(liveCompetenceSnapshot.currentPercentages.protecao ?? 10);
    if (!dirtyBudget.current.has('pct.profissional'))
      setPctProfissional(liveCompetenceSnapshot.currentPercentages.profissional ?? 10);
    if (!dirtyBudget.current.has('pct.investimentos'))
      setPctInvestimentos(liveCompetenceSnapshot.currentPercentages.investimentos ?? 10);
    setLocalLocks(
      (previous) =>
        Object.fromEntries(
          Object.entries(liveCompetenceSnapshot.locks).map(([key, value]) => [
            key,
            dirtyBudget.current.has('lock.' + key) ? previous[key as DestinationKey] : value,
          ])
        ) as Record<DestinationKey, boolean>
    );
    if (!dirtyBudget.current.has('floor.moradia'))
      setPisoMoradia(liveCompetenceSnapshot.floorsR$.moradia);
    if (!dirtyBudget.current.has('floor.transporte'))
      setPisoTransporte(liveCompetenceSnapshot.floorsR$.transporte);
    if (!dirtyBudget.current.has('floor.comida'))
      setPisoComida(liveCompetenceSnapshot.floorsR$.comida);
    if (!dirtyBudget.current.has('floor.lazer')) setPisoLazer(liveCompetenceSnapshot.floorsR$.lazer);
    if (!dirtyBudget.current.has('floor.protecao'))
      setPisoProtecao(liveCompetenceSnapshot.floorsR$.protecao);
    if (!dirtyBudget.current.has('floor.profissional'))
      setPisoProfissional(liveCompetenceSnapshot.floorsR$.profissional);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCompetence,
    state.categoryPercentages,
    state.categoryFloors,
    categoryLocks,
    state.profile.investmentsPercentage,
    state.monthlyBudgetPlans,
  ]);

  useEffect(() => {
    if (!dirtyProfile.current.has('partner1Income'))
      setPartner1Income(state.profile.partner1Income.toString());
    if (!dirtyProfile.current.has('partner2Income'))
      setPartner2Income(state.profile.partner2Income.toString());
    if (!dirtyProfile.current.has('partner1Name')) setPartner1Name(state.profile.partner1Name);
    if (!dirtyProfile.current.has('partner2Name')) setPartner2Name(state.profile.partner2Name);
    if (
      state.profile.emergencyReserveMonthsTarget !== undefined &&
      state.profile.emergencyReserveMonthsTarget !== null &&
      !dirtyProfile.current.has('emergencyReserveMonthsTarget')
    ) {
      setReserveMonths(String(state.profile.emergencyReserveMonthsTarget));
    }
    if (
      state.profile.expectedYieldAnnual !== undefined &&
      state.profile.expectedYieldAnnual !== null &&
      !dirtyProfile.current.has('expectedYieldAnnual')
    ) {
      setExpectedYield(String(state.profile.expectedYieldAnnual));
    }
  }, [
    state.profile.partner1Income,
    state.profile.partner2Income,
    state.profile.partner1Name,
    state.profile.partner2Name,
    state.profile.emergencyReserveMonthsTarget,
    state.profile.expectedYieldAnnual,
  ]);

  const valMoradia = (pctMoradia / 100) * currentIncome;
  const valTransporte = (pctTransporte / 100) * currentIncome;
  const valComida = (pctComida / 100) * currentIncome;
  const valLazer = (pctLazer / 100) * currentIncome;
  const valProtecao = (pctProtecao / 100) * currentIncome;
  const valProfissional = (pctProfissional / 100) * currentIncome;
  const valInvestimentos = (pctInvestimentos / 100) * currentIncome;
  const totalPercentagesSum =
    pctMoradia +
    pctTransporte +
    pctComida +
    pctLazer +
    pctProtecao +
    pctProfissional +
    pctInvestimentos;

  const isInlinePreviewStale = Boolean(
    rebalanceProposal &&
      previewSignature &&
      previewSignature !== liveCompetenceSnapshot.signature
  );

  const currentEditablePercentages: Record<DestinationKey, number> = {
    moradia: pctMoradia,
    transporte: pctTransporte,
    comida: pctComida,
    lazer: pctLazer,
    protecao: pctProtecao,
    profissional: pctProfissional,
    investimentos: pctInvestimentos,
  };

  const futureScopePreview = useMemo(
    () =>
      applyToFutureMonths
        ? previewFutureMonthsScope(
            state,
            selectedCompetence,
            rebalanceProposal?.proposedPercentages || currentEditablePercentages,
            6,
            overwriteApprovedFutureMonths
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      applyToFutureMonths,
      state.monthlyBudgetPlans,
      selectedCompetence,
      rebalanceProposal,
      pctMoradia,
      pctTransporte,
      pctComida,
      pctLazer,
      pctProtecao,
      pctProfissional,
      pctInvestimentos,
      overwriteApprovedFutureMonths,
    ]
  );

  const markBudgetDirty = (key: string, baseline: number | boolean) => {
    if (!dirtyBudget.current.has(key)) budgetBaseline.current[key] = baseline;
    dirtyBudget.current.add(key);
  };

  const budgetConflicts = () =>
    [...dirtyBudget.current].filter((key) => {
      const [kind, destination] = key.split('.');
      const dest = destination as DestinationKey;
      const current =
        kind === 'pct'
          ? liveCompetenceSnapshot.currentPercentages[dest]
          : kind === 'lock'
          ? liveCompetenceSnapshot.locks[dest]
          : liveCompetenceSnapshot.floorsR$[dest];
      return current !== budgetBaseline.current[key];
    });

  const resolveBudgetConflicts = (keepDraft: boolean) => {
    for (const key of budgetConflicts()) {
      const [kind, destination] = key.split('.');
      const dest = destination as DestinationKey;
      const current =
        kind === 'pct'
          ? liveCompetenceSnapshot.currentPercentages[dest]
          : kind === 'lock'
          ? liveCompetenceSnapshot.locks[dest]
          : liveCompetenceSnapshot.floorsR$[dest];
      if (keepDraft) {
        budgetBaseline.current[key] = current;
      } else {
        dirtyBudget.current.delete(key);
        if (kind === 'lock') {
          setLocalLocks((previous) => ({
            ...previous,
            [dest]: liveCompetenceSnapshot.locks[dest],
          }));
        }
        if (kind === 'pct') {
          const setters = {
            moradia: setPctMoradia,
            transporte: setPctTransporte,
            comida: setPctComida,
            lazer: setPctLazer,
            protecao: setPctProtecao,
            profissional: setPctProfissional,
            investimentos: setPctInvestimentos,
          };
          setters[dest](current as number);
        }
        if (kind === 'floor' && dest !== 'investimentos') {
          const setters = {
            moradia: setPisoMoradia,
            transporte: setPisoTransporte,
            comida: setPisoComida,
            lazer: setPisoLazer,
            protecao: setPisoProtecao,
            profissional: setPisoProfissional,
          };
          setters[dest](current as number);
        }
      }
    }
    setRebalanceMessage(
      keepDraft
        ? 'Rascunho mantido. Simule novamente com os valores atuais.'
        : 'Valores atuais adotados. Simule novamente.'
    );
  };

  const handleToggleDestinationLock = (dest: DestinationKey) => {
    markBudgetDirty('lock.' + dest, liveCompetenceSnapshot.locks[dest]);
    setLocalLocks((prev) => ({ ...prev, [dest]: !prev[dest] }));
    setProposedRebalance(null);
    setPreviewSignature(null);
    setRebalanceMessage(null);
  };

  const handleSaveIdentityProfile = () => {
    if (profileDraftConflicts(['partner1Name', 'partner2Name']).length) {
      setProfileSectionError(
        'Um campo em edição foi alterado por outra sessão. Revise antes de salvar.'
      );
      return;
    }
    setProfileSectionError(null);
    const patch: Record<string, unknown> = {};
    if (dirtyProfile.current.has('partner1Name')) patch.partner1Name = partner1Name;
    if (dirtyProfile.current.has('partner2Name')) patch.partner2Name = partner2Name;
    const res = patchCoupleProfile(patch);
    if (!res.valid) {
      setProfileSectionError(res.errors.join(' '));
      return;
    }
    dirtyProfile.current.delete('partner1Name');
    dirtyProfile.current.delete('partner2Name');
    setSaveSuccessMsg(true);
    if (res.changedKeys.length > 0) triggerCelebration();
    setTimeout(() => setSaveSuccessMsg(false), 4000);
  };

  const handleSaveTaxIds = async () => {
    const cleaned = taxIdsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await saveHouseholdConfig({ memberTaxIds: cleaned });
    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 4000);
  };

  const handleSaveCascadeParams = async () => {
    const startDay = Math.min(28, Math.max(1, parseInt(cycleStartDay, 10) || 1));
    const w2Day = Math.min(28, Math.max(2, parseInt(wave2Day, 10) || 15));
    const mRate = Math.min(0.5, Math.max(0.05, (parseFloat(mandatoryGoalPct) || 10) / 100));
    const hRate = Math.min(0.45, Math.max(0.15, (parseFloat(housingCapPct) || 30) / 100));
    const sRate = Math.min(0.8, Math.max(0.4, (parseFloat(structureCapPct) || 60) / 100));
    const iMin = Math.min(0.3, Math.max(0.05, (parseFloat(installmentMinPct) || 10) / 100));
    const iTarget = Math.min(0.3, Math.max(iMin, (parseFloat(installmentTargetPct) || 15) / 100));
    const iMax = Math.min(0.35, Math.max(iTarget, (parseFloat(installmentMaxPct) || 20) / 100));
    const floorVal = Math.max(0, parseFloat(allowanceFloor) || 0);
    const capVal = Math.max(floorVal, parseFloat(allowanceCap) || floorVal);

    await saveHouseholdConfig(
      {
        cycleStartDay: startDay,
        mandatoryGoalRate: mRate,
        housingCapRate: hRate,
        structureCapRate: sRate,
        installmentCapMin: iMin,
        installmentCapTarget: iTarget,
        installmentCapMax: iMax,
        allowanceFloor: floorVal,
        allowanceCap: capVal,
      },
      {
        wave2Day: w2Day,
        defaultGroceriesBudget: Math.max(0, parseFloat(groceriesDefault) || 0),
        defaultRoutineBudget: Math.max(0, parseFloat(routineDefault) || 0),
        defaultBufferLimit: Math.max(0, parseFloat(bufferDefault) || 0),
      }
    );
    setCascadeSavedMsg('Parâmetros da Cascata 60/30/10 atualizados com sucesso.');
    triggerCelebration();
    setTimeout(() => setCascadeSavedMsg(null), 4000);
  };

  const handleSaveIncome = () => {
    setProfileSectionError(null);
    const parsedP1 = parseDeclaredIncomeInput(partner1Income);
    const parsedP2 = parseDeclaredIncomeInput(partner2Income);
    if (parsedP1.status === 'invalid' || parsedP2.status === 'invalid') {
      setProfileSectionError(
        (parsedP1.status === 'invalid' ? parsedP1.message : '') ||
          (parsedP2.status === 'invalid' ? parsedP2.message : '')
      );
      return;
    }
    const patch: Record<string, unknown> = {};
    if (parsedP1.status === 'valid') patch.partner1Income = parsedP1.value;
    if (parsedP2.status === 'valid') patch.partner2Income = parsedP2.value;
    const res = patchCoupleProfile(patch);
    if (!res.valid) {
      setProfileSectionError(res.errors.join(' '));
      return;
    }
    dirtyProfile.current.delete('partner1Income');
    dirtyProfile.current.delete('partner2Income');
    setSaveSuccessMsg(true);
    triggerCelebration();
    setTimeout(() => setSaveSuccessMsg(false), 4000);
  };

  const handleSavePatrimonialParams = async () => {
    if (profileDraftConflicts(['expectedYieldAnnual', 'emergencyReserveMonthsTarget']).length) {
      setProfileSectionError(
        'Um campo em edição foi alterado por outra sessão. Revise antes de salvar.'
      );
      return;
    }
    setPatrimonialSectionError(null);
    const parsedYield = parseExplicitYieldInput(expectedYield);
    if (parsedYield.status !== 'valid') {
      setPatrimonialSectionError(
        parsedYield.status === 'invalid'
          ? parsedYield.message
          : 'Informe a taxa real esperada (use 0 para rendimento zero).'
      );
      return;
    }
    const parsedMonths = parseReserveMonthsInput(reserveMonths);
    if (parsedMonths.status !== 'valid') {
      setPatrimonialSectionError(
        parsedMonths.status === 'invalid'
          ? parsedMonths.message
          : 'Informe a meta de meses da reserva de emergência (1 a 120).'
      );
      return;
    }

    const patch: Record<string, unknown> = {};
    if (dirtyProfile.current.has('emergencyReserveMonthsTarget')) {
      patch.emergencyReserveMonthsTarget = parsedMonths.value;
    }
    if (dirtyProfile.current.has('expectedYieldAnnual')) {
      patch.expectedYieldAnnual = parsedYield.value;
    }
    const res = patchCoupleProfile(patch);
    if (!res.valid) {
      setPatrimonialSectionError(res.errors.join(' '));
      return;
    }
    dirtyProfile.current.delete('emergencyReserveMonthsTarget');
    dirtyProfile.current.delete('expectedYieldAnnual');

    const floorM = Math.max(1, Math.min(24, parseInt(shieldFloorMonthsInput, 10) || 4));
    const targetM = Math.max(floorM, Math.min(36, parseInt(shieldTargetMonthsInput, 10) || 10));
    await saveHouseholdConfig({
      shieldFloorMonths: floorM,
      shieldTargetMonths: targetM,
    });

    setSaveSuccessMsg(true);
    if (res.changedKeys.length > 0) triggerCelebration();
    setTimeout(() => setSaveSuccessMsg(false), 4000);
  };

  const handleTriggerRebalance = () => {
    setRebalanceMessage(null);
    const effectiveIncomeForSim =
      currentIncome > 0 ? currentIncome : liveCompetenceSnapshot.plannedNetIncome;
    const floorsR$: Record<DestinationKey, number> = {
      moradia: pisoMoradia,
      transporte: pisoTransporte,
      comida: pisoComida,
      lazer: pisoLazer,
      protecao: pisoProtecao,
      profissional: pisoProfissional,
      investimentos:
        effectiveIncomeForSim > 0 ? (effectiveIncomeForSim * pisoInvestimentosPct) / 100 : 0,
    };

    const res = rebalanceBudget({
      plannedNetIncome: effectiveIncomeForSim,
      currentPercentages: currentEditablePercentages,
      locks: localLocks,
      floorsR$,
      commitmentsR$: liveCompetenceSnapshot.pendingCommitmentsR$,
      actualSpentR$: liveCompetenceSnapshot.actualSpentR$,
      actualSpentByNatureR$: liveCompetenceSnapshot.actualSpentByNatureR$,
      pendingByNatureR$: liveCompetenceSnapshot.pendingByNatureR$,
      competence: selectedCompetence,
      applyToFutureMonths,
      baseSnapshotSignature: liveCompetenceSnapshot.signature,
    });

    setProposedRebalance(res);
    setPreviewSignature(liveCompetenceSnapshot.signature);
    setPreviewRevision(liveCompetenceSnapshot.planRevision);
    if (res.status === 'infeasible') setRebalanceMessage(res.explanation);
  };

  const handleApplyRebalance = () => {
    if (!rebalanceProposal || rebalanceProposal.status !== 'feasible') return;
    const cmdResult = applyBudgetRebalanceProposal(rebalanceProposal, {
      expectedSignature: previewSignature ?? undefined,
      expectedPlanRevision: previewRevision,
      overwriteExistingFutureApprovedPlans: overwriteApprovedFutureMonths,
    });
    if (cmdResult.status !== 'ready') {
      setRebalanceMessage(cmdResult.reason);
      setProposedRebalance(null);
      setPreviewSignature(null);
      return;
    }
    dirtyBudget.current.clear();
    setPctMoradia(rebalanceProposal.proposedPercentages.moradia ?? 0);
    setPctTransporte(rebalanceProposal.proposedPercentages.transporte ?? 0);
    setPctComida(rebalanceProposal.proposedPercentages.comida ?? 0);
    setPctLazer(rebalanceProposal.proposedPercentages.lazer ?? 0);
    setPctProtecao(rebalanceProposal.proposedPercentages.protecao ?? 0);
    setPctProfissional(rebalanceProposal.proposedPercentages.profissional ?? 0);
    setPctInvestimentos(rebalanceProposal.proposedPercentages.investimentos ?? 0);
    setProposedRebalance(null);
    setPreviewSignature(null);
    setSaveSuccessMsg(true);
    triggerCelebration();
    setTimeout(() => setSaveSuccessMsg(false), 4000);
  };

  const handleAddHospital = async () => {
    const trimmed = newHospitalInput.trim();
    if (!trimmed) return;
    const next = Array.from(new Set([...(v23Preferences.favoriteHospitals || []), trimmed]));
    await updateV23Preferences({ favoriteHospitals: next });
    setNewHospitalInput('');
  };

  const handleRemoveHospital = async (name: string) => {
    const next = (v23Preferences.favoriteHospitals || []).filter((h) => h !== name);
    await updateV23Preferences({ favoriteHospitals: next });
  };

  const handleSaveMedicalTax = async () => {
    const rate = Math.min(0.45, Math.max(0, (parseFloat(defaultShiftTaxPct) || 0) / 100));
    await saveHouseholdConfig({ defaultShiftTaxRate: rate });
    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 4000);
  };

  const handleAddKeyword = () => {
    if (!newKeyword.trim()) return;
    addKeywordRule({
      keyword: newKeyword.trim().toUpperCase(),
      category: newKeyCategory,
      subcategory: newKeySubcat.trim() || undefined,
    });
    setNewKeyword('');
    setNewKeySubcat('');
    triggerCelebration();
  };

  const testMatch = useMemo(() => {
    if (!testDescription.trim()) return null;
    return autoCategorizeDescription(testDescription);
  }, [testDescription, autoCategorizeDescription]);

  const handleConfirmClearData = async () => {
    setIsClearingData(true);
    setClearErrorMsg(null);
    try {
      await clearAllData();
      setShowClearDataModal(false);
      setClearSuccessMsg(
        'Todo o conteúdo atual da conta foi apagado com sucesso! Seus parâmetros e categorizações foram preservados.'
      );
      setTimeout(() => setClearSuccessMsg(null), 6000);
    } catch (e: unknown) {
      setClearErrorMsg(
        e instanceof Error ? e.message : 'Não conseguimos apagar o conteúdo agora. Tente novamente.'
      );
    } finally {
      setIsClearingData(false);
    }
  };

  const showBlock = (block: Exclude<SettingsBlock, 'all'>) =>
    activeBlock === 'all' || activeBlock === block;

  return (
    <div className="space-y-6 pb-20 max-w-5xl mx-auto">
      {/* Header + 4-Block Navigation */}
      <div className="space-y-4 border-b border-slate-200/90 dark:border-slate-800 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
              Configurações do Sistema
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              4 blocos de calibração: Casal, Cascata 60/30/10, Escudo e Carreira Médica & CSV.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <PWAInstallButton variant="header" />
            <button
              type="button"
              onClick={() => setShowClearDataModal(true)}
              className="min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 text-xs font-bold cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Zerar Conta</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 text-xs font-bold">
          {([
            { id: 'all', label: 'Todos os 4 Blocos', icon: Sparkles },
            { id: 'casal', label: '1. Casal & Pareamento', icon: Users },
            { id: 'cascata', label: '2. Cascata 60/30/10', icon: Layers },
            { id: 'escudo', label: '3. Escudo', icon: Shield },
            { id: 'medico', label: '4. Médico & Regras CSV', icon: Stethoscope },
          ] as const).map((tab) => {
            const Icon = tab.icon;
            const active = activeBlock === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveBlock(tab.id)}
                className={`min-h-[44px] px-3.5 py-2 rounded-xl flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Global Alerts */}
      {saveSuccessMsg && (
        <div className="p-4 rounded-2xl bg-emerald-600 text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-sm">
          <Check className="w-5 h-5" />
          <span>Configurações atualizadas e sincronizadas.</span>
        </div>
      )}
      {cascadeSavedMsg && (
        <div className="p-4 rounded-2xl bg-emerald-600 text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-sm">
          <Check className="w-5 h-5" />
          <span>{cascadeSavedMsg}</span>
        </div>
      )}
      {clearSuccessMsg && (
        <div className="p-4 rounded-2xl bg-rose-600 text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-sm">
          <Check className="w-5 h-5" />
          <span>{clearSuccessMsg}</span>
        </div>
      )}
      {clearErrorMsg && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 text-amber-900 dark:text-amber-100 text-xs font-bold"
        >
          {clearErrorMsg}
        </div>
      )}
      {(headerSaveError || syncConflict) && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 text-amber-950 dark:text-amber-100 text-xs font-bold"
        >
          {syncConflict || headerSaveError}
        </div>
      )}
      {Object.entries(headerConflicts || {}).map(
        ([key, conflict]) =>
          conflict && (
            <div
              key={key}
              role="alert"
              className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 space-y-2 text-xs"
            >
              <p>Alterações concorrentes em {key}. Escolha qual valor manter:</p>
              <p>
                Seu valor: {JSON.stringify(conflict.local)} · Valor atual:{' '}
                {JSON.stringify(conflict.remote)}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void resolveHeaderConflict(key as CoupleHeaderSyncKey, 'local')}
                  className="underline font-bold"
                >
                  Manter meu valor
                </button>
                <button
                  type="button"
                  onClick={() => void resolveHeaderConflict(key as CoupleHeaderSyncKey, 'remote')}
                  className="underline font-bold"
                >
                  Usar valor atual
                </button>
              </div>
            </div>
          )
      )}
      {budgetConflicts().length > 0 && (
        <div role="alert" className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
          <p>O orçamento mudou nos campos em edição: {budgetConflicts().join(', ')}.</p>
          <button
            type="button"
            className="underline font-bold"
            onClick={() => resolveBudgetConflicts(true)}
          >
            Manter rascunho
          </button>
          <button
            type="button"
            className="underline font-bold ml-4"
            onClick={() => resolveBudgetConflicts(false)}
          >
            Usar valores atuais
          </button>
        </div>
      )}
      {profileDraftConflicts([...dirtyProfile.current]).length > 0 && (
        <div role="alert" className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
          <p>
            Campos do perfil mudaram durante a edição:{' '}
            {profileDraftConflicts([...dirtyProfile.current]).join(', ')}.
          </p>
          <button
            type="button"
            className="underline font-bold"
            onClick={() => {
              for (const key of profileDraftConflicts([...dirtyProfile.current])) {
                draftBaseline.current[key] = state.profile[key as keyof typeof state.profile];
              }
              setProfileSectionError('Rascunho mantido. Revise e salve novamente.');
            }}
          >
            Manter meu rascunho
          </button>
          <button
            type="button"
            className="underline font-bold ml-4"
            onClick={() => {
              const setters: Record<string, (value: string) => void> = {
                partner1Name: setPartner1Name,
                partner2Name: setPartner2Name,
                partner1Income: setPartner1Income,
                partner2Income: setPartner2Income,
                expectedYieldAnnual: setExpectedYield,
                emergencyReserveMonthsTarget: setReserveMonths,
              };
              for (const key of profileDraftConflicts([...dirtyProfile.current])) {
                dirtyProfile.current.delete(key);
                setters[key]?.(String(state.profile[key as keyof typeof state.profile] ?? ''));
              }
              setProfileSectionError(null);
            }}
          >
            Usar valores atuais do perfil
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BLOCO 1 — CASAL & PAREAMENTO                                              */}
      {/* ========================================================================= */}
      {showBlock('casal') && (
        <section className="space-y-5">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-lg font-extrabold font-display">
              Bloco 1 — Casal & Pareamento
            </h3>
          </div>

          {/* Nomes + TaxIds */}
          <div className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Identificação do Casal
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Alterar nomes de exibição preserva planos, renda e parâmetros.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveIdentityProfile}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-black dark:bg-white dark:text-slate-900 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Salvar Perfil</span>
              </button>
            </div>

            {profileSectionError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-800 dark:text-rose-200 text-xs font-bold"
              >
                {profileSectionError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="settings-partner1-name"
                  className="text-xs font-bold text-slate-800 dark:text-slate-200 block"
                >
                  Nome de Exibição (Pessoa 1)
                </label>
                <input
                  id="settings-partner1-name"
                  type="text"
                  maxLength={80}
                  value={partner1Name}
                  onChange={(e) => {
                    markProfileDirty('partner1Name');
                    setPartner1Name(e.target.value);
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="settings-partner2-name"
                  className="text-xs font-bold text-slate-800 dark:text-slate-200 block"
                >
                  Nome de Exibição (Pessoa 2)
                </label>
                <input
                  id="settings-partner2-name"
                  type="text"
                  maxLength={80}
                  value={partner2Name}
                  onChange={(e) => {
                    markProfileDirty('partner2Name');
                    setPartner2Name(e.target.value);
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* CPFs/Nomes para blindagem CSV */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1 space-y-1">
                <label
                  htmlFor="settings-member-tax-ids"
                  className="text-xs font-bold text-slate-700 dark:text-slate-300 block"
                >
                  CPFs / Nomes do Casal (Blindagem no CSV Client-Side)
                </label>
                <input
                  id="settings-member-tax-ids"
                  type="text"
                  value={taxIdsInput}
                  onChange={(e) => setTaxIdsInput(e.target.value)}
                  placeholder="Ex: 123.456.789-00, 987.654.321-11"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleSaveTaxIds()}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer shrink-0"
              >
                Salvar CPFs
              </button>
            </div>
          </div>

          {/* Convite e Fusão */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white">
              Fusão & Convite de Casal
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <span className="font-bold text-xs text-slate-700 dark:text-slate-300 block">
                  Seu convite de uso único:
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 py-2.5 px-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-500 text-center font-mono font-semibold text-xs break-all text-emerald-700 dark:text-emerald-400">
                    {coupleAccount?.inviteCode || 'Gere um convite abaixo'}
                  </div>
                  <button
                    type="button"
                    disabled={!coupleAccount?.inviteCode}
                    onClick={() => {
                      navigator.clipboard.writeText(coupleAccount?.inviteCode || '');
                      setCopiedInvite(true);
                      setTimeout(() => setCopiedInvite(false), 2500);
                    }}
                    className="p-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 cursor-pointer"
                    title="Copiar código"
                  >
                    {copiedInvite ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  className="btn-outline w-full min-h-[40px] text-xs"
                  onClick={async () => {
                    try {
                      await generateNewInviteCode();
                      setInviteFeedback('Convite gerado. Compartilhe apenas com seu par.');
                    } catch (cause) {
                      setInviteFeedback(
                        cause instanceof Error ? cause.message : 'Não foi possível gerar o convite.'
                      );
                    }
                  }}
                >
                  <RefreshCw size={14} /> Gerar novo convite
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <span className="font-bold text-xs text-slate-700 dark:text-slate-300 block">
                  Conectar com Código do Parceiro:
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={128}
                    value={inputInviteCode}
                    onChange={(e) => setInputInviteCode(e.target.value)}
                    placeholder="Cole o convite recebido"
                    aria-label="Código de convite do seu par"
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="flex-1 py-2.5 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono font-bold text-xs text-center text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await joinCoupleWithInviteCode(inputInviteCode);
                        setInviteFeedback('Casal conectado com sucesso!');
                        triggerCelebration();
                      } catch (e: unknown) {
                        setInviteFeedback(e instanceof Error ? e.message : 'Erro ao conectar código.');
                      }
                    }}
                    className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                  >
                    Conectar
                  </button>
                </div>
                {inviteFeedback && (
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {inviteFeedback}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Avatares e Cores */}
          <AvatarSettingsBoundary>
            <AvatarSettings />
          </AvatarSettingsBoundary>

          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Palette className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Cores dos 3 Modos
                </h4>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
                {appearanceSyncStatus === 'saved'
                  ? 'Aparência sincronizada'
                  : appearanceSyncStatus === 'error'
                  ? 'Erro ao sincronizar aparência'
                  : 'Preferência local/conta'}
              </p>
              {appearanceSyncStatus === 'not-saved' && (
                <button
                  type="button"
                  onClick={saveCurrentAppearance}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold"
                >
                  Salvar aparência atual nesta conta
                </button>
              )}
              {appearanceSyncStatus === 'error' && (
                <button
                  type="button"
                  onClick={retryAppearanceSync}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold"
                >
                  Tentar sincronizar aparência
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {([
                { mode: 'couple', label: 'Modo Casal', current: state.profile.coupleTheme || 'emerald' },
                { mode: 'partner1', label: `Modo ${partner1Name}`, current: state.profile.partner1Theme || 'sapphire' },
                { mode: 'partner2', label: `Modo ${partner2Name}`, current: state.profile.partner2Theme || 'rose' },
              ] as const).map((entry) => (
                <div
                  key={entry.mode}
                  className="p-4 rounded-2xl border space-y-3"
                  style={{
                    borderColor: ACCENT_THEMES[entry.current].borderHex,
                    backgroundColor: ACCENT_THEMES[entry.current].lightHex,
                  }}
                >
                  <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                    {entry.mode !== 'couple' && (
                      <AvatarSettingsBoundary>
                        <MemberAvatar member={entry.mode} size={22} />
                      </AvatarSettingsBoundary>
                    )}
                    <span>{entry.label}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(Object.keys(ACCENT_THEMES) as AccentTheme[]).map((k) => (
                      <button
                        key={`${entry.mode}-${k}`}
                        type="button"
                        onClick={() => setModeTheme(entry.mode, k)}
                        className={`p-1.5 rounded-lg border text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                          entry.current === k
                            ? 'bg-white border-slate-900 text-slate-900'
                            : 'bg-white/70 border-slate-200 text-slate-700'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: ACCENT_THEMES[k].hex }}
                        />
                        <span className="truncate">{ACCENT_THEMES[k].label.split(' ')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* BLOCO 2 — PARÂMETROS DA CASCATA 60/30/10                                  */}
      {/* ========================================================================= */}
      {showBlock('cascata') && (
        <section className="space-y-5">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Layers className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            <h3 className="text-lg font-extrabold font-display">
              Bloco 2 — Parâmetros da Cascata 60/30/10
            </h3>
          </div>

          {/* Core Cascade Rules */}
          <div className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Regras da Cascata, Ondas & Mesada Híbrida
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Calibra dias de liberação, travas de Moradia (30%), Estrutura (60%), Parcelas (10%–20%) e piso da Mesada.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveCascadeParams()}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Salvar Parâmetros da Cascata</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Início do Ciclo (Dia)
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={cycleStartDay}
                  onChange={(e) => setCycleStartDay(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Dia da Onda 2 (Mesada)
                </label>
                <input
                  type="number"
                  min={2}
                  max={28}
                  value={wave2Day}
                  onChange={(e) => setWave2Day(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Meta Obrigatória (%)
                </label>
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={mandatoryGoalPct}
                  onChange={(e) => setMandatoryGoalPct(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Teto Estrutura (%)
                </label>
                <input
                  type="number"
                  min={40}
                  max={80}
                  value={structureCapPct}
                  onChange={(e) => setStructureCapPct(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Teto Moradia (%)
                </label>
                <input
                  type="number"
                  min={15}
                  max={45}
                  value={housingCapPct}
                  onChange={(e) => setHousingCapPct(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Parcelas Ideal / Máx (%)
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min={5}
                    max={30}
                    value={installmentTargetPct}
                    onChange={(e) => setInstallmentTargetPct(e.target.value)}
                    aria-label="Parcelas Ideal (%)"
                    className="w-1/2 px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                  />
                  <input
                    type="number"
                    min={10}
                    max={35}
                    value={installmentMaxPct}
                    onChange={(e) => setInstallmentMaxPct(e.target.value)}
                    aria-label="Parcelas Máximo (%)"
                    className="w-1/2 px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Piso Mesada / par (R$)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={allowanceFloor}
                  onChange={(e) => setAllowanceFloor(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Teto Mesada / par (R$)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={allowanceCap}
                  onChange={(e) => setAllowanceCap(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Compra do Mês Padrão (R$)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={groceriesDefault}
                  onChange={(e) => setGroceriesDefault(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Rotina Padrão (R$)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={routineDefault}
                  onChange={(e) => setRoutineDefault(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Buffer de Imprevistos (R$)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={bufferDefault}
                  onChange={(e) => setBufferDefault(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Parcelas Saudável Mín (%)
                </label>
                <input
                  type="number"
                  min={5}
                  max={25}
                  value={installmentMinPct}
                  onChange={(e) => setInstallmentMinPct(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs flex flex-wrap items-center justify-between gap-2 tabular-nums">
              <span>
                Renda líquida média 3M: <strong>{formatCurrency(waterfallResult.liquidity.referenceIncome3M)}</strong>
              </span>
              <span>
                Parcela máx 15%: <strong>{formatCurrency(waterfallResult.guards.installments.targetAmount)}</strong> ·
                Teto 20%: <strong>{formatCurrency(waterfallResult.guards.installments.max20Amount)}</strong>
              </span>
            </div>
          </div>

          {/* Renda Declarada + Competência e Travas */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Renda Base & Ajuste por Competência
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Soma no Caixa Único: <strong className="tabular-nums">{formatCurrency(currentIncome)}</strong>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveIncome}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                >
                  Salvar Renda
                </button>
                <button
                  type="button"
                  onClick={handleTriggerRebalance}
                  className="min-h-[40px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Simular Redistribuição na Competência</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsRebalanceModalOpen(true)}
                  className="min-h-[40px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reequilibrar com Travas</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Renda Base ({partner1Name})
                </label>
                <input
                  type="number"
                  step="100"
                  value={partner1Income}
                  onChange={(e) => {
                    markProfileDirty('partner1Income');
                    setPartner1Income(e.target.value);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Renda Base ({partner2Name})
                </label>
                <input
                  type="number"
                  step="100"
                  value={partner2Income}
                  onChange={(e) => {
                    markProfileDirty('partner2Income');
                    setPartner2Income(e.target.value);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold tabular-nums"
                />
              </div>
            </div>

            {/* Competência selector */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-sky-600 shrink-0" />
                <label htmlFor="settings-budget-competence" className="font-bold">
                  Competência:
                </label>
                <input
                  id="settings-budget-competence"
                  type="month"
                  value={selectedCompetence}
                  onChange={(e) => {
                    dirtyBudget.current.clear();
                    setSelectedCompetence(e.target.value);
                    setProposedRebalance(null);
                    setPreviewSignature(null);
                    setRebalanceMessage(null);
                  }}
                  className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                />
              </div>
              <label className="flex items-center gap-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyToFutureMonths}
                  onChange={(e) => {
                    setApplyToFutureMonths(e.target.checked);
                    setProposedRebalance(null);
                  }}
                />
                <span>Aplicar aos próximos meses</span>
              </label>
            </div>

            {applyToFutureMonths && futureScopePreview && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-[11px] flex flex-wrap items-center justify-between gap-2">
                <span>
                  {futureScopePreview.monthsToApply.length} mês(es) afetado(s).
                </span>
                {futureScopePreview.preservedApprovedMonths.length > 0 && (
                  <label className="flex items-center gap-1.5 font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overwriteApprovedFutureMonths}
                      onChange={(e) => setOverwriteApprovedFutureMonths(e.target.checked)}
                    />
                    <span>Substituir meses já aprovados</span>
                  </label>
                )}
              </div>
            )}

            {(rebalanceMessage || isInlinePreviewStale) && (
              <div
                role="alert"
                className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 text-amber-950 dark:text-amber-200 text-xs font-bold flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    {isInlinePreviewStale
                      ? 'Os dados desta competência mudaram. Recalcule a prévia antes de aprovar.'
                      : rebalanceMessage}
                  </span>
                </div>
                {isInlinePreviewStale && (
                  <button
                    type="button"
                    onClick={handleTriggerRebalance}
                    className="px-3 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-bold"
                  >
                    Recalcular
                  </button>
                )}
              </div>
            )}

            {rebalanceProposal && (
              <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-300 space-y-3 text-xs">
                <div className="flex items-center justify-between font-bold">
                  <span>
                    Proposta ({rebalanceProposal.competence}) —{' '}
                    {rebalanceProposal.status === 'feasible' ? 'Viável' : 'Inviável'}
                  </span>
                  <button type="button" onClick={() => setProposedRebalance(null)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p>{rebalanceProposal.explanation}</p>
                {rebalanceProposal.status === 'feasible' && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                    {(
                      Object.entries(rebalanceProposal.proposedPercentages) as [
                        DestinationKey,
                        number,
                      ][]
                    ).map(([key, newPct]) => (
                      <div
                        key={key}
                        className="p-2 rounded-xl bg-white dark:bg-slate-900 border text-center"
                      >
                        <span className="text-[10px] font-bold block truncate">
                          {DESTINATION_NAMES[key]}
                        </span>
                        <span className="font-black text-sm tabular-nums">{newPct}%</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setProposedRebalance(null)}
                    className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold"
                  >
                    Descartar
                  </button>
                  <button
                    type="button"
                    disabled={rebalanceProposal.status !== 'feasible' || isInlinePreviewStale}
                    onClick={handleApplyRebalance}
                    className="px-4 py-1.5 rounded-xl bg-amber-600 text-white font-bold disabled:opacity-50"
                  >
                    Confirmar e Aplicar
                  </button>
                </div>
              </div>
            )}

            {/* Table preserved for granular percentage/lock adjustments */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs text-left min-w-[640px]">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold uppercase text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Envelope</th>
                    <th className="py-3 px-3 text-center">Trava & (%)</th>
                    <th className="py-3 px-3">Valor</th>
                    <th className="py-3 px-3">Piso (R$)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {(
                    [
                      {
                        key: 'moradia' as DestinationKey,
                        label: 'Moradia',
                        pct: pctMoradia,
                        setPct: setPctMoradia,
                        val: valMoradia,
                        floor: pisoMoradia,
                        setFloor: setPisoMoradia,
                      },
                      {
                        key: 'transporte' as DestinationKey,
                        label: 'Transporte',
                        pct: pctTransporte,
                        setPct: setPctTransporte,
                        val: valTransporte,
                        floor: pisoTransporte,
                        setFloor: setPisoTransporte,
                      },
                      {
                        key: 'comida' as DestinationKey,
                        label: 'Comida',
                        pct: pctComida,
                        setPct: setPctComida,
                        val: valComida,
                        floor: pisoComida,
                        setFloor: setPisoComida,
                      },
                      {
                        key: 'lazer' as DestinationKey,
                        label: 'Lazer',
                        pct: pctLazer,
                        setPct: setPctLazer,
                        val: valLazer,
                        floor: pisoLazer,
                        setFloor: setPisoLazer,
                      },
                      {
                        key: 'protecao' as DestinationKey,
                        label: 'Proteção',
                        pct: pctProtecao,
                        setPct: setPctProtecao,
                        val: valProtecao,
                        floor: pisoProtecao,
                        setFloor: setPisoProtecao,
                      },
                      {
                        key: 'profissional' as DestinationKey,
                        label: 'Profissional',
                        pct: pctProfissional,
                        setPct: setPctProfissional,
                        val: valProfissional,
                        floor: pisoProfissional,
                        setFloor: setPisoProfissional,
                      },
                      {
                        key: 'investimentos' as DestinationKey,
                        label: 'Investimentos',
                        pct: pctInvestimentos,
                        setPct: setPctInvestimentos,
                        val: valInvestimentos,
                        floor: null,
                        setFloor: null,
                      },
                    ] as const
                  ).map((row) => (
                    <tr key={row.key}>
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                        {row.label}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Trava de ${row.label}`}
                            onClick={() => handleToggleDestinationLock(row.key)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border flex items-center gap-1 cursor-pointer ${
                              localLocks[row.key]
                                ? 'bg-amber-600 text-white border-amber-600'
                                : 'bg-white dark:bg-slate-900 text-slate-600 border-slate-300 dark:border-slate-700'
                            }`}
                          >
                            {localLocks[row.key] ? (
                              <Lock className="w-3 h-3" />
                            ) : (
                              <Unlock className="w-3 h-3" />
                            )}
                            <span>{localLocks[row.key] ? 'Travado' : 'Livre'}</span>
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={row.pct}
                            onChange={(e) => {
                              markBudgetDirty(
                                `pct.${row.key}`,
                                liveCompetenceSnapshot.currentPercentages[row.key] ?? 0
                              );
                              row.setPct(e.target.value === '' ? 0 : Number(e.target.value));
                            }}
                            className="w-16 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-center tabular-nums"
                          />
                          <span>%</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-bold tabular-nums">
                        {formatCurrency(row.val)}
                      </td>
                      <td className="py-3 px-3">
                        {row.floor !== null && row.setFloor ? (
                          <input
                            type="number"
                            step={100}
                            value={row.floor}
                            onChange={(e) => {
                              markBudgetDirty(
                                `floor.${row.key}`,
                                liveCompetenceSnapshot.floorsR$[row.key]
                              );
                              row.setFloor!(Number(e.target.value));
                            }}
                            className="w-24 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold tabular-nums"
                          />
                        ) : (
                          <span className="text-slate-500 tabular-nums">
                            Piso {pisoInvestimentosPct}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center justify-between">
              <span>Soma da distribuição por competência:</span>
              <span
                className={`tabular-nums ${
                  totalPercentagesSum === 100 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {totalPercentagesSum}%
              </span>
            </div>

            <BudgetRebalanceModal
              isOpen={isRebalanceModalOpen}
              onClose={() => setIsRebalanceModalOpen(false)}
              initialCompetence={selectedCompetence}
            />
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* BLOCO 3 — PARÂMETROS DO ESCUDO                                            */}
      {/* ========================================================================= */}
      {showBlock('escudo') && (
        <section className="space-y-5">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-lg font-extrabold font-display">
              Bloco 3 — Parâmetros do Escudo & Patrimônio
            </h3>
          </div>

          <div className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Parâmetros Patrimoniais & Calibração do Escudo
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Base essencial calculada sem Fixos Canceláveis:{' '}
                  <strong className="tabular-nums">
                    {formatCurrency(shieldMetrics.essentialMonthlyBase)}/mês
                  </strong>{' '}
                  · Piso 4m:{' '}
                  <strong className="tabular-nums">
                    {formatCurrency(shieldMetrics.shieldFloorAmount)}
                  </strong>{' '}
                  · Teto 10m:{' '}
                  <strong className="tabular-nums">
                    {formatCurrency(shieldMetrics.shieldTargetAmount)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSavePatrimonialParams()}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Salvar Parâmetros Patrimoniais</span>
              </button>
            </div>

            {patrimonialSectionError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-800 dark:text-rose-200 text-xs font-bold"
              >
                {patrimonialSectionError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="settings-expected-yield"
                  className="text-xs font-bold text-slate-800 dark:text-slate-200 block"
                >
                  Taxa Real Esperada (% a.a.)
                </label>
                <input
                  id="settings-expected-yield"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={expectedYield}
                  onChange={(e) => {
                    markProfileDirty('expectedYieldAnnual');
                    setExpectedYield(e.target.value);
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="settings-reserve-months"
                  className="text-xs font-bold text-slate-800 dark:text-slate-200 block"
                >
                  Meses de Reserva de Emergência
                </label>
                <input
                  id="settings-reserve-months"
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  value={reserveMonths}
                  onChange={(e) => {
                    markProfileDirty('emergencyReserveMonthsTarget');
                    setReserveMonths(e.target.value);
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="settings-shield-floor"
                  className="text-xs font-bold text-slate-800 dark:text-slate-200 block"
                >
                  Piso do Escudo (meses)
                </label>
                <input
                  id="settings-shield-floor"
                  type="number"
                  min="1"
                  max="24"
                  value={shieldFloorMonthsInput}
                  onChange={(e) => setShieldFloorMonthsInput(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="settings-shield-target"
                  className="text-xs font-bold text-slate-800 dark:text-slate-200 block"
                >
                  Teto do Escudo (meses)
                </label>
                <input
                  id="settings-shield-target"
                  type="number"
                  min="1"
                  max="36"
                  value={shieldTargetMonthsInput}
                  onChange={(e) => setShieldTargetMonthsInput(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold tabular-nums"
                />
              </div>
            </div>

            {/* Backup dos parâmetros patrimoniais */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
              <h5 className="font-bold text-slate-900 dark:text-white">
                Backup dos parâmetros patrimoniais
              </h5>
              <p className="text-slate-500 dark:text-slate-400">
                Exporte ou restaure apenas a taxa esperada e a meta de meses da reserva.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  className="underline font-bold cursor-pointer"
                  onClick={() => {
                    const blob = new Blob([serializeFinancialParametersBackup(state.profile)], {
                      type: 'application/json',
                    });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'junto-parametros.json';
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Exportar parâmetros
                </button>
                <label className="font-bold cursor-pointer">
                  Importar parâmetros
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="ml-2"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      setBackupPreview(null);
                      setBackupError(null);
                      if (!file) return;
                      if (file.size > 4096) {
                        setBackupError('Arquivo excede o limite de 4096 bytes.');
                        return;
                      }
                      try {
                        const preview = parseFinancialParametersBackup(await file.text());
                        backupBaseline.current = {
                          expectedYieldAnnual: state.profile.expectedYieldAnnual,
                          emergencyReserveMonthsTarget: state.profile.emergencyReserveMonthsTarget,
                        };
                        setBackupPreview(preview);
                      } catch {
                        setBackupError('Arquivo de parâmetros inválido.');
                      }
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
              {backupError && <p role="alert">{backupError}</p>}
              {backupPreview && (
                <div className="space-y-2">
                  <p className="font-bold">Revise antes de restaurar:</p>
                  {Object.entries(backupPreview).map(([key, value]) => (
                    <p key={key}>
                      {key === 'expectedYieldAnnual' ? 'Taxa esperada' : 'Meses de reserva'}:{' '}
                      {String(state.profile[key as keyof typeof state.profile] ?? 'não informado')} →{' '}
                      {String(value)}
                    </p>
                  ))}
                  <button
                    type="button"
                    className="underline font-bold"
                    onClick={() => {
                      const changed = Object.keys(backupPreview).some(
                        (key) =>
                          state.profile[key as keyof typeof state.profile] !==
                          backupBaseline.current[key]
                      );
                      if (changed) {
                        setBackupError(
                          'Os parâmetros mudaram desde a prévia. Importe o arquivo novamente para revisar.'
                        );
                        return;
                      }
                      if (Object.keys(backupPreview).some((key) => key in (headerConflicts || {}))) {
                        setBackupError('Resolva o conflito do parâmetro antes de restaurar.');
                        return;
                      }
                      const result = patchCoupleProfile(backupPreview);
                      if (!result.valid) {
                        setBackupError(result.errors.join(' '));
                        return;
                      }
                      setBackupPreview(null);
                      setSaveSuccessMsg(true);
                    }}
                  >
                    Confirmar restauração
                  </button>
                  <button
                    type="button"
                    className="underline ml-4"
                    onClick={() => setBackupPreview(null)}
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* BLOCO 4 — PERFIL MÉDICO & REGRAS CSV                                     */}
      {/* ========================================================================= */}
      {showBlock('medico') && (
        <section className="space-y-5">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Stethoscope className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <h3 className="text-lg font-extrabold font-display">
              Bloco 4 — Perfil Médico, Plantões & Regras CSV
            </h3>
          </div>

          <MedicalCareerSettings />

          {/* Imposto padrão & Hospitais Favoritos */}
          <div className="clay-card bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Alíquota Padrão de Plantões & Hospitais Favoritos
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Desconto tributário padrão aplicado automaticamente na competência dos plantões.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveMedicalTax()}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold cursor-pointer"
              >
                Salvar Alíquota
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Imposto Médio sobre Plantões (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={45}
                  step={0.5}
                  value={defaultShiftTaxPct}
                  onChange={(e) => setDefaultShiftTaxPct(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Adicionar Hospital / Instituição Favorita
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newHospitalInput}
                    onChange={(e) => setNewHospitalInput(e.target.value)}
                    placeholder="Ex: Hospital das Clínicas"
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddHospital()}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(v23Preferences.favoriteHospitals || []).map((hosp) => (
                <span
                  key={hosp}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  <span>{hosp}</span>
                  <button
                    type="button"
                    onClick={() => void handleRemoveHospital(hosp)}
                    aria-label={`Remover ${hosp}`}
                    className="text-slate-400 hover:text-rose-500 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Importador CSV Client-Side */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-emerald-600" />
                Central CSV / OFX 100% Client-Side
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Classifica nos 4 destinos do Protocolo B.4 sem sair do navegador e oculta automaticamente descrições com CPF/nomes do casal em lançamentos privados.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAddingAccount(true)}
              className="btn-accent min-h-[44px] px-4 py-2 text-xs font-bold cursor-pointer"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Importar CSV / Extrato</span>
            </button>
          </div>

          {/* Regras de Palavras-Chave CSV */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-amber-600" />
              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                Regras de Palavras-Chave CSV
              </h4>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300 block">
                Testador de Estabelecimento:
              </span>
              <input
                type="text"
                value={testDescription}
                onChange={(e) => setTestDescription(e.target.value)}
                placeholder="Ex: UBER *TRIP SP ou NETFLIX..."
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold"
              />
              {testMatch && testDescription && (
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 font-bold">
                  Resultado: {testMatch.category} ({testMatch.subcategory || 'geral'})
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 items-end text-xs">
              <div className="flex-1 min-w-[140px]">
                <label className="text-[11px] font-bold text-slate-500 block">Palavra-chave</label>
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="Ex: GYMPASS"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 uppercase font-bold"
                />
              </div>
              <div className="w-36">
                <label className="text-[11px] font-bold text-slate-500 block">Categoria</label>
                <select
                  value={newKeyCategory}
                  onChange={(e) => setNewKeyCategory(e.target.value as CategoryKey)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                >
                  {(Object.keys(CATEGORIES_BASE) as CategoryKey[]).map((k) => (
                    <option key={k} value={k}>
                      {CATEGORIES_BASE[k].name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-36">
                <label className="text-[11px] font-bold text-slate-500 block">Subcategoria</label>
                <input
                  type="text"
                  value={newKeySubcat}
                  onChange={(e) => setNewKeySubcat(e.target.value)}
                  placeholder="Ex: academia"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <button
                type="button"
                onClick={handleAddKeyword}
                className="btn-accent min-h-[38px] px-4 py-2 text-xs font-bold cursor-pointer"
              >
                + Adicionar Regra
              </button>
            </div>

            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pt-1">
              {keywordRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs border border-slate-200 dark:border-slate-700"
                >
                  <span className="font-bold text-slate-900 dark:text-white">{rule.keyword}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300 capitalize">
                    {rule.category}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeKeywordRule(rule.id)}
                    className="ml-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {detectedSubscriptions.length > 0 && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Assinaturas Detectadas ({detectedSubscriptions.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {detectedSubscriptions.map((sub) => (
                    <div
                      key={sub.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <strong className="block">{sub.merchant}</strong>
                        <span className="text-slate-500 tabular-nums">
                          {formatCurrency(sub.amount)}/mês · Fora da Reserva
                        </span>
                      </div>
                      {sub.status !== 'active' && (
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => confirmSubscriptionAsExpense(sub.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => dismissSubscription(sub.id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 font-bold"
                          >
                            Ignorar
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Notificações & PWA */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-emerald-600" />
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Notificações & App Instalável (PWA)
                </h4>
              </div>
              <div className="flex items-center gap-2">
                {getBrowserPermissionStatus() !== 'granted' && (
                  <button
                    type="button"
                    onClick={async () => {
                      const status = await requestPushPermission();
                      updatePushSettings({ permissionStatus: status });
                      if (status === 'granted') triggerCelebration();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                  >
                    Ativar Push
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    const sent = await sendTestNotification();
                    setPushStatusMsg(
                      sent
                        ? 'Notificação de teste enviada!'
                        : 'Ative a permissão de notificações primeiro.'
                    );
                    setTimeout(() => setPushStatusMsg(null), 4000);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold cursor-pointer"
                >
                  Testar Notificação
                </button>
              </div>
            </div>
            {pushStatusMsg && (
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                {pushStatusMsg}
              </p>
            )}
            <PWAInstallButton variant="banner" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <label className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between cursor-pointer">
                <span className="font-bold">Fechamento do Dia & Plantões (18:00)</span>
                <input
                  type="checkbox"
                  checked={pushSettings.dailyTriageEnabled}
                  onChange={(e) => updatePushSettings({ dailyTriageEnabled: e.target.checked })}
                />
              </label>
              <label className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between cursor-pointer">
                <span className="font-bold">Alertas de Teto (Moradia / Parcelas)</span>
                <input
                  type="checkbox"
                  checked={pushSettings.categoryAlertsEnabled}
                  onChange={(e) => updatePushSettings({ categoryAlertsEnabled: e.target.checked })}
                />
              </label>
            </div>
          </div>
        </section>
      )}

      {/* Confirmation Modal: Zerar Conta */}
      {showClearDataModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div
            className="absolute inset-0"
            onClick={() => !isClearingData && setShowClearDataModal(false)}
          />
          <div className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-rose-300 dark:border-rose-900/60 p-6 space-y-4">
            <h3 className="font-black text-lg text-slate-900 dark:text-white">
              Apagar Todo o Conteúdo Atual da Conta?
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Todos os lançamentos, parcelas e extratos importados serão removidos, preservando seus parâmetros da cascata e regras CSV.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isClearingData}
                onClick={() => setShowClearDataModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isClearingData}
                onClick={() => void handleConfirmClearData()}
                className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isClearingData ? 'Apagando...' : 'Sim, Apagar Conteúdo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddingAccount && (
        <BankSyncModal isOpen={isAddingAccount} onClose={() => setIsAddingAccount(false)} />
      )}
    </div>
  );
};
