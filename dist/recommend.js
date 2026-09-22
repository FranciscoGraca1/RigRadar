const WEIGHTS = {
  gaming:{ CPU:.18, Motherboard:.10, RAM:.09, GPU:.40, Armazenamento:.08, Fonte:.07, Caixa:.05, Cooler:.03 },
  trabalho:{ CPU:.28, Motherboard:.10, RAM:.14, GPU:.20, Armazenamento:.12, Fonte:.07, Caixa:.06, Cooler:.03 },
  criacao:{ CPU:.24, Motherboard:.09, RAM:.14, GPU:.27, Armazenamento:.12, Fonte:.06, Caixa:.05, Cooler:.03 },
  geral:{ CPU:.22, Motherboard:.12, RAM:.12, GPU:.17, Armazenamento:.12, Fonte:.10, Caixa:.08, Cooler:.07 }
};

function recommendBuild({ options, budget, use = 'gaming', resolution = '1440p', priority = 'equilibrio', evaluate }) {
  if (!Number.isFinite(budget) || budget <= 0 || !WEIGHTS[use]) throw new Error('Orçamento ou utilização inválidos.');
  const slots = Object.keys(WEIGHTS[use]);
  const maxPerformance = Object.fromEntries(['CPU','GPU'].map(slot => [slot, Math.max(...options[slot].map(item => item.performance || 0), 1)]));
  let best = null, cheapest = null;
  function visit(index, choice, total) {
    if (index === slots.length) {
      if (evaluate(choice).warnings.length) return;
      if (!cheapest || total < cheapest.total) cheapest = { choice:{ ...choice }, total };
      if (total > budget) return;
      let utility = 0;
      for (const slot of slots) {
        const item = options[slot].find(option => option.id === choice[slot]);
        const target = budget * WEIGHTS[use][slot];
        const fit = Math.max(0, 1 - Math.abs(item.price - target) / Math.max(target, 1));
        const performance = (slot === 'CPU' || slot === 'GPU') ? (item.performance || 0) / maxPerformance[slot] : .7;
        const value = item.score != null ? item.score / 10 : .7;
        const emphasis = slot === 'GPU' && use === 'gaming' ? (resolution === '4k' ? 1.5 : resolution === '1080p' ? .85 : 1.2) : 1;
        utility += WEIGHTS[use][slot] * emphasis * (.5 * value + .3 * fit + .2 * performance);
      }
      const board = options.Motherboard.find(item => item.id === choice.Motherboard);
      const psu = options.Fonte.find(item => item.id === choice.Fonte);
      if (priority === 'compacto' && board.form === 'mATX' && choice.Caixa === 'casemini') utility += .10;
      if (priority === 'upgrade') utility += .05 * (board.m2 || 0) / 3 + .05 * Math.min(psu.watt / 750, 1);
      if (priority === 'silencio' && choice.Cooler !== 'coolerstock') utility += .05;
      utility += .02 * (budget - total) / budget;
      if (!best || utility > best.utility || (utility === best.utility && total < best.total)) best = { choice:{ ...choice }, total, utility };
      return;
    }
    const slot = slots[index];
    for (const item of options[slot]) {
      if (item.priceSource === 'live' && !['Em stock','Limitado'].includes(item.availability)) continue;
      choice[slot] = item.id; visit(index + 1, choice, total + item.price);
    }
  }
  visit(0, {}, 0);
  return { best, cheapest };
}
