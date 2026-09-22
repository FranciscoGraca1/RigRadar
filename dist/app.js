const euro = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const staticHosting = location.hostname.endsWith('.github.io');
fetch('./catalog.json').then(response => {
  if (!response.ok) throw new Error('Catálogo indisponível.');
  return response.json();
}).then(components => {
const slots = ['CPU','Motherboard','RAM','GPU','Armazenamento','Fonte','Caixa','Cooler'];
const buildOptions = Object.fromEntries(slots.map(slot => [slot, components.filter(item => item.category === slot)]));
const persisted = JSON.parse(localStorage.getItem('rigradar-build') || '{}');
const selections = Object.fromEntries(slots.map(slot => [slot, persisted[slot] ?? (slot === 'CPU' ? 'cpu7600' : slot === 'Motherboard' ? 'boardb650' : slot === 'RAM' ? 'ram32' : slot === 'GPU' ? 'gpu4070' : slot === 'Armazenamento' ? 'ssd2tb' : slot === 'Fonte' ? 'psu750' : slot === 'Caixa' ? 'case4000d' : 'peerless')]));
let followed = new Set(JSON.parse(localStorage.getItem('rigradar-followed') || '["gpu4070","cpu7600","ram32","ssd2tb"]'));
let activeProduct = 'gpu4070';
let activeFilter = 'all';
let lastRefresh = Number(localStorage.getItem('rigradar-last-live-refresh') || 0);
let deferredInstall;

const byId = id => components.find(component => component.id === id);
const selected = slot => buildOptions[slot].find(item => item.id === selections[slot]) || buildOptions[slot][0];
const formatPrice = value => euro.format(value);
const esc = value => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

function chartPath(history, width = 660, height = 182) {
  if (history.length < 2) return { line:'', area:'' };
  const max = Math.max(...history), min = Math.min(...history), padding = 12;
  const range = Math.max(max - min, 1);
  const points = history.map((value, index) => ({ x: index * width / (history.length - 1), y: padding + ((max - value) / range) * (height - padding * 2) }));
  return { line: points.map((point,index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '), area: `M0,${height} ${points.map((point,index) => `${index ? 'L' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')} L${width},${height} Z` };
}
function renderFocusChart(product = byId('gpu4070')) {
  const path = chartPath(product.history);
  const line = document.getElementById('chartLine'); const area = document.getElementById('chartArea');
  if (line && area) { line.setAttribute('d',path.line); area.setAttribute('d',path.area); }
  const chart = document.getElementById('trendChart');
  chart.classList.toggle('hidden', product.history.length < 2);
  let note = chart.parentElement.querySelector('.chart-empty');
  if (product.history.length < 2 && !note) { note = document.createElement('p'); note.className = 'chart-empty source-note'; note.textContent = 'À espera de mais leituras para mostrar a tendência.'; chart.parentElement.append(note); }
  if (note) note.classList.toggle('hidden', product.history.length >= 2);
}
function renderDashboardPrices(liveCount = components.filter(item => item.priceSource === 'live').length) {
  const focus = byId('gpu4070'), deal = byId('gpu7800');
  document.getElementById('focusPrice').textContent = formatPrice(focus.price);
  document.getElementById('focusChange').textContent = focus.change == null ? 'Sem tendência' : `${focus.change < 0 ? '↓' : '↑'} ${Math.abs(focus.change).toFixed(1).replace('.',',')}% no histórico`;
  document.getElementById('focusLow').textContent = focus.low == null ? 'sem mínimo' : `mín. ${formatPrice(focus.low)}`;
  const offers = focus.liveOffers?.length ? focus.liveOffers.map(offer => [offer.store, offer.price]) : focus.stores;
  document.getElementById('focusStores').innerHTML = offers.length ? offers.slice(0, 3).map((offer, index) => `<span><i class="dot ${['green','orange','gray'][index]}"></i>${esc(offer[0])} <b>${formatPrice(offer[1])}</b></span>`).join('') : '<span>Sem ofertas nesta leitura.</span>';
  document.getElementById('fallingCount').textContent = components.filter(item => followed.has(item.id) && item.change < 0).length;
  document.getElementById('liveCount').textContent = liveCount;
  document.getElementById('dealPrice').textContent = formatPrice(deal.price);
  document.getElementById('dealValue').textContent = deal.priceSource === 'live' ? ' · preço recolhido' : ' · preço de exemplo';
}
function renderWatchList() {
  const list = document.getElementById('watchList');
  const items = components.filter(item => item.trackable !== false && followed.has(item.id));
  document.getElementById('followCount').textContent = items.length;
  if (!items.length) { list.innerHTML = '<p class="source-note">Ainda não segues nenhum componente. No catálogo, usa o botão “Seguir”.</p>'; return; }
  list.innerHTML = items.map(item => `<article class="watch-row"><div class="mini-art">${item.art}</div><div class="watch-name">${esc(item.short)}<small>${esc(item.model.split('·')[0].trim())}</small></div><div class="watch-value">${formatPrice(item.price)}<small>${item.low == null ? 'sem histórico' : `mín. ${formatPrice(item.low)}`}</small></div><div class="watch-status ${item.change == null ? 'flat' : item.change < 0 ? 'down' : item.change > 0 ? 'up':'flat'}">${item.change == null ? 'Sem tendência' : `${item.change < 0 ? '↓' : item.change > 0 ? '↑' : '—'} ${Math.abs(item.change).toFixed(1).replace('.',',')}%`}</div><div class="watch-store">${esc(item.store)}</div><button class="row-action" data-toggle-follow="${item.id}" aria-label="Deixar de seguir ${esc(item.name)}">×</button></article>`).join('');
}
function renderCatalog() {
  const grid = document.getElementById('catalogGrid');
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const items = components.filter(item => item.trackable !== false && (activeFilter === 'all' || item.category === activeFilter) && (`${item.name} ${item.short} ${item.category}`.toLowerCase().includes(query)));
  grid.innerHTML = items.map(item => `<article class="catalog-card"><div class="catalog-card-top"><span class="category-label">${item.category}</span><button class="row-action" data-toggle-follow="${item.id}" aria-label="${followed.has(item.id) ? 'Deixar de seguir' : 'Seguir'} ${esc(item.name)}">${followed.has(item.id) ? '★' : '☆'}</button></div><h2>${esc(item.name)}</h2><p>${esc(item.model)}</p><div class="card-price"><strong>${formatPrice(item.price)}</strong><span>${item.change == null ? 'Sem tendência' : `${item.change < 0 ? '↓' : '↑'} ${Math.abs(item.change).toFixed(1).replace('.',',')}% / 30d`}</span></div><div class="card-foot"><span>${esc(item.store)} · ${item.low == null ? 'sem mínimo' : `${formatPrice(item.low)} mín.`}</span><button data-open-product="${item.id}">Ver histórico →</button></div></article>`).join('') || '<p class="source-note">Não encontrei componentes com esse termo.</p>';
}
function renderProduct() {
  const item = byId(activeProduct); if (!item) return;
  const path = chartPath(item.history);
  const graph = item.history.length > 1 ? `<div class="chart-wrap"><svg viewBox="0 0 660 205" role="img" aria-label="Gráfico do histórico de preços"><defs><linearGradient id="detailfill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#56e0ae" stop-opacity=".28"/><stop offset="1" stop-color="#56e0ae" stop-opacity="0"/></linearGradient></defs><path class="chart-grid" d="M0 20H660M0 74H660M0 128H660M0 182H660"/><path fill="url(#detailfill)" d="${path.area}"/><path fill="none" stroke="#56e0ae" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="${path.line}"/></svg><div class="chart-axis"><span>Início</span><span>Mais recente</span></div></div>` : '<p class="source-note">Ainda não há leituras suficientes para desenhar o gráfico. Atualiza os preços quando houver uma fonte autorizada.</p>';
  const offers = item.liveOffers?.length ? item.liveOffers.map(offer => `<div class="history-row"><a href="${esc(offer.url)}" target="_blank" rel="noopener noreferrer">${esc(offer.store)}</a><b>${formatPrice(offer.price)}</b><span>${esc(offer.availability)}</span></div><small class="muted">Lido em ${new Date(offer.observedAt).toLocaleString('pt-PT')}</small>`).join('') : item.stores.map(store => `<div class="history-row"><span>${esc(store[0])}</span><b>${formatPrice(store[1])}</b><span>${esc(store[2])}</span></div>`).join('');
  document.getElementById('productDetail').innerHTML = `<div class="product-hero"><div class="product-hero-art"><b>${esc(item.art)}<br><small>${esc(item.short)}</small></b></div><article class="product-overview"><p class="eyebrow">${item.category} · ${followed.has(item.id) ? 'A seguir' : 'Catálogo'}</p><h1 id="productTitle">${esc(item.name)}</h1><p class="model">${esc(item.model)}</p><div class="detail-price"><strong>${formatPrice(item.price)}</strong><span class="pill good">${item.change == null ? 'Sem tendência' : `${item.change < 0 ? '↓' : '↑'} ${Math.abs(item.change).toFixed(1).replace('.',',')}% / 30 dias`}</span></div><div class="detail-stats"><div class="detail-stat"><span>Mínimo observado</span><b>${item.low == null ? '—' : formatPrice(item.low)}</b></div><div class="detail-stat"><span>Média observada</span><b>${item.avg == null ? '—' : formatPrice(item.avg)}</b></div><div class="detail-stat"><span>Índice valor</span><b>${item.score == null ? '—' : `${item.score} / 10`}</b></div></div></article></div><div class="product-grid"><article class="panel"><div class="panel-head"><div><p class="eyebrow">Histórico de preço</p><h2>${item.priceSource === 'live' ? 'Leituras reais' : 'Dados de exemplo'}</h2></div><span class="muted">Preço mais baixo é melhor</span></div>${graph}</article><article class="panel"><p class="eyebrow">${item.priceSource === 'live' ? 'Ofertas recolhidas' : 'Ofertas de exemplo'}</p><h2>Por loja</h2><div class="history-table">${offers || '<p class="source-note">Ainda não há ofertas recolhidas.</p>'}</div><p class="source-note">${item.priceSource === 'live' ? 'Confirma preço e stock na loja antes de comprar.' : 'Valores demonstrativos; ainda não foram recolhidos preços desta peça.'}</p></article></div>`;
}
function getCompatibility() {
  const cpu = selected('CPU'), board = selected('Motherboard'), ram = selected('RAM'), gpu = selected('GPU'), storage = selected('Armazenamento'), psu = selected('Fonte'), caseItem = selected('Caixa'), cooler = selected('Cooler');
  const warnings = [];
  if (cpu.socket !== board.socket) warnings.push(`A CPU usa socket ${cpu.socket}, mas a motherboard usa ${board.socket}.`);
  if (ram.type !== board.ram || !(Array.isArray(cpu.ram) ? cpu.ram.includes(ram.type) : ram.type === cpu.ram)) warnings.push(`A RAM ${ram.type} não é suportada por esta combinação CPU/motherboard (${board.ram}).`);
  if (ram.modules > board.dimms) warnings.push(`O kit de RAM tem ${ram.modules} módulos, mas a motherboard só tem ${board.dimms} slots DIMM.`);
  if (!cooler.sockets.includes(cpu.socket)) warnings.push(`O cooler ${cooler.name} não inclui montagem para o socket ${cpu.socket} da CPU.`);
  if (!caseItem.forms.includes(board.form)) warnings.push(`A caixa não aceita motherboards ${board.form}.`);
  const requiredPower = Math.ceil((cpu.watt + gpu.watt + 75) * 1.35 / 10) * 10;
  if (psu.watt < requiredPower) warnings.push(`A fonte de ${psu.watt} W é curta: recomenda-se pelo menos ${requiredPower} W com margem.`);
  for (const [type, count] of Object.entries(gpu.powerConnectors)) {
    const available = psu.powerConnectors?.[type] || 0;
    if (available < count) warnings.push(`A GPU pede ${count} conector${count > 1 ? 'es' : ''} ${type === '8pin' ? 'PCIe 8-pin' : type}, mas a fonte só tem ${available} desse tipo.`);
  }
  if (gpu.length > caseItem.gpuMax) warnings.push(`A GPU mede ${gpu.length} mm e excede os ${caseItem.gpuMax} mm disponíveis na caixa.`);
  if (cooler.height > caseItem.coolerMax) warnings.push(`O cooler tem ${cooler.height} mm e a caixa permite até ${caseItem.coolerMax} mm.`);
  if (storage.interface === 'M.2' && board.m2 < storage.slots) warnings.push('Não há slots M.2 suficientes na motherboard para este armazenamento.');
  const ratio = gpu.performance / cpu.performance;
  if (ratio > 1.85) warnings.push('Possível gargalo: a GPU é muito mais rápida do que a CPU para jogos a 1080p.');
  return { warnings, requiredPower, draw: cpu.watt + gpu.watt + 75, board };
}
function getBuildContext() {
  const result = getCompatibility();
  return { selections:{ ...selections }, parts:Object.fromEntries(slots.map(slot => [slot, { name:selected(slot).name, price:selected(slot).price, spec:selected(slot).spec }])), total:slots.reduce((sum,slot) => sum + selected(slot).price, 0), warnings:result.warnings, estimatedWatts:result.draw, recommendedWatts:result.requiredPower };
}
function renderBuilder() {
  const compatibility = getCompatibility();
  const total = slots.reduce((sum, slot) => sum + selected(slot).price, 0);
  document.getElementById('buildTotal').textContent = formatPrice(total);
  const summary = document.getElementById('compatibilitySummary');
  const message = compatibility.warnings.length ? `${compatibility.warnings.length} ponto${compatibility.warnings.length > 1 ? 's' : ''} a rever antes de comprar.` : `Tudo encaixa. Potência estimada: ${compatibility.draw} W; margem recomendada: ${compatibility.requiredPower} W.`;
  summary.className = `compatibility-summary${compatibility.warnings.length ? ' warning' : ''}`;
  summary.innerHTML = `<span class="badge">${compatibility.warnings.length ? '!' : '✓'}</span><div><h2>${compatibility.warnings.length ? 'Há incompatibilidades a resolver' : 'Build compatível'}</h2><p>${message}</p></div>`;
  const showNote = slot => {
    if (!compatibility.warnings.length) return slot === 'Motherboard' ? compatibility.board.bios : '';
    const match = compatibility.warnings.find(warning => warning.toLowerCase().includes(slot.toLowerCase().replace('fonte','fonte')) || (slot === 'CPU' && warning.includes('socket')) || (slot === 'RAM' && warning.includes('RAM')) || (slot === 'GPU' && (warning.includes('GPU') || warning.includes('PCIe'))) || (slot === 'Caixa' && warning.includes('caixa')) || (slot === 'Cooler' && warning.includes('cooler')) || (slot === 'Armazenamento' && warning.includes('M.2')));
    return match || (slot === 'Motherboard' ? compatibility.board.bios : '');
  };
  document.getElementById('componentSlots').innerHTML = slots.map(slot => { const item = selected(slot), note = showNote(slot); return `<article class="slot"><span class="slot-label">${slot}</span><div class="slot-control"><select data-slot="${slot}" aria-label="Escolher ${slot}">${buildOptions[slot].map(option => `<option value="${option.id}" ${option.id === item.id ? 'selected':''}>${esc(option.name)}</option>`).join('')}</select></div><span class="slot-price${item.price === 0 ? ' empty':''}">${item.price ? formatPrice(item.price) : 'Incluído'}</span>${note ? `<p class="slot-note${compatibility.warnings.includes(note) ? ' warn' : ''}">${esc(note)}</p>` : ''}</article>`; }).join('');
}
function saveBuild() { localStorage.setItem('rigradar-build', JSON.stringify(selections)); }
function answerFor(message) {
  const lower = message.toLowerCase(); const compatibility = getCompatibility(); const cpu = selected('CPU'), gpu = selected('GPU'), psu = selected('Fonte');
  if (compatibility.warnings.length) return `Encontrei ${compatibility.warnings.length} aviso(s): ${compatibility.warnings[0]} Troca essa peça antes de decidir pelo preço.`;
  if (/fonte|psu|watt|potência/.test(lower)) return `Sim. A ${psu.name} tem ${psu.watt} W; a build estima ${compatibility.draw} W e a margem recomendada é ${compatibility.requiredPower} W. Também tem conectores PCIe suficientes para a GPU.`;
  if (/gargalo|bottleneck/.test(lower)) return `Para esta seleção, ${cpu.name} e ${gpu.name} formam um equilíbrio saudável, sobretudo a 1440p. Jogos muito focados em CPU podem beneficiar da Ryzen 7 7800X3D.`;
  if (/melhor|melhorar|upgrade|trocar/.test(lower)) return 'A prioridade depende do uso: para gaming 1440p, a GPU traz o maior ganho; para multitarefa e jogos competitivos, uma CPU Ryzen 7 é a evolução mais equilibrada. Define também um orçamento máximo no backend para recomendações objetivas.';
  return `A build atual custa ${formatPrice(slots.reduce((sum, slot) => sum + selected(slot).price, 0))} e está compatível. Posso analisar fonte, gargalos ou prioridades de upgrade.`;
}
function addChat(message, isUser = false) {
  const messages = document.getElementById('chatMessages');
  const bubble = document.createElement('div'); bubble.className = `chat-bubble${isUser ? ' user' : ' bot'}`; bubble.textContent = message; messages.append(bubble); messages.scrollTop = messages.scrollHeight;
}
async function sendMessage(message) {
  const content = message.trim(); if (!content) return;
  addChat(content, true);
  if (staticHosting) { addChat(`Análise local: ${answerFor(content)}`); return; }
  try {
    const response = await fetch('./api/assistant', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ message:content, context:getBuildContext() }) });
    if (!response.ok) throw new Error('Assistente indisponível.');
    const result = await response.json();
    if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('Resposta vazia.');
    addChat(result.answer.trim());
  } catch { addChat(`Análise local: ${answerFor(content)}`); }
}
function showToast(text) { const toast = document.getElementById('toast'); toast.textContent = text; toast.classList.add('show'); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3100); }
function switchView(view) {
  document.querySelectorAll('.view').forEach(node => node.classList.toggle('active', node.id === view));
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'catalog') renderCatalog(); if (view === 'builder') renderBuilder(); window.scrollTo({top:0,behavior:'smooth'});
}
function applyPriceData(data) {
  let liveCount = 0;
  let newestReading = null;
  for (const update of data.components || []) {
    const item = byId(update.id);
    if (!item || !Number.isFinite(update.price) || update.price <= 0) continue;
    item.price = update.price; item.low = update.low; item.avg = update.avg; item.store = update.store; item.priceSource = 'live'; item.liveOffers = update.stores || [];
    item.history = (update.history || []).map(point => point.price);
    if (update.observedAt && (!newestReading || update.observedAt > newestReading)) newestReading = update.observedAt;
    if (item.history.length > 1) item.change = Math.round((item.history.at(-1) / item.history[0] - 1) * 1000) / 10;
    else item.change = null;
    liveCount++;
  }
  renderDashboardPrices(liveCount);
  document.getElementById('updatedLabel').textContent = liveCount ? `Última leitura real · ${new Date(newestReading).toLocaleString('pt-PT')}` : 'Dados de exemplo · sem leituras reais';
  document.querySelector('.sync-state span').textContent = liveCount ? `${liveCount} peças com preços reais` : 'Fontes por configurar';
  renderFocusChart(); renderWatchList(); renderCatalog(); renderBuilder();
  if (document.getElementById('product').classList.contains('active')) renderProduct();
  return liveCount;
}
async function loadPrices() {
  if (staticHosting) return;
  try { const response = await fetch('./api/prices', { cache:'no-store' }); if (!response.ok) return; applyPriceData(await response.json()); } catch { /* A PWA continua a funcionar offline. */ }
}
async function refreshPrices() {
  if (staticHosting) { showToast('Esta versão pública é demonstrativa. Preços reais exigem um servidor autorizado.'); return; }
  const elapsed = Date.now() - lastRefresh;
  if (elapsed < 10 * 60 * 1000 && lastRefresh) { await loadPrices(); showToast(`A usar cache — próxima recolha em ${Math.ceil((10 * 60 * 1000 - elapsed) / 60000)} min.`); return; }
  const buttons = [...document.querySelectorAll('#refreshButton,#catalogRefresh')]; buttons.forEach(button => { button.classList.add('loading'); button.disabled = true; });
  try {
    const response = await fetch('./api/prices/refresh', { method:'POST' });
    if (!response.ok) throw new Error('O servidor de preços não respondeu.');
    const data = await response.json(); const liveCount = applyPriceData(data);
    const active = data.sources.filter(source => source.status !== 'não configurada');
    const failed = active.filter(source => source.status === 'erro' || source.status === 'parcial');
    if (active.length) { lastRefresh = Date.now(); localStorage.setItem('rigradar-last-live-refresh', String(lastRefresh)); }
    if (!active.length) showToast('Liga uma fonte autorizada no servidor para obter preços reais.');
    else if (failed.length) showToast(`${liveCount} peças com preços reais; ${failed.length} fonte(s) com avisos.`);
    else showToast(`${liveCount} peças com preços reais. Recolha concluída.`);
  } catch { showToast('Sem ligação ao servidor de preços. Os dados de exemplo mantêm-se visíveis.'); }
  finally { buttons.forEach(button => { button.classList.remove('loading'); button.disabled = false; }); }
}

document.addEventListener('click', event => {
  const viewButton = event.target.closest('[data-view]'); if (viewButton) { switchView(viewButton.dataset.view); return; }
  const openProduct = event.target.closest('[data-open-product]'); if (openProduct) { activeProduct = openProduct.dataset.openProduct; renderProduct(); switchView('product'); return; }
  const followButton = event.target.closest('[data-toggle-follow]'); if (followButton) { const id = followButton.dataset.toggleFollow; followed.has(id) ? followed.delete(id) : followed.add(id); localStorage.setItem('rigradar-followed', JSON.stringify([...followed])); renderWatchList(); renderCatalog(); renderDashboardPrices(); showToast(followed.has(id) ? 'Componente adicionado à lista seguida.' : 'Componente removido da lista seguida.'); return; }
  const filterButton = event.target.closest('[data-filter]'); if (filterButton) { activeFilter = filterButton.dataset.filter; document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button === filterButton)); renderCatalog(); return; }
  const prompt = event.target.closest('[data-prompt]'); if (prompt) sendMessage(prompt.dataset.prompt);
});
document.addEventListener('change', event => { if (event.target.matches('[data-slot]')) { selections[event.target.dataset.slot] = event.target.value; saveBuild(); renderBuilder(); } });
document.getElementById('searchInput').addEventListener('input', event => { if (event.target.value.trim()) switchView('catalog'); renderCatalog(); });
document.getElementById('refreshButton').addEventListener('click', refreshPrices); document.getElementById('catalogRefresh').addEventListener('click', refreshPrices);
document.getElementById('chatForm').addEventListener('submit', event => { event.preventDefault(); const input = document.getElementById('chatInput'); sendMessage(input.value); input.value=''; });
document.getElementById('themeButton').addEventListener('click', () => { document.body.classList.toggle('high-contrast'); showToast('Contraste ajustado para esta sessão.'); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; document.getElementById('installButton').hidden = false; });
document.getElementById('installButton').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; document.getElementById('installButton').hidden = true; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

function registerWebMCP() {
  const context = document.modelContext; if (!context?.registerTool) return;
  const aborter = new AbortController();
  const register = tool => Promise.resolve(context.registerTool(tool, {signal:aborter.signal})).catch(() => {});
  register({name:'get_build_compatibility',title:'Ler compatibilidade da build',description:'Devolve a seleção atual, o total e avisos de compatibilidade. Use para responder a questões sobre a build visível.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return getBuildContext();}});
  register({name:'select_build_component',title:'Escolher componente',description:'Seleciona uma peça existente na build visível e atualiza a validação.',inputSchema:{type:'object',properties:{slot:{type:'string',enum:slots},componentId:{type:'string'}},required:['slot','componentId'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input || !slots.includes(input.slot) || !buildOptions[input.slot].some(item=>item.id===input.componentId)) throw new Error('Peça ou slot inválido.'); selections[input.slot]=input.componentId; saveBuild(); renderBuilder(); const result=getCompatibility();return {selected:{slot:input.slot,componentId:input.componentId},warnings:result.warnings};}});
  register({name:'get_followed_prices',title:'Ler preços seguidos',description:'Devolve as peças seguidas, o preço visível e se provém de uma leitura real ou de dados de exemplo.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return components.filter(item => followed.has(item.id)).map(item => ({ id:item.id, name:item.name, price:item.price, low:item.low, source:item.priceSource || 'exemplo' }));}});
  register({name:'set_followed_component',title:'Seguir componente',description:'Adiciona ou remove uma peça da lista seguida visível.',inputSchema:{type:'object',properties:{componentId:{type:'string'},follow:{type:'boolean'}},required:['componentId','follow'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){const item=byId(input?.componentId); if (!item || item.trackable === false || typeof input.follow !== 'boolean') throw new Error('Peça ou estado inválido.'); input.follow ? followed.add(item.id) : followed.delete(item.id); localStorage.setItem('rigradar-followed', JSON.stringify([...followed])); renderWatchList(); renderCatalog(); renderDashboardPrices(); return { id:item.id, followed:followed.has(item.id) };}});
}
if (staticHosting) { document.querySelector('.sync-state span').textContent = 'Demonstração online'; document.querySelector('.sidebar-footer p').textContent = 'Preços reais e IA exigem um servidor próprio.'; }
renderFocusChart(); renderWatchList(); renderCatalog(); renderDashboardPrices(); renderBuilder(); registerWebMCP(); loadPrices();
}).catch(() => { document.getElementById('updatedLabel').textContent = 'Não foi possível carregar o catálogo.'; });
