import { describe, expect, it } from 'vitest';
import {
  calculateShieldMetrics,
  routeMonthlyInvestments,
  simulateBigPurchase,
} from '../shieldEngine';
import { evaluateWaterfall } from '../waterfallEngine';
import type { Goal } from '../../types/finance';

const tijucaCycleSample = {
  housingTotal: 4500,
  essentialFixedTotal: 1750,
  cancelableFixedTotal: 250, // DEVE ser excluído da base da reserva
  installmentsTotal: 2100,
  groceriesBudget: 1800,
  routineBudget: 1100,
  unexpectedBufferLimit: 500,
  unexpectedBufferSpent: 500,
};

const sampleGoals: Goal[] = [
  {
    id: 'goal-shield',
    title: 'Escudo de Emergência',
    pillar: 'shield',
    targetAmount: 117500,
    currentAmount: 50000,
    autoAllocateWeight: 50,
  },
  {
    id: 'goal-dreams',
    title: 'Carro / Apartamento',
    pillar: 'dreams',
    targetAmount: 100000,
    currentAmount: 20000,
    autoAllocateWeight: 30,
  },
  {
    id: 'goal-wealth',
    title: 'Independência Financeira',
    pillar: 'wealth',
    targetAmount: 1000000,
    currentAmount: 30000,
    autoAllocateWeight: 20,
  },
];

