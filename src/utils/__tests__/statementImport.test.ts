import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  collectExistingImportHashes,
  computeImportHash,
  decodeStatementBytes,
  parseCsvStatementV23,
  parseStatement,
  type StagedCsvTransaction,
} from '../statementImport';
import {
  confirmStagedTransactionRoute,
  type PersistenceWriter,
} from '../../lib/v23Persistence';
import type {
  AllowanceExpense,
  HouseholdConfig,
  HouseholdTransaction,
  InstallmentPlan,
  MedicalShiftRecord,
  SharedAllowanceExpense,
} from '../../types/finance';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

describe('statementImport v2.3: Parser CSV 100% Client-Side & Protocolo B.4', () => {
  it('1. diferencia Conta Corrente vs Fatura Cartão (inversão de sinal), suporta presets BR, ISO-8859-1 e ignora coluna Saldo', async () => {
    // 1A) Nubank Conta Corrente (negativo = despesa, positivo = entrada)
    const nubankContaCsv = [
      'Data,Valor,Identificador,Descrição',
      '10/11/2026,-45.90,id-1,Uber Trip',
      '11/11/2026,2500.00,id-2,Transferência recebida',
    ].join('\n');

    const contaRes = await parseCsvStatementV23({
      textOrBytes: nubankContaCsv,
      uid: 'uid-a',
      statementMode: 'checking',
    });

    expect(contaRes.detectedPreset).toBe('nubank_conta');
    expect(contaRes.staged).toHaveLength(2);
    expect(contaRes.staged[0]).toMatchObject({
      date: '2026-11-10',
      amount: 45.9,
      type: 'expense',
    });
    expect(contaRes.staged[1]).toMatchObject({
      date: '2026-11-11',
      amount: 2500,
      type: 'income',
    });

    // 1B) Nubank Fatura Cartão (positivo = despesa, negativo = estorno/pagamento)
    const nubankCartaoCsv = [
      'date,title,amount',
      '2026-11-12,Supermercado Zona Sul,320.45',
      '2026-11-13,Estorno IOF,-12.50',
    ].join('\n');

    const cartaoRes = await parseCsvStatementV23({
      textOrBytes: nubankCartaoCsv,
      uid: 'uid-a',
      statementMode: 'credit_card',
    });

    expect(cartaoRes.detectedPreset).toBe('nubank_cartao');
    expect(cartaoRes.staged[0]).toMatchObject({
      amount: 320.45,
      type: 'expense',
      suggestedBucket: 'groceries',
    });
    expect(cartaoRes.staged[1]).toMatchObject({
      amount: 12.5,
      type: 'income',
    });

    // 1C) Itaú / Inter com ponto e vírgula, moeda BR e coluna Saldo ignorada + ISO-8859-1
    const latin1Text = 'Data Lançamento;Histórico;Descrição;Valor;Saldo\n15/11/26;Compra Débito;Farmácia São João;-R$ 1.250,90;R$ 9.500,00\n';
    const latin1Bytes = Uint8Array.from(
      Array.from(latin1Text).map((ch) => ch.charCodeAt(0) & 0xff)
    );
    expect(decodeStatementBytes(latin1Bytes)).toContain('Farmácia São João');

    const interRes = await parseCsvStatementV23({
      textOrBytes: latin1Bytes,
      uid: 'uid-a',
      statementMode: 'checking',
    });

    expect(interRes.detectedPreset).toBe('inter');
    expect(interRes.staged[0]).toMatchObject({
      date: '2026-11-15',
      amount: 1250.9,
      type: 'expense',
    });

    // 1D) Bradesco com colunas separadas Crédito e Débito
    const bradescoCsv = [
      'Data;Histórico;Docto.;Crédito (R$);Débito (R$);Saldo (R$)',
      '16/11/2026;Depósito Hospital;123;1.800,00;;5.000,00',
      '16/11/2026;Condomínio Edifício;456;;950,00;4.050,00',
    ].join('\n');

    const bradescoRes = await parseCsvStatementV23({
      textOrBytes: bradescoCsv,
      uid: 'uid-a',
      statementMode: 'checking',
    });

    expect(bradescoRes.detectedPreset).toBe('bradesco');
    expect(bradescoRes.staged[0]).toMatchObject({ amount: 1800, type: 'income' });
    expect(bradescoRes.staged[1]).toMatchObject({
      amount: 950,
      type: 'expense',
      suggestedBucket: 'housing',
    });
  });

  it('2. filtra automaticamente Pix entre o casal (memberTaxIds) e Pagamento de Fatura', async () => {
    const csv = [
      'data;descrição;valor',
      '10/11/2026;Pix enviado para Maria Silva ***.456.789-**;-1200,00',
      '11/11/2026;PGTO FATURA NUBANK;-3400,00',
      '12/11/2026;Pão de Açúcar;-210,00',
    ].join('\n');

    const res = await parseCsvStatementV23({
      textOrBytes: csv,
      uid: 'uid-a',
      statementMode: 'checking',
      householdConfig: {
        memberTaxIds: ['123.456.789-00', 'Maria Silva'],
      },
    });

    expect(res.summary.couplePixExcludedCount).toBe(1);
    expect(res.summary.invoicePaymentExcludedCount).toBe(1);
    expect(res.staged[0]).toMatchObject({
      autoExcluded: true,
      exclusionReason: 'couple_pix',
      exclusionLabel: 'Pix entre o casal',
      suggestedDestination: 'internal',
    });
    expect(res.staged[1]).toMatchObject({
      autoExcluded: true,
      exclusionReason: 'invoice_payment',
      exclusionLabel: 'Pagamento de fatura',
      suggestedDestination: 'internal',
    });
    expect(res.staged[2]).toMatchObject({
      autoExcluded: false,
      suggestedDestination: 'house_routine',
      suggestedBucket: 'groceries',
    });
  });

  it('3. detecta parcelamentos XX/YY gerando rascunho de InstallmentPlan futuro sem confundir com datas', async () => {
    const csv = [
      'date,title,amount',
      '2026-11-18,Notebook Apple 02/10,650.00',
      '2026-11-19,Compra em 15/11/2026 Padaria,35.00',
    ].join('\n');

    const res = await parseCsvStatementV23({
      textOrBytes: csv,
      uid: 'uid-a',
      statementMode: 'credit_card',
    });

    expect(res.summary.installmentsDetectedCount).toBe(1);
    const instItem = res.staged[0];
    expect(instItem.installment).toBeDefined();
    expect(instItem.installment?.cleanTitle).toBe('Notebook Apple');
    expect(instItem.installment?.currentInstallment).toBe(2);
    expect(instItem.installment?.totalInstallments).toBe(10);
    expect(instItem.installment?.draft).toMatchObject({
      title: 'Notebook Apple',
      installmentAmount: 650,
      currentInstallment: 2,
      totalInstallments: 10,
      startCycleId: '2026_10',
      endCycleId: '2027_07',
    });

    expect(res.staged[1].installment).toBeUndefined();
  });

  it('4. deduplica via importHash entre os 4 ledgers (transactions, shared_allowance, allowance_expenses, installment_plans)', async () => {
    const uid = 'uid-a';
    const hashTx = await computeImportHash(uid, '2026-11-05', 180, 'Supermercado');
    const hashShared = await computeImportHash(uid, '2026-11-06', 140, 'Cinema IMAX');
    const hashSolo = await computeImportHash(uid, '2026-11-07', 95, 'Steam Games');
    const hashPlan = await computeImportHash(uid, '2026-11-08', 300, 'Sofa 03/06');

    const existingTransactions: Partial<HouseholdTransaction>[] = [{ importHash: hashTx }];
    const existingShared: Partial<SharedAllowanceExpense>[] = [{ importHash: hashShared }];
    const existingSolo: Partial<AllowanceExpense>[] = [{ importHash: hashSolo }];
    const existingPlans: Partial<InstallmentPlan>[] = [{ importHash: hashPlan }];

    const collected = await collectExistingImportHashes({
      uid,
      transactions: existingTransactions,
      sharedAllowanceExpenses: existingShared,
      allowanceExpenses: existingSolo,
      installmentPlans: existingPlans,
    });
    expect(collected.hashSet.size).toBe(4);

    const csv = [
      'data;descrição;valor',
      '05/11/2026;Supermercado;-180,00',
      '06/11/2026;Cinema IMAX;-140,00',
      '07/11/2026;Steam Games;-95,00',
      '08/11/2026;Sofa 03/06;-300,00',
      '09/11/2026;Padaria Nova;-22,50',
      '09/11/2026;Padaria Nova;-22,50', // duplicata no mesmo arquivo
    ].join('\n');

    const res = await parseCsvStatementV23({
      textOrBytes: csv,
      uid,
      statementMode: 'checking',
      existingRecords: {
        transactions: existingTransactions,
        sharedAllowanceExpenses: existingShared,
        allowanceExpenses: existingSolo,
        installmentPlans: existingPlans,
      },
    });

    expect(res.staged[0]).toMatchObject({ isDuplicate: true, duplicateSource: 'transactions' });
    expect(res.staged[1]).toMatchObject({ isDuplicate: true, duplicateSource: 'shared_allowance' });
    expect(res.staged[2]).toMatchObject({ isDuplicate: true, duplicateSource: 'allowance_expenses' });
    expect(res.staged[3]).toMatchObject({ isDuplicate: true, duplicateSource: 'installment_plans' });
    expect(res.staged[4]).toMatchObject({ isDuplicate: false });
    expect(res.staged[5]).toMatchObject({ isDuplicate: true, duplicateSource: 'same_file' });
    expect(res.summary.duplicateCount).toBe(5);
  });

  it('5. BLINDAGEM DE PRIVACIDADE: Mesada — Só Minha grava apenas em /users/{uid}/ e valida limite de 50% do piso em parcelas', async () => {
    const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
    const mockWriter: PersistenceWriter = {
      getDocData: async () => null,
      setDocData: async (path, data) => {
        writes.push({ path, data });
      },
    };

    const householdConfig: Partial<HouseholdConfig> = {
      allowanceFloor: 600, // 50% = R$ 300
    };

    const soloStaged: StagedCsvTransaction = {
      stagingId: 'st-1',
      lineNumber: 2,
      date: '2026-11-20',
      cycleId: '2026_11',
      description: 'Fone Bluetooth',
      normalizedDescription: 'fone bluetooth',
      amount: 250,
      type: 'expense',
      importHash: 'hash-solo-250',
      isDuplicate: false,
      autoExcluded: false,
      suggestedDestination: 'solo_allowance',
      suggestedBucket: 'routine',
      accountLabel: 'Nubank',
      presetUsed: 'nubank_cartao',
    };

    const result = await confirmStagedTransactionRoute({
      staged: soloStaged,
      destination: 'solo_allowance',
      uid: 'uid-medico-1',
      householdId: 'hh-casal-1',
      householdConfig,
      writer: mockWriter,
    });

    expect(result.writtenPaths).toHaveLength(2);
    expect(result.writtenPaths.every((p) => p.startsWith('users/uid-medico-1/'))).toBe(true);
    expect(result.writtenPaths.some((p) => p.includes('households/'))).toBe(false);
    expect(writes[0].path).toMatch(/^users\/uid-medico-1\/allowance_expenses\//);
    expect(writes[1].path).toBe('users/uid-medico-1/allowance_wallets/2026_11');
    expect(writes[1].data).toMatchObject({
      soloSpent: 250,
      monthlyAllocation: 600,
      closingBalance: 350,
    });

    // Parcela pessoal acima de 50% do allowanceFloor (R$ 350 > R$ 300) deve ser bloqueada sem gravar nada
    const writesBlocked: string[] = [];
    const overLimitStaged: StagedCsvTransaction = {
      ...soloStaged,
      amount: 350,
      installment: {
        currentInstallment: 1,
        totalInstallments: 4,
        cleanTitle: 'Relógio Esportivo',
        draft: {
          title: 'Relógio Esportivo',
          installmentAmount: 350,
          currentInstallment: 1,
          totalInstallments: 4,
          startCycleId: '2026_11',
          endCycleId: '2027_02',
          importHash: 'hash-over-limit',
        },
      },
    };

    await expect(
      confirmStagedTransactionRoute({
        staged: overLimitStaged,
        destination: 'solo_allowance',
        uid: 'uid-medico-1',
        householdId: 'hh-casal-1',
        householdConfig,
        writer: {
          getDocData: async () => null,
          setDocData: async (path) => {
            writesBlocked.push(path);
          },
        },
      })
    ).rejects.toThrow(/50% do piso da mesada/i);
    expect(writesBlocked).toHaveLength(0);
  });

  it('6. confirma destinos Casa & Rotina (com InstallmentPlan), Mesada — Dos Dois (50/50) e conciliação de Plantão via Interno', async () => {
    const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
    const mockWriter: PersistenceWriter = {
      getDocData: async () => null,
      setDocData: async (path, data) => {
        writes.push({ path, data });
      },
    };

    // Casa & Rotina + Parcela XX/YY
    const houseRes = await confirmStagedTransactionRoute({
      staged: {
        stagingId: 'st-house',
        lineNumber: 2,
        date: '2026-11-10',
        cycleId: '2026_11',
        description: 'Geladeira Inox 02/10',
        normalizedDescription: 'geladeira inox 02/10',
        amount: 400,
        type: 'expense',
        importHash: 'hash-house-400',
        isDuplicate: false,
        autoExcluded: false,
        suggestedDestination: 'house_routine',
        suggestedBucket: 'housing',
        installment: {
          currentInstallment: 2,
          totalInstallments: 10,
          cleanTitle: 'Geladeira Inox',
          draft: {
            title: 'Geladeira Inox',
            installmentAmount: 400,
            currentInstallment: 2,
            totalInstallments: 10,
            startCycleId: '2026_10',
            endCycleId: '2027_07',
            importHash: 'hash-house-400',
          },
        },
        accountLabel: 'Itaú',
        presetUsed: 'itau',
      },
      destination: 'house_routine',
      bucket: 'housing',
      uid: 'uid-a',
      householdId: 'hh-1',
      writer: mockWriter,
    });

    expect(houseRes.writtenPaths).toEqual([
      'households/hh-1/transactions/tx_hash-house-400',
      'households/hh-1/installment_plans/plan_hash-house-400',
    ]);

    // Mesada — Dos Dois (50/50)
    const sharedRes = await confirmStagedTransactionRoute({
      staged: {
        stagingId: 'st-shared',
        lineNumber: 3,
        date: '2026-11-11',
        cycleId: '2026_11',
        description: 'Jantar Japonês',
        normalizedDescription: 'jantar japones',
        amount: 260,
        type: 'expense',
        importHash: 'hash-shared-260',
        isDuplicate: false,
        autoExcluded: false,
        suggestedDestination: 'shared_allowance',
        suggestedBucket: 'routine',
        accountLabel: 'Nubank',
        presetUsed: 'nubank_cartao',
      },
      destination: 'shared_allowance',
      sharedCategory: 'jantar',
      uid: 'uid-a',
      householdId: 'hh-1',
      writer: mockWriter,
    });

    expect(sharedRes.writtenPaths).toContain(
      'households/hh-1/shared_allowance_expenses/shared_hash-shared-260'
    );
    expect(sharedRes.sharedAllowanceExpense?.splitPerPartner).toBe(130);

    // Interno vinculando credito a plantao pending_payment -> marca paid e recalcula BudgetCycle
    const shifts: MedicalShiftRecord[] = [
      {
        id: 'shift-1',
        doctorUid: 'uid-a',
        institution: 'Hospital Albert Einstein',
        shiftDate: '2026-10-20',
        hours: 12,
        grossAmount: 2000,
        netAmount: 1880,
        status: 'pending_payment',
        expectedPayDate: '2026-11-20',
        paidAt: null,
      },
    ];

    const internalRes = await confirmStagedTransactionRoute({
      staged: {
        stagingId: 'st-shift',
        lineNumber: 4,
        date: '2026-11-20',
        cycleId: '2026_11',
        description: 'TED HOSPITAL ALBERT EINSTEIN',
        normalizedDescription: 'ted hospital albert einstein',
        amount: 1880,
        type: 'income',
        importHash: 'hash-shift-1880',
        isDuplicate: false,
        autoExcluded: false,
        suggestedDestination: 'internal',
        suggestedBucket: 'routine',
        accountLabel: 'Itaú',
        presetUsed: 'itau',
      },
      destination: 'internal',
      uid: 'uid-a',
      householdId: 'hh-1',
      reconcileShiftId: 'shift-1',
      existingShifts: shifts,
      writer: mockWriter,
    });

    expect(internalRes.reconciledShift?.status).toBe('paid');
    expect(internalRes.reconciledShift?.paidAt).toBe('2026-11-20');
    expect(internalRes.updatedBudgetCycle?.newNetIncome).toBe(1880);
    expect(internalRes.writtenPaths).toEqual([
      'households/hh-1/shifts/shift-1',
      'households/hh-1/budget_cycles/2026_11',
    ]);
  });

  it('mantém compatibilidade com parseStatement OFX por FITID', async () => {
    const ofx = `
<OFX>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261015120000
<TRNAMT>1000.00
<FITID>202610150001
<MEMO>Transferencia Recebida
</STMTTRN>
</OFX>`;
    const report = await parseStatement(ofx, 'Nubank', 'both');
    expect(report.acceptedCount).toBe(1);
    expect(report.accepted[0].fitid).toBe('202610150001');
  });
});
