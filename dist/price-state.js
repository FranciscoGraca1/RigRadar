// Lógica pura de estado dos preços e de leitura do armazenamento local.
// Script clássico (sem build step): no browser expõe `RigRadarPriceState`;
// em Node (testes) é carregado via require, porque não há package.json com "type".
(function (root) {
  const AVAILABLE = ['Em stock', 'Limitado'];
  // Igual a OFFER_MAX_AGE_HOURS em server/price-service.mjs. O snapshot traz o valor
  // usado na geração; este é só o fallback para snapshots antigos sem o campo.
  const DEFAULT_MAX_OFFER_AGE_HOURS = 48;
  const STATES = ['atual', 'sem stock', 'desatualizado', 'sem leituras'];

  const validTime = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));
  const validPrice = value => Number.isFinite(value) && value > 0;

  // Lê JSON do localStorage sem nunca lançar: um valor corrompido ou de tipo errado
  // (edição manual, versão antiga, extensão) não pode impedir a aplicação de arrancar.
  function readStored(storage, key, fallback, isValid) {
    try {
      const raw = storage.getItem(key);
      if (raw == null) return fallback;
      const value = JSON.parse(raw);
      return isValid(value) ? value : fallback;
    } catch { return fallback; }
  }
  const isPlainObject = value => value != null && typeof value === 'object' && !Array.isArray(value);

  // Converte uma entrada de prices.json no estado mostrado pelo frontend.
  // Volta a verificar a idade no browser: um snapshot servido pela cache offline dias
  // depois tem de passar a "desatualizado", mesmo que o servidor o tenha marcado "atual".
  function priceStateOf(update, { now = Date.now(), maxOfferAgeHours = DEFAULT_MAX_OFFER_AGE_HOURS } = {}) {
    if (!isPlainObject(update) || typeof update.id !== 'string') return null;
    const maxAgeMs = (Number.isFinite(maxOfferAgeHours) && maxOfferAgeHours > 0 ? maxOfferAgeHours : DEFAULT_MAX_OFFER_AGE_HOURS) * 3_600_000;
    const history = (Array.isArray(update.history) ? update.history : []).filter(point => isPlainObject(point) && validPrice(point.price) && validTime(point.timestamp));
    const stores = (Array.isArray(update.stores) ? update.stores : []).filter(offer => isPlainObject(offer) && validPrice(offer.price) && typeof offer.store === 'string');
    const lastSeen = isPlainObject(update.lastSeen) && validPrice(update.lastSeen.price) && validTime(update.lastSeen.observedAt) ? update.lastSeen : null;
    const hasCurrent = validPrice(update.price) && validTime(update.observedAt);
    // Snapshots anteriores à política de frescura não têm `status`: inferir do preço.
    let state = STATES.includes(update.status) ? update.status : hasCurrent ? 'atual' : 'sem leituras';
    if (state === 'atual' && (!hasCurrent || !AVAILABLE.includes(update.availability))) state = lastSeen || hasCurrent ? 'desatualizado' : 'sem leituras';
    const reference = state === 'atual' ? { price:update.price, store:update.store, availability:update.availability, observedAt:update.observedAt } : lastSeen || (hasCurrent ? { price:update.price, store:update.store, availability:update.availability, observedAt:update.observedAt } : null);
    if (state === 'atual' && now - Date.parse(reference.observedAt) > maxAgeMs) state = 'desatualizado';
    if (state === 'sem stock' && !reference) state = 'sem leituras';
    if (state === 'desatualizado' && !reference) state = 'sem leituras';
    return {
      id:update.id, state, reference,
      stores:state === 'desatualizado' ? [] : stores,
      history,
      low:validPrice(update.low) ? update.low : null,
      avg:validPrice(update.avg) ? update.avg : null,
      sampleCount:Number.isInteger(update.sampleCount) && update.sampleCount >= 0 ? update.sampleCount : 0
    };
  }

  // Só um preço real, fresco e com stock conta como comprável (alertas, recomendação).
  function isBuyable(item) {
    return item?.priceSource === 'live' && item.priceState === 'atual' && AVAILABLE.includes(item.availability);
  }

  function ageText(isoTime, now = Date.now()) {
    if (!validTime(isoTime)) return 'data desconhecida';
    const minutes = Math.max(0, Math.round((now - Date.parse(isoTime)) / 60_000));
    if (minutes < 60) return minutes <= 1 ? 'há instantes' : `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `há ${hours} h`;
    const days = Math.floor(hours / 24);
    return `há ${days} dias`;
  }

  // Rótulo curto e consistente para cada estado (texto + classe CSS).
  function priceBadge(item) {
    if (item?.priceSource !== 'live') return { text:'Preço de exemplo', tone:'sample' };
    if (item.priceState === 'sem stock') return { text:'Sem stock', tone:'unavailable' };
    if (item.priceState === 'desatualizado') return { text:'Preço desatualizado', tone:'stale' };
    return { text:'Preço real', tone:'live' };
  }

  const api = { AVAILABLE, DEFAULT_MAX_OFFER_AGE_HOURS, readStored, isPlainObject, priceStateOf, isBuyable, ageText, priceBadge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RigRadarPriceState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