describe('shieldEngine (Protocolos C.0 e C.1)', () => {
  it('Escudo C.1: exclui R$ 250 de canceláveis da base (R$ 11.750/mês -> chão 4m R$ 47.000, teto 10m R$ 117.500, gordura R$ 70.500)', () => {
    const metrics = calculateShieldMetrics({
      cycles: [tijucaCycleSample, tijucaCycleSample, tijucaCycleSample],
      currentShieldBalance: 117500,
      shieldFloorMonths: 4,
      shieldTargetMonths: 10,
      monthlyNetYieldRate: 0.0085,
    });

    expect(metrics.essentialMonthlyBase).toBe(11750);
    expect(metrics.shieldFloorAmount).toBe(47000);
    expect(metrics.shieldTargetAmount).toBe(117500);
    expect(metrics.usableFatAmount).toBe(70500);
    expect(metrics.currentCoverageMonths).toBe(10);
    expect(metrics.estimatedMonthlyYield).toBe(998.75);
    expect(metrics.isFloorSecured).toBe(true);
    expect(metrics.isTankFull).toBe(true);
  });

  it('Corta aportes do Escudo automaticamente ao atingir 10 meses e redistribui entre Sonhos e Patrimônio', () => {
    const fullShield = calculateShieldMetrics({
      cycles: [tijucaCycleSample],
      currentShieldBalance: 117500,
      shieldFloorMonths: 4,
      shieldTargetMonths: 10,
    });

    const routing = routeMonthlyInvestments({
      mandatoryGoalAmount: 2600,
      optionalSurplusToInvest: 2400, // Total R$ 5.000
      goals: sampleGoals,
      shieldMetrics: fullShield,
    });

    expect(routing.didCutShieldForFullTank).toBe(true);
    expect(routing.byPillar.shield).toBe(0);
    // Pesos restantes: dreams=30, wealth=20 (3/5 e 2/5 de 5000 = 3000 e 2000)
    expect(routing.byPillar.dreams).toBe(3000);
    expect(routing.byPillar.wealth).toBe(2000);
    expect(routing.projectedShieldBalanceAfter).toBe(117500);
  });

  it('Preenche exatamente até o teto de 10 meses e transborda o excedente no mesmo ciclo para Sonhos e Patrimônio', () => {
    const almostFullShield = calculateShieldMetrics({
      cycles: [tijucaCycleSample],
      currentShieldBalance: 116500, // Faltam apenas R$ 1.000 para os R$ 117.500
      shieldFloorMonths: 4,
      shieldTargetMonths: 10,
    });

    // Total R$ 5.000: base 50/30/20 alocaria 2.500 para shield, mas só cabem 1.000!
    // Excedente de 1.500 transborda 60/40 (30:20) -> +900 dreams, +600 wealth
    const routing = routeMonthlyInvestments({
      mandatoryGoalAmount: 2600,
      optionalSurplusToInvest: 2400,
      goals: sampleGoals,
      shieldMetrics: almostFullShield,
    });

    expect(routing.didCutShieldForFullTank).toBe(false);
    expect(routing.byPillar.shield).toBe(1000);
    expect(routing.shieldOverflowRedirected).toBe(1500);
    expect(routing.byPillar.dreams).toBe(2400); // 1500 base + 900 overflow
    expect(routing.byPillar.wealth).toBe(1600); // 1000 base + 600 overflow
    expect(routing.projectedShieldBalanceAfter).toBe(117500);
    expect(routing.projectedShieldTankFullAfter).toBe(true);
  });

  it('Simulador "Posso Comprar?": cenário Verde (carro cabe com folga na entrada e nos tetos)', () => {
    const waterfall = evaluateWaterfall({
      householdConfig: { allowanceFloor: 600, allowanceCap: 3200 },
      liquidity: { settledIncomesTotal: 26000 },
      housingTotal: 4500,
      essentialFixedTotal: 1750,
      cancelableFixedTotal: 250,
      installmentsTotal: 1000,
      groceriesAmount: 1800,
      routineAmount: 1100,
      bufferAmount: 500, // Estrutura base = 10.900
    });

    const shield = calculateShieldMetrics({
      cycles: [{ ...tijucaCycleSample, installmentsTotal: 1000 }],
      currentShieldBalance: 80000, // Chão 4m = 42.600 -> gordura = 37.400
    });

    const sim = simulateBigPurchase({
      assetType: 'car',
      totalPrice: 70000,
      downPayment: 35000,
      installmentsCount: 36,
      monthlyInterestRate: 0.01,
      amortizationSystem: 'price',
      monthlyHiddenCosts: 800,
      currentGoalSavedAmount: 20000, // + 37.400 gordura = 57.400 disponível
      shieldMetrics: shield,
      waterfallResult: waterfall,
    });

    // Financiado: 35.000 em 36x a 1% = ~R$ 1.162,50 -> parcelas totais 2.162,50 (8,3% <= 15%)
    // Estrutura total ~ 10.900 + 1.162,50 + 800 = 12.862,50 (49,5% <= 60%)
    expect(sim.verdict).toBe('green');
    expect(sim.downPaymentGap).toBe(0);
    expect(sim.monthsToSaveDownPayment).toBe(0);
    expect(sim.violations).toHaveLength(0);
  });

  it('Simulador "Posso Comprar?": cenário Amarelo (tetos OK, falta entrada viável em X meses)', () => {
    const waterfall = evaluateWaterfall({
      householdConfig: { allowanceFloor: 600, allowanceCap: 3200 },
      liquidity: { settledIncomesTotal: 26000 },
      housingTotal: 4500,
      essentialFixedTotal: 1750,
      cancelableFixedTotal: 250,
      installmentsTotal: 2100,
      groceriesAmount: 1800,
      routineAmount: 1100,
      bufferAmount: 500, // Poupança mensal = 2600 (10%) + 5000 (sobra) = 7600/mês
    });

    const shield = calculateShieldMetrics({
      cycles: [tijucaCycleSample],
      currentShieldBalance: 60000, // Chão = 47.000 -> gordura = 13.000
    });

    const sim = simulateBigPurchase({
      assetType: 'trip',
      totalPrice: 35000,
      downPayment: 35000, // Viagem à vista; disponível = 10.000 meta + 13.000 gordura = 23.000 -> falta 12.000
      installmentsCount: 0,
      monthlyInterestRate: 0,
      amortizationSystem: 'price',
      monthlyHiddenCosts: 0,
      currentGoalSavedAmount: 10000,
      shieldMetrics: shield,
      waterfallResult: waterfall,
    });

    expect(sim.verdict).toBe('yellow');
    expect(sim.downPaymentGap).toBe(12000);
    expect(sim.monthsToSaveDownPayment).toBe(2); // ceil(12000 / 7600) = 2 meses
    expect(sim.violations.some((v) => v.code === 'INSUFFICIENT_DOWN_PAYMENT')).toBe(true);
  });

  it('Simulador "Posso Comprar?": cenário Vermelho ao estourar teto de 30% de Moradia (apartamento) ou 20% de Parcelas (carro)', () => {
    const waterfall = evaluateWaterfall({
      householdConfig: { allowanceFloor: 600, allowanceCap: 3200 },
      liquidity: { settledIncomesTotal: 26000 },
      housingTotal: 4500,
      essentialFixedTotal: 1750,
      cancelableFixedTotal: 250,
      installmentsTotal: 2100,
      groceriesAmount: 1800,
      routineAmount: 1100,
      bufferAmount: 500,
    });

    const shield = calculateShieldMetrics({
      cycles: [tijucaCycleSample],
      currentShieldBalance: 117500,
    });

    // Apartamento com SAC cara estourando 30% de 26.000 (R$ 7.800)
    const apartmentRed = simulateBigPurchase({
      assetType: 'apartment',
      totalPrice: 950000,
      downPayment: 190000,
      installmentsCount: 360,
      monthlyInterestRate: 0.009,
      amortizationSystem: 'sac',
      monthlyHiddenCosts: 1400, // Condomínio + IPTU
      currentGoalSavedAmount: 150000,
      shieldMetrics: shield,
      waterfallResult: waterfall,
    });

    expect(apartmentRed.verdict).toBe('red');
    expect(
      apartmentRed.violations.some((v) => v.code === 'HOUSING_CAP_EXCEEDED')
    ).toBe(true);

    // Carro com parcela estourando 20% de 26.000 (R$ 5.200)
    const carRed = simulateBigPurchase({
      assetType: 'car',
      totalPrice: 180000,
      downPayment: 20000,
      installmentsCount: 36,
      monthlyInterestRate: 0.015,
      amortizationSystem: 'price',
      monthlyHiddenCosts: 1200,
      currentGoalSavedAmount: 20000,
      shieldMetrics: shield,
      waterfallResult: waterfall,
    });

    expect(carRed.verdict).toBe('red');
    expect(
      carRed.violations.some((v) => v.code === 'INSTALLMENT_CAP_EXCEEDED')
    ).toBe(true);
  });
});
