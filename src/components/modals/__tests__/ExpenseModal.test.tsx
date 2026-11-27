import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseModal } from '../ExpenseModal';

const actions = vi.hoisted(() => ({
  addCascadeTransaction: vi.fn().mockResolvedValue(undefined),
  editExpense: vi.fn(),
  simulateInstallment: vi.fn().mockReturnValue({
    verdict: 'approved',
    monthlyInstallment: 33.34,
    projectedInstallmentRatio: 0.08,
    allowanceReductionPerPartner: 16.67,
    payoffCycleId: '2026-12',
    reason: 'Dentro da faixa saudável (<= 15% da renda 3M).',
  }),
}));

const financeState = vi.hoisted(() => ({
  profile: { partner1Name: 'Ana', partner2Name: 'Bia', partner1Income: 5000, partner2Income: 5000 },
  piggyBanks: [],
  currentMonth: '2026-10',
}));

vi.mock('../../../context/FinanceContext', () => ({
  useFinance: () => ({
    state: financeState,
    currentUser: null,
    householdConfig: {
      allowanceFloor: 600,
    },
    ...actions,
  }),
}));

describe('ExpenseModal v2.3 (1-screen cascade entry)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('restores a saved draft and keeps subsequent edits live in localStorage', () => {
    localStorage.setItem(
      'expense_modal_draft_guest',
      JSON.stringify({
        amount: '42.50',
        description: 'Rascunho mercado',
        destination: 'house_routine',
        bucket: 'groceries',
      })
    );
    render(<ExpenseModal isOpen onClose={() => {}} />);

    expect(screen.getByPlaceholderText('0,00')).toHaveValue(42.5);
    expect(screen.getByLabelText('Descrição')).toHaveValue('Rascunho mercado');

    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '75.25' } });
    expect(screen.getByPlaceholderText('0,00')).toHaveValue(75.25);
    expect(JSON.parse(localStorage.getItem('expense_modal_draft_guest')!).amount).toBe('75.25');
  });

  it('records a single Casa & Rotina cascade transaction without installments', async () => {
    const onClose = vi.fn();
    render(<ExpenseModal isOpen onClose={onClose} defaultDate="2026-10-27" />);

    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '100.01' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Supermercado' } });
    fireEvent.click(screen.getByRole('button', { name: /Compra do Mês/i }));
    fireEvent.click(screen.getByRole('button', { name: /Registrar Lançamento/i }));

    await waitFor(() => {
      expect(actions.addCascadeTransaction).toHaveBeenCalledOnce();
    });
    expect(actions.addCascadeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'house_routine',
        title: 'Supermercado',
        amount: 100.01,
        date: '2026-10-27',
        bucket: 'groceries',
        installmentsCount: 1,
      })
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('toggles Compra Parcelada, simulates impact, and registers installment transaction when approved', async () => {
    const onClose = vi.fn();
    render(<ExpenseModal isOpen onClose={onClose} defaultDate="2026-10-27" />);

    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Airfryer' } });
    fireEvent.click(screen.getByRole('switch'));

    fireEvent.change(screen.getByLabelText('Número de parcelas'), { target: { value: '4' } });

    expect(actions.simulateInstallment).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseAmount: 300,
        installmentsCount: 4,
        scope: 'house',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /Registrar Lançamento/i }));

    await waitFor(() => {
      expect(actions.addCascadeTransaction).toHaveBeenCalledOnce();
    });
    expect(actions.addCascadeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'house_routine',
        title: 'Airfryer',
        amount: 300,
        installmentsCount: 4,
      })
    );
  });

  it('blocks submission when installment simulator returns verdict blocked', () => {
    actions.simulateInstallment.mockReturnValueOnce({
      verdict: 'blocked',
      monthlyInstallment: 1200,
      projectedInstallmentRatio: 0.25,
      allowanceReductionPerPartner: 600,
      payoffCycleId: '2027-02',
      reason: 'Excede o teto de 20% da média de renda 3M.',
    });

    render(<ExpenseModal isOpen onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '3600' } });
    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByRole('status')).toHaveTextContent('Excede o teto de 20%');
    expect(screen.getByRole('button', { name: /Registrar Lançamento/i })).toBeDisabled();
    expect(actions.addCascadeTransaction).not.toHaveBeenCalled();
  });
});
