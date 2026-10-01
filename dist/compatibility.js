// Regras determinísticas de compatibilidade da build (fonte de verdade; a IA não as substitui).
// Script clássico: no browser expõe `RigRadarCompatibility`; em Node é carregado via require.
(function (root) {
  // Margem de potência: CPU + GPU + 75 W para o resto do sistema (board, RAM, discos,
  // ventoinhas), com 35 % de folga para picos transitórios e eficiência, arredondado
  // para cima à dezena.
  const BASE_SYSTEM_WATTS = 75;
  const PSU_HEADROOM = 1.35;
  // Rácio de desempenho GPU/CPU acima do qual a CPU tende a limitar a GPU a 1080p.
  const BOTTLENECK_RATIO = 1.85;

  function requiredPowerFor(cpu, gpu) {
    return Math.ceil((cpu.watt + gpu.watt + BASE_SYSTEM_WATTS) * PSU_HEADROOM / 10) * 10;
  }

  // parts: { cpu, board, ram, gpu, storage, psu, caseItem, cooler } — objetos do catálogo.
  function checkCompatibility({ cpu, board, ram, gpu, storage, psu, caseItem, cooler }) {
    const warnings = [];
    if (cpu.socket !== board.socket) warnings.push(`A CPU usa socket ${cpu.socket}, mas a motherboard usa ${board.socket}.`);
    // A RAM tem de ser suportada pela board e pelo controlador de memória da CPU
    // (algumas CPUs aceitam DDR4 e DDR5, por isso `cpu.ram` pode ser uma lista).
    if (ram.type !== board.ram || !(Array.isArray(cpu.ram) ? cpu.ram.includes(ram.type) : ram.type === cpu.ram)) warnings.push(`A RAM ${ram.type} não é suportada por esta combinação CPU/motherboard (${board.ram}).`);
    if (ram.modules > board.dimms) warnings.push(`O kit de RAM tem ${ram.modules} módulos, mas a motherboard só tem ${board.dimms} slots DIMM.`);
    if (!cooler.sockets.includes(cpu.socket)) warnings.push(`O cooler ${cooler.name} não inclui montagem para o socket ${cpu.socket} da CPU.`);
    // O cooler incluído não é vendido à parte: só existe se a CPU for a que o traz.
    if (cooler.id === 'coolerstock' && cpu.id !== 'cpu7600') warnings.push('O cooler incluído só acompanha o Ryzen 5 7600.');
    if (!caseItem.forms.includes(board.form)) warnings.push(`A caixa não aceita motherboards ${board.form}.`);
    const requiredPower = requiredPowerFor(cpu, gpu);
    if (psu.watt < requiredPower) warnings.push(`A fonte de ${psu.watt} W é curta: recomenda-se pelo menos ${requiredPower} W com margem.`);
    // Conectores: compara tipo a tipo (um 12VHPWR não é substituído por 8-pin sem adaptador).
    for (const [type, count] of Object.entries(gpu.powerConnectors || {})) {
      const available = psu.powerConnectors?.[type] || 0;
      if (available < count) warnings.push(`A GPU pede ${count} conector${count > 1 ? 'es' : ''} ${type === '8pin' ? 'PCIe 8-pin' : type}, mas a fonte só tem ${available} desse tipo.`);
    }
    if (gpu.length > caseItem.gpuMax) warnings.push(`A GPU mede ${gpu.length} mm e excede os ${caseItem.gpuMax} mm disponíveis na caixa.`);
    if (cooler.height > caseItem.coolerMax) warnings.push(`O cooler tem ${cooler.height} mm e a caixa permite até ${caseItem.coolerMax} mm.`);
    if (storage.interface === 'M.2' && board.m2 < storage.slots) warnings.push('Não há slots M.2 suficientes na motherboard para este armazenamento.');
    if (storage.interface === 'SATA' && (board.sata || 0) < storage.slots) warnings.push(`O armazenamento precisa de ${storage.slots} porta${storage.slots > 1 ? 's' : ''} SATA, mas a motherboard só tem ${board.sata || 0}.`);
    if (gpu.performance / cpu.performance > BOTTLENECK_RATIO) warnings.push('Possível gargalo: a GPU é muito mais rápida do que a CPU para jogos a 1080p.');
    return { warnings, requiredPower, draw:cpu.watt + gpu.watt + BASE_SYSTEM_WATTS, board };
  }

  const api = { checkCompatibility, requiredPowerFor, BASE_SYSTEM_WATTS, PSU_HEADROOM, BOTTLENECK_RATIO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RigRadarCompatibility = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
