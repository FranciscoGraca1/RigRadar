const euro = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const staticHosting = location.hostname.endsWith('.github.io') || location.protocol === 'file:';
fetch('./catalog.json').then(response => {
  if (!response.ok) throw new Error('Catálogo indisponível.');
  return response.json();
}).then(components => {
const slots = ['CPU','Motherboard','RAM','GPU','Armazenamento','Fonte','Caixa','Cooler'];
const buildOptions = Object.fromEntries(slots.map(slot => [slot, components.filter(item => item.category === slot)]));
const PS = window.RigRadarPriceState;
// Valores guardados podem estar corrompidos ou ter SKUs que já não existem no catálogo:
// lê-los com validação para nunca bloquear o arranque (ver test/price-state.test.mjs).
const persisted = PS.readStored(localStorage, 'rigradar-build', {}, PS.isPlainObject);
const selections = Object.fromEntries(slots.map(slot => [slot, buildOptions[slot].some(item => item.id === persisted[slot]) ? persisted[slot] : (slot === 'CPU' ? 'cpu7600' : slot === 'Motherboard' ? 'boardb650' : slot === 'RAM' ? 'ram32' : slot === 'GPU' ? 'gpu4070' : slot === 'Armazenamento' ? 'ssd2tb' : slot === 'Fonte' ? 'psu750' : slot === 'Caixa' ? 'case4000d' : 'peerless')]));
let followed = new Set(PS.readStored(localStorage, 'rigradar-followed', ['gpu4070','cpu7600','ram32','ssd2tb'], value => Array.isArray(value) && value.every(id => typeof id === 'string')));
let targets = Object.fromEntries(Object.entries(PS.readStored(localStorage, 'rigradar-targets', {}, PS.isPlainObject)).filter(([, value]) => Number.isFinite(value) && value > 0));
// Metadados do último snapshot aplicado (idade e se veio da cache offline do service worker).
let snapshotInfo = { generatedAt:null, offline:false, maxOfferAgeHours:PS.DEFAULT_MAX_OFFER_AGE_HOURS };
// Último snapshot aplicado e assinatura dos estados calculados. Os estados dependem da
// hora atual: refreshFreshness() volta a calculá-los sem novo pedido de rede.
let lastSnapshot = null, appliedSignature = '', lastCounts = null, lastNewestReading = null;
let activeProduct = 'gpu4070';
let activeFilter = 'all';
let chartPeriod = 30;
let lastRefresh = Number(localStorage.getItem('rigradar-last-live-refresh') || 0);
let deferredInstall;

const byId = id => components.find(component => component.id === id);
const selected = (slot, choice = selections) => buildOptions[slot].find(item => item.id === choice[slot]) || buildOptions[slot][0];
const formatPrice = value => euro.format(value);
const esc = value => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
function freshnessText(item) {
  if (item.priceSource !== 'live' || !item.observedAt) return 'Sem leituras reais; preço de exemplo.';
  const when = `${new Date(item.observedAt).toLocaleString('pt-PT')} (${PS.ageText(item.observedAt)})`;
  const samples = `${item.sampleCount || 0} leituras em stock nos últimos 90 dias.`;
  if (item.priceState === 'desatualizado') return `Preço desatualizado: a última leitura é de ${when}, mais antiga do que ${snapshotInfo.maxOfferAgeHours} h. Não é uma oferta atual. ${samples}`;
  if (item.priceState === 'sem stock') return `Sem stock nas lojas lidas em ${when}. O valor mostrado é o último lido, não uma oferta comprável. ${samples}`;
  return `Última leitura: ${when} · ${samples}`;
}
const badgeHtml = item => { const badge = PS.priceBadge(item); return `<span class="price-badge ${badge.tone}">${badge.text}</span>`; };
// Alerta de preço-alvo: só dispara com preço real, fresco e com stock.
const targetReached = item => Boolean(targets[item.id]) && PS.isBuyable(item) && item.price <= targets[item.id];

function liveSeries(item, days) {
  const cutoff = Date.now() - days * 86_400_000;
  const daily = new Map();
  for (const point of item.priceHistory || []) {
    if (!Number.isFinite(point.price) || Date.parse(point.timestamp) < cutoff || !['Em stock','Limitado'].includes(point.availability)) continue;
    const day = point.timestamp.slice(0, 10);
    if (!daily.has(day) || point.price < daily.get(day).price) daily.set(day, point);
  }
  return [...daily.values()].sort((a,b) => a.timestamp.localeCompare(b.timestamp));
}
function chartHistory(item) {
  if (item.priceSource === 'live') return liveSeries(item, chartPeriod);
  return (item.history || []).map((price, index) => ({ price, index, timestamp:null }));
}
function computePoints(history, width = 660, height = 182) {
  if (history.length < 2) return [];
  const prices = history.map(point => point.price);
  const max = Math.max(...prices), min = Math.min(...prices), padding = 12;
  const range = Math.max(max - min, 1);
  const start = history[0].timestamp ? Date.parse(history[0].timestamp) : null;
  const end = history.at(-1).timestamp ? Date.parse(history.at(-1).timestamp) : null;
  return history.map((point, index) => ({ ...point, x:start != null && end > start ? (Date.parse(point.timestamp) - start) / (end - start) * width : index * width / (history.length - 1), y:padding + ((max - point.price) / range) * (height - padding * 2) }));
}
function attachChartHover(svg, points) {
  const wrap = svg.parentElement;
  let tooltip = wrap.querySelector('.chart-tooltip');
  if (!tooltip) { tooltip = document.createElement('div'); tooltip.className = 'chart-tooltip hidden'; tooltip.setAttribute('role','status'); wrap.append(tooltip); }
  let guide = svg.querySelector('.chart-guide');
  if (!guide) { guide = document.createElementNS('http://www.w3.org/2000/svg', 'line'); guide.setAttribute('class','chart-guide hidden'); svg.append(guide); }
  let dot = svg.querySelector('.chart-dot');
  if (!dot) { dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('class','chart-dot hidden'); dot.setAttribute('r','5'); svg.append(dot); }
  const hide = () => { tooltip.classList.add('hidden'); guide.classList.add('hidden'); dot.classList.add('hidden'); };
  const show = event => {
    if (!points.length) return;
    const rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 660;
    const point = points.reduce((nearest, candidate) => Math.abs(candidate.x - x) < Math.abs(nearest.x - x) ? candidate : nearest);
    guide.setAttribute('x1',point.x); guide.setAttribute('x2',point.x); guide.setAttribute('y1','0'); guide.setAttribute('y2','182');
    dot.setAttribute('cx',point.x); dot.setAttribute('cy',point.y);
    tooltip.textContent = `${formatPrice(point.price)} · ${point.timestamp ? new Date(point.timestamp).toLocaleString('pt-PT') : `exemplo ${point.index + 1}`}${point.store ? ` · ${point.store}` : ''}`;
    tooltip.style.left = `${Math.min(Math.max(point.x / 660 * rect.width, 60), rect.width - 60)}px`;
    tooltip.style.top = `${Math.max(point.y / 205 * rect.height - 42, 0)}px`;
    tooltip.classList.remove('hidden'); guide.classList.remove('hidden'); dot.classList.remove('hidden');
  };
  // Rato: mostra ao mover e esconde ao sair. Toque: um toque simples não gera pointermove
  // e o pointerleave chega logo após o pointerup, por isso o tooltip fica visível até
  // um toque fora do gráfico.
  svg.onpointermove = show; svg.onpointerdown = show;
  svg.onpointerleave = event => { if (event.pointerType === 'mouse') hide(); };
  svg.onpointercancel = hide;
}
// Um único listener (os gráficos são recriados a cada render): um toque fora de um
// gráfico esconde o tooltip, a guia e o ponto desse gráfico.
document.addEventListener('pointerdown', event => {
  document.querySelectorAll('.chart-wrap').forEach(wrap => { if (!wrap.contains(event.target)) wrap.querySelectorAll('.chart-tooltip, .chart-guide, .chart-dot').forEach(node => node.classList.add('hidden')); });
});
function renderChartInto(svg, history) {
  const points = computePoints(history);
  const line = points.map((point,index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = points.length ? `M0,182 ${points.map(point => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')} L660,182 Z` : '';
  svg.querySelector('[data-chart-line]').setAttribute('d',line);
  svg.querySelector('[data-chart-area]').setAttribute('d',area);
  const axis = svg.parentElement.querySelector('.chart-axis');
  if (axis) axis.innerHTML = `<span>${history[0]?.timestamp ? new Date(history[0].timestamp).toLocaleDateString('pt-PT') : 'Primeiro exemplo'}</span><span>${history.at(-1)?.timestamp ? new Date(history.at(-1).timestamp).toLocaleDateString('pt-PT') : 'Último exemplo'}</span>`;
  attachChartHover(svg, points);
}
function renderFocusChart(product = byId('gpu4070')) {
  const chart = document.getElementById('trendChart');
  const history = chartHistory(product);
  document.querySelectorAll('.trend-panel [data-period]').forEach(button => { button.disabled = product.priceSource !== 'live'; button.title = button.disabled ? 'Períodos disponíveis após recolhas reais' : ''; });
  chart.classList.toggle('hidden', history.length < 2);
  renderChartInto(chart, history);
  let note = chart.parentElement.querySelector('.chart-empty');
  if (history.length < 2 && !note) { note = document.createElement('p'); note.className = 'chart-empty source-note'; note.textContent = 'À espera de mais leituras neste período para mostrar a tendência.'; chart.parentElement.append(note); }
  if (note) note.classList.toggle('hidden', history.length >= 2);
}
function renderDashboardPrices(liveCount = components.filter(item => item.priceSource === 'live').length) {
  const focus = byId('gpu4070'), deal = byId('gpu7800');
  document.getElementById('focusPrice').textContent = formatPrice(focus.price);
  document.getElementById('focusChange').textContent = focus.change == null ? 'Sem tendência' : `${focus.change < 0 ? '↓' : '↑'} ${Math.abs(focus.change).toFixed(1).replace('.',',')}% no histórico`;
  document.getElementById('focusLow').textContent = focus.low == null ? 'sem mínimo' : `mín. ${formatPrice(focus.low)}`;
  const offers = focus.priceSource === 'live' ? (focus.liveOffers || []).map(offer => [offer.store, offer.price]) : focus.stores;
  document.getElementById('focusStores').innerHTML = offers.length ? offers.slice(0, 3).map((offer, index) => `<span><i class="dot ${['green','orange','gray'][index]}"></i>${esc(offer[0])} <b>${formatPrice(offer[1])}</b></span>`).join('') : '<span>Sem ofertas nesta leitura.</span>';
  document.getElementById('fallingCount').textContent = components.filter(item => followed.has(item.id) && item.change < 0).length;
  document.getElementById('liveCount').textContent = liveCount;
  document.getElementById('dealPrice').textContent = formatPrice(deal.price);
  document.getElementById('dealValue').textContent = ` · ${PS.priceBadge(deal).text.toLowerCase()}`;
}
function renderWatchList() {
  const list = document.getElementById('watchList');
  const items = components.filter(item => item.trackable !== false && followed.has(item.id));
  document.getElementById('followCount').textContent = items.length;
  if (!items.length) { list.innerHTML = '<p class="source-note">Ainda não segues nenhum componente. No catálogo, usa o botão “Seguir”.</p>'; return; }
  list.innerHTML = items.map(item => `<article class="watch-row"><div class="mini-art">${item.art}</div><div class="watch-name">${esc(item.short)}<small>${esc(item.model.split('·')[0].trim())}${targets[item.id] ? ` · Alvo ${formatPrice(targets[item.id])}` : ''}</small></div><div class="watch-value">${formatPrice(item.price)}<small>${item.low == null ? 'sem histórico' : `mín. ${formatPrice(item.low)}`}</small></div><div class="watch-status ${targetReached(item) ? 'down' : item.change == null ? 'flat' : item.change < 0 ? 'down' : item.change > 0 ? 'up':'flat'}">${targetReached(item) ? 'Alvo atingido' : item.change == null ? 'Sem tendência' : `${item.change < 0 ? '↓' : item.change > 0 ? '↑' : '—'} ${Math.abs(item.change).toFixed(1).replace('.',',')}%`}</div><div class="watch-store">${esc(item.store)}${badgeHtml(item)}</div><button class="row-action" data-toggle-follow="${item.id}" aria-label="Deixar de seguir ${esc(item.name)}">×</button></article>`).join('');
}
function renderCatalog() {
  const grid = document.getElementById('catalogGrid');
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const items = components.filter(item => item.trackable !== false && (activeFilter === 'all' || item.category === activeFilter) && (`${item.name} ${item.short} ${item.category}`.toLowerCase().includes(query)));
  grid.innerHTML = items.map(item => `<article class="catalog-card"><div class="catalog-card-top"><span class="category-label">${item.category}</span><button class="row-action" data-toggle-follow="${item.id}" aria-label="${followed.has(item.id) ? 'Deixar de seguir' : 'Seguir'} ${esc(item.name)}">${followed.has(item.id) ? '★' : '☆'}</button></div><h2>${esc(item.name)}</h2><p>${esc(item.model)}</p><div class="card-price"><div class="card-price-main"><strong>${formatPrice(item.price)}</strong>${badgeHtml(item)}</div><span class="card-trend">${item.change == null ? 'Sem tendência' : `${item.change < 0 ? '↓' : '↑'} ${Math.abs(item.change).toFixed(1).replace('.',',')}% / 30d`}</span></div><div class="card-foot"><span>${esc(item.store)} · ${item.low == null ? 'sem mínimo' : `${formatPrice(item.low)} mín.`}<br>${esc(freshnessText(item))}</span><button data-open-product="${item.id}">Ver histórico →</button></div></article>`).join('') || '<p class="source-note">Não encontrei componentes com esse termo.</p>';
}
function renderProduct() {
  const item = byId(activeProduct); if (!item) return;
  const history = chartHistory(item);
  const graph = history.length > 1 ? `<div class="chart-wrap"><svg viewBox="0 0 660 205" role="img" aria-label="Gráfico do histórico de preços"><defs><linearGradient id="detailfill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#56e0ae" stop-opacity=".28"/><stop offset="1" stop-color="#56e0ae" stop-opacity="0"/></linearGradient></defs><path class="chart-grid" d="M0 20H660M0 74H660M0 128H660M0 182H660"/><path data-chart-area fill="url(#detailfill)"/><path data-chart-line fill="none" stroke="#56e0ae" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="chart-axis"><span>Início</span><span>Mais recente</span></div></div>` : '<p class="source-note">Ainda não há leituras suficientes neste período para desenhar o gráfico.</p>';
  // Uma peça com leituras reais nunca volta a mostrar as lojas de exemplo, mesmo sem ofertas atuais.
  // Links só para https: o URL vem de dados externos (feed/snapshot).
  const offers = item.priceSource === 'live' ? (item.liveOffers || []).map(offer => `<div class="history-row">${/^https:\/\//.test(offer.url || '') ? `<a href="${esc(offer.url)}" target="_blank" rel="noopener noreferrer">${esc(offer.store)}</a>` : `<span>${esc(offer.store)}</span>`}<b>${formatPrice(offer.price)}</b><span>${esc(offer.availability)}</span></div><small class="muted">Lido em ${new Date(offer.observedAt).toLocaleString('pt-PT')}</small>`).join('') : item.stores.map(store => `<div class="history-row"><span>${esc(store[0])}</span><b>${formatPrice(store[1])}</b><span>${esc(store[2])}</span></div>`).join('');
  document.getElementById('productDetail').innerHTML = `<div class="product-hero"><div class="product-hero-art"><b>${esc(item.art)}<br><small>${esc(item.short)}</small></b></div><article class="product-overview"><p class="eyebrow">${item.category} · ${followed.has(item.id) ? 'A seguir' : 'Catálogo'}</p><h1 id="productTitle">${esc(item.name)}</h1><p class="model">${esc(item.model)}</p><div class="detail-price"><strong>${formatPrice(item.price)}</strong>${badgeHtml(item)}<span class="pill good">${item.change == null ? 'Sem tendência' : `${item.change < 0 ? '↓' : '↑'} ${Math.abs(item.change).toFixed(1).replace('.',',')}% / 30 dias`}</span></div><div class="detail-stats"><div class="detail-stat"><span>Mínimo ${item.priceSource === 'live' ? 'real · 90 d' : 'de exemplo'}</span><b>${item.low == null ? '—' : formatPrice(item.low)}</b></div><div class="detail-stat"><span>Média ${item.priceSource === 'live' ? 'real · 90 d' : 'de exemplo'}</span><b>${item.avg == null ? '—' : formatPrice(item.avg)}</b></div><div class="detail-stat"><span>Índice valor</span><b>${item.score == null ? '—' : `${item.score} / 10`}</b></div></div><p class="source-note">${esc(freshnessText(item))}</p><label class="target-field">Preço-alvo (€)<input type="number" min="1" step="0.01" data-target="${item.id}" value="${targets[item.id] || ''}" placeholder="Definir alerta local"></label>${targetReached(item) ? '<p class="target-reached">✓ O preço real atingiu o teu alvo.</p>' : ''}</article></div><div class="product-grid"><article class="panel"><div class="panel-head"><div><p class="eyebrow">Histórico de preço</p><h2>${item.priceSource === 'live' ? 'Leituras reais' : 'Dados de exemplo'}</h2></div><span class="muted">Preço mais baixo é melhor</span></div><div class="period-row">${[7,30,90,365].map(days => `<button data-period="${days}" class="filter${chartPeriod === days ? ' active' : ''}" ${item.priceSource !== 'live' ? 'disabled title="Períodos disponíveis após recolhas reais"' : ''}>${days === 365 ? '1 ano' : `${days} dias`}</button>`).join('')}</div>${graph}</article><article class="panel"><p class="eyebrow">${item.priceSource === 'live' ? 'Ofertas recolhidas' : 'Ofertas de exemplo'}</p><h2>Por loja</h2><div class="history-table">${offers || `<p class="source-note">${item.priceState === 'desatualizado' ? 'Não há ofertas atuais: a última leitura é demasiado antiga para ser apresentada como oferta.' : 'Ainda não há ofertas recolhidas.'}</p>`}</div><p class="source-note">${item.priceSource === 'live' ? 'Confirma preço e stock na loja antes de comprar. O alerta é local a este navegador; não envia notificações.' : 'Valores demonstrativos; ainda não foram recolhidos preços desta peça.'}</p></article></div>`;
  const svg = document.querySelector('#productDetail .chart-wrap svg'); if (svg) renderChartInto(svg, history);
}
// As regras vivem em dist/compatibility.js (puro e testado em test/compatibility.test.mjs).
function getCompatibility(choice = selections) {
  return window.RigRadarCompatibility.checkCompatibility({ cpu:selected('CPU',choice), board:selected('Motherboard',choice), ram:selected('RAM',choice), gpu:selected('GPU',choice), storage:selected('Armazenamento',choice), psu:selected('Fonte',choice), caseItem:selected('Caixa',choice), cooler:selected('Cooler',choice) });
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
    const match = compatibility.warnings.find(warning => warning.toLowerCase().includes(slot.toLowerCase().replace('fonte','fonte')) || (slot === 'CPU' && warning.includes('socket')) || (slot === 'RAM' && warning.includes('RAM')) || (slot === 'GPU' && (warning.includes('GPU') || warning.includes('PCIe'))) || (slot === 'Caixa' && warning.includes('caixa')) || (slot === 'Cooler' && warning.includes('cooler')) || (slot === 'Armazenamento' && (warning.includes('M.2') || warning.includes('SATA'))));
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
function applyPriceData(data, { offline = false } = {}) {
  if (!PS.isPlainObject(data)) throw new Error('Snapshot de preços inválido.');
  const maxOfferAgeHours = Number.isFinite(data.maxOfferAgeHours) && data.maxOfferAgeHours > 0 ? data.maxOfferAgeHours : PS.DEFAULT_MAX_OFFER_AGE_HOURS;
  snapshotInfo = { generatedAt:typeof data.generatedAt === 'string' && !Number.isNaN(Date.parse(data.generatedAt)) ? data.generatedAt : null, offline, maxOfferAgeHours };
  const counts = { atual:0, 'sem stock':0, desatualizado:0 };
  let newestReading = null;
  for (const update of Array.isArray(data.components) ? data.components : []) {
    const item = byId(update?.id); const state = PS.priceStateOf(update, { maxOfferAgeHours });
    // 'sem leituras' mantém os valores de exemplo do catálogo, que continuam rotulados como tal.
    if (!item || !state || state.state === 'sem leituras') continue;
    const ref = state.reference;
    // Em 'sem stock'/'desatualizado' o preço visível é a última leitura (para contexto e para
    // o total do builder), mas priceState impede que conte como oferta comprável.
    item.price = ref.price; item.store = ref.store; item.availability = ref.availability; item.observedAt = ref.observedAt;
    item.priceSource = 'live'; item.priceState = state.state;
    item.low = state.low; item.avg = state.avg; item.sampleCount = state.sampleCount;
    item.liveOffers = state.stores; item.priceHistory = state.history;
    if (!newestReading || ref.observedAt > newestReading) newestReading = ref.observedAt;
    const recent = liveSeries(item, 30);
    item.change = recent.length > 1 ? Math.round((recent.at(-1).price / recent[0].price - 1) * 1000) / 10 : null;
    counts[state.state]++;
  }
  const liveCount = counts.atual;
  lastSnapshot = { data, offline }; appliedSignature = stateSignature(data, maxOfferAgeHours);
  lastCounts = counts; lastNewestReading = newestReading;
  renderDashboardPrices(liveCount);
  renderSnapshotLabel();
  const sourceStatus = document.getElementById('sourceStatus');
  const warnings = (Array.isArray(data.sources) ? data.sources : []).filter(source => source?.status === 'erro' || source?.status === 'parcial').length;
  if (sourceStatus) sourceStatus.textContent = warnings ? `${warnings} fonte(s) com aviso na última recolha.` : liveCount ? 'Recolha diária ativa; confirma sempre preço e stock na loja.' : counts.desatualizado ? 'Não há leituras recentes: os preços reais mostrados estão desatualizados.' : 'Nenhuma fonte autorizada ativa. Os preços apresentados são de exemplo.';
  renderFocusChart(); renderWatchList(); renderCatalog(); renderBuilder();
  if (document.getElementById('product').classList.contains('active')) renderProduct();
  return liveCount;
}
function stateSignature(data, maxOfferAgeHours) {
  return (Array.isArray(data.components) ? data.components : []).map(update => `${update?.id}:${PS.priceStateOf(update, { maxOfferAgeHours })?.state}`).join('|');
}
// Rótulos de idade (snapshot e contadores) que mudam com o tempo mesmo sem mudar estados.
function renderSnapshotLabel() {
  if (!lastSnapshot) return;
  const counts = lastCounts, liveCount = counts.atual, newestReading = lastNewestReading, offline = snapshotInfo.offline;
  const snapshotText = snapshotInfo.generatedAt ? `snapshot de ${new Date(snapshotInfo.generatedAt).toLocaleString('pt-PT')} (${PS.ageText(snapshotInfo.generatedAt)})` : 'snapshot sem data';
  const offlineText = offline ? ' · cópia guardada (sem resposta da rede)' : '';
  document.getElementById('updatedLabel').textContent = newestReading ? `Última leitura real · ${new Date(newestReading).toLocaleString('pt-PT')} · ${snapshotText}${offlineText}` : `Dados de exemplo · sem leituras reais · ${snapshotText}${offlineText}`;
  const staleText = counts.desatualizado ? `, ${counts.desatualizado} desatualizada${counts.desatualizado > 1 ? 's' : ''}` : '';
  document.querySelector('.sync-state span').textContent = liveCount || counts.desatualizado || counts['sem stock'] ? `${liveCount} peça${liveCount === 1 ? '' : 's'} com preço atual${staleText}` : 'Fontes por configurar';
}
// Um separador pode ficar aberto horas ou dias: uma oferta que passa de maxOfferAgeHours
// tem de deixar de contar como atual (rótulos, alerta de preço-alvo, recomendação) sem
// reload. Só re-renderiza tudo quando algum estado muda; caso contrário atualiza a idade.
function refreshFreshness() {
  if (!lastSnapshot) return false;
  if (stateSignature(lastSnapshot.data, snapshotInfo.maxOfferAgeHours) !== appliedSignature) { applyPriceData(lastSnapshot.data, { offline:lastSnapshot.offline }); return true; }
  renderSnapshotLabel(); return false;
}
// Devolve o número de peças com preço atual, ou null se não houver snapshot utilizável.
// O service worker marca com 'X-RigRadar-Offline' as respostas servidas da cache.
async function loadPrices() {
  try {
    const response = await fetch(staticHosting ? './prices.json' : './api/prices', { cache:'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return applyPriceData(await response.json(), { offline:response.headers.get('X-RigRadar-Offline') === '1' });
  } catch (error) {
    console.warn('Snapshot de preços indisponível:', error);
    if (!snapshotInfo.generatedAt) document.getElementById('updatedLabel').textContent = 'Preços indisponíveis (sem ligação) · a mostrar dados de exemplo';
    return null;
  }
}
async function refreshPrices() {
  const elapsed = Date.now() - lastRefresh;
  // O limite de 10 min protege as fontes quando o servidor local faz recolhas reais.
  // No Pages o botão só relê o snapshot estático, por isso não há limite nem "próxima recolha".
  if (!staticHosting && elapsed < 10 * 60 * 1000 && lastRefresh) { await loadPrices(); showToast(`A usar cache — próxima recolha em ${Math.ceil((10 * 60 * 1000 - elapsed) / 60000)} min.`); return; }
  const buttons = [...document.querySelectorAll('#refreshButton,#catalogRefresh')]; buttons.forEach(button => { button.classList.add('loading'); button.disabled = true; });
  try {
    if (staticHosting) {
      const liveCount = await loadPrices();
      if (liveCount == null) { showToast('Não foi possível ler o snapshot de preços. Verifica a ligação.'); return; }
      const when = snapshotInfo.generatedAt ? `gerado ${PS.ageText(snapshotInfo.generatedAt)}` : 'sem data';
      if (snapshotInfo.offline) showToast(`Sem resposta da rede: a mostrar a cópia guardada do snapshot (${when}).`);
      else showToast(`Snapshot relido (${when}). A recolha corre uma vez por dia no servidor; este botão não inicia uma nova recolha.${liveCount ? '' : ' Ainda não há preços atuais.'}`);
      return;
    }
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
  const periodButton = event.target.closest('[data-period]'); if (periodButton) { chartPeriod = Number(periodButton.dataset.period); document.querySelectorAll('[data-period]').forEach(button => button.classList.toggle('active', Number(button.dataset.period) === chartPeriod)); renderFocusChart(); if (document.getElementById('product').classList.contains('active')) renderProduct(); return; }
  const prompt = event.target.closest('[data-prompt]'); if (prompt) sendMessage(prompt.dataset.prompt);
});
document.addEventListener('change', event => {
  if (event.target.matches('[data-slot]')) { selections[event.target.dataset.slot] = event.target.value; saveBuild(); renderBuilder(); }
  if (event.target.matches('[data-target]')) { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) targets[event.target.dataset.target] = value; else delete targets[event.target.dataset.target]; localStorage.setItem('rigradar-targets', JSON.stringify(targets)); renderWatchList(); renderProduct(); showToast('Preço-alvo guardado neste navegador.'); }
});
document.getElementById('searchInput').addEventListener('input', event => { if (event.target.value.trim()) switchView('catalog'); renderCatalog(); });
document.getElementById('refreshButton').addEventListener('click', refreshPrices); document.getElementById('catalogRefresh').addEventListener('click', refreshPrices);
document.getElementById('chatForm').addEventListener('submit', event => { event.preventDefault(); const input = document.getElementById('chatInput'); sendMessage(input.value); input.value=''; });
document.getElementById('recommendForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const budget = Number(form.elements.budget.value);
  const result = document.getElementById('recommendResult');
  if (!Number.isFinite(budget) || budget < 500) { result.textContent = 'Indica um orçamento válido de pelo menos 500 €.'; return; }
  refreshFreshness(); // garante que nenhuma oferta expirada entra no cálculo
  try {
    const recommendation = recommendBuild({ options:buildOptions, budget, use:form.elements.use.value, resolution:form.elements.resolution.value, priority:form.elements.priority.value, evaluate:getCompatibility });
    if (recommendation.unavailableSlots?.length) { result.textContent = `Não há peças com preço utilizável em: ${recommendation.unavailableSlots.join(', ')}. As leituras reais dessas peças estão desatualizadas ou sem stock; a seleção atual mantém-se.`; return; }
    if (!recommendation.best) { result.textContent = recommendation.cheapest ? `Não há build compatível dentro de ${formatPrice(budget)}. A combinação compatível mais barata custa ${formatPrice(recommendation.cheapest.total)}.` : 'O catálogo não contém uma combinação totalmente compatível.'; return; }
    Object.assign(selections, recommendation.best.choice); saveBuild(); renderBuilder();
    const gpu = selected('GPU'), cpu = selected('CPU');
    // Distinção explícita: preços reais atuais, preços de exemplo (usados para a build de
    // demonstração) e peças com leitura real excluídas por estarem desatualizadas ou sem stock.
    const chosen = slots.map(slot => selected(slot)).filter(item => item.trackable !== false);
    const liveChosen = chosen.filter(item => PS.isBuyable(item)).length;
    const sampleChosen = chosen.filter(item => item.priceSource !== 'live').length;
    const excluded = slots.flatMap(slot => buildOptions[slot]).filter(item => item.priceSource === 'live' && !PS.isBuyable(item));
    const priorityNote = form.elements.priority.value === 'silencio' ? ' Sem medições de ruído, a escolha do cooler é apenas um indicador indireto.' : form.elements.priority.value === 'estetica' ? ' Sem dados de estética no catálogo, foi usada uma escolha equilibrada.' : '';
    result.textContent = `Build compatível aplicada: ${formatPrice(recommendation.best.total)} de ${formatPrice(budget)}. ${cpu.name} e ${gpu.name} equilibram o perfil ${form.elements.use.selectedOptions[0].text.toLowerCase()} com prioridade em ${form.elements.priority.selectedOptions[0].text.toLowerCase()}.${priorityNote} Preços: ${liveChosen} ${liveChosen === 1 ? 'leitura real atual' : 'leituras reais atuais'}${sampleChosen ? `, ${sampleChosen} de exemplo (build de demonstração; confirma antes de comprar)` : ''}.${excluded.length ? ` Excluídas por leitura real desatualizada ou sem stock: ${excluded.map(item => item.short).join(', ')}.` : ''} Confirma stock e total nas lojas.`;
    showToast('Build recomendada aplicada ao PC Builder.');
  } catch (error) { console.error('Falha na recomendação:', error); result.textContent = 'Não foi possível calcular a recomendação neste momento.'; }
});
document.getElementById('recommendForm').addEventListener('change', event => {
  if (event.target.name === 'use') event.target.form.elements.resolution.closest('label').classList.toggle('hidden', event.target.value !== 'gaming');
  document.getElementById('recommendResult').textContent = 'Preferências alteradas. Carrega em “Sugerir build” para recalcular a seleção.';
});
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
  register({name:'get_price_targets',title:'Ler preços-alvo',description:'Devolve os preços-alvo guardados localmente neste navegador.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return { ...targets };}});
}
if (staticHosting) { document.querySelector('.sidebar-footer p').textContent = 'Preços: snapshot diário. IA: análise local até existir proxy seguro.'; }
renderFocusChart(); renderWatchList(); renderCatalog(); renderDashboardPrices(); renderBuilder(); registerWebMCP(); loadPrices();
window.setInterval(refreshFreshness, 60_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshFreshness(); });
}).catch(() => { document.getElementById('updatedLabel').textContent = 'Não foi possível carregar o catálogo.'; });
