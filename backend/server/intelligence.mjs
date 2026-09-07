const BINANCE_CMS = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query";
const COINDESK_RSS = "https://www.coindesk.com/arc/outboundfeeds/rss/";
const MAJOR_ASSETS = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "SUI", "TON", "TRX", "DOT", "LTC", "BCH", "UNI", "AAVE", "PEPE", "SHIB", "NEAR", "ATOM", "ARB", "OP"]);
const ASSET_ALIASES = [
  ["BITCOIN", "BTC"],
  ["ETHEREUM", "ETH"],
  ["SOLANA", "SOL"],
  ["BINANCE COIN", "BNB"],
];

export const INTELLIGENCE_SOURCES = [
  { key: "binance_activity", label: "Binance 官方活动", type: "activity", catalogId: 93 },
  { key: "binance_announcement", label: "Binance 公告", type: "announcement", catalogId: 49 },
  { key: "binance_listing", label: "Binance 上币公告", type: "announcement", catalogId: 48 },
  { key: "coindesk", label: "CoinDesk", type: "news", url: COINDESK_RSS },
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toIso(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function rssField(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return decodeHtml(match?.[1] || "");
}

function stableId(value) {
  let hash = 5381;
  for (const char of String(value || "")) hash = ((hash << 5) + hash) ^ char.charCodeAt(0);
  return (hash >>> 0).toString(36);
}

export function extractAssets(text) {
  const value = String(text || "").toUpperCase();
  const result = [];
  for (const [name, symbol] of ASSET_ALIASES) {
    if (new RegExp(`\\b${name}\\b`).test(value)) result.push(symbol);
  }
  const pattern = /\b([A-Z0-9]{2,12})USDT\b|\b([A-Z0-9]{2,12})\b/g;
  let match;
  while ((match = pattern.exec(value))) {
    const symbol = match[1] || match[2];
    if (match[1] || MAJOR_ASSETS.has(symbol)) result.push(symbol);
  }
  return unique(result);
}

export function parseBinanceCatalog(payload, source, type) {
  const catalogs = Array.isArray(payload?.data?.catalogs) ? payload.data.catalogs : [];
  return catalogs.flatMap((catalog) => Array.isArray(catalog?.articles) ? catalog.articles : [])
    .filter((article) => article?.code && article?.title)
    .map((article) => {
      const externalId = String(article.code);
      const summary = decodeHtml(article.brief || article.summary || article.description || "");
      return {
        id: `${source}:${externalId}`,
        externalId,
        title: String(article.title),
        source,
        type,
        publishedAt: toIso(article.releaseDate || article.publishDate),
        url: `https://www.binance.com/en/support/announcement/${externalId}`,
        summary,
        assets: extractAssets(`${article.title} ${summary}`),
        rawAvailable: false,
      };
    });
}

export function parseRssFeed(xml, source = "coindesk", type = "news") {
  const items = String(xml || "").match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => {
    const title = rssField(item, "title");
    const url = rssField(item, "link");
    const guid = rssField(item, "guid");
    const date = Date.parse(rssField(item, "pubDate") || rssField(item, "dc:date"));
    const summary = rssField(item, "description");
    const externalId = /^[a-z0-9_-]{1,180}$/i.test(guid) ? guid : stableId(url || title);
    return {
      id: `${source}:${externalId}`,
      externalId,
      title,
      source,
      type,
      publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
      url,
      summary,
      assets: extractAssets(`${title} ${summary}`),
      rawAvailable: false,
    };
  }).filter((item) => item.title && item.url);
}

function binanceCatalogUrl(catalogId) {
  const url = new URL(BINANCE_CMS);
  url.searchParams.set("type", "1");
  url.searchParams.set("catalogId", String(catalogId));
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("pageSize", "20");
  return url.toString();
}

function sourceDefinition(source) {
  if (source.catalogId) return { ...source, url: binanceCatalogUrl(source.catalogId), parser: parseBinanceCatalog };
  return { ...source, parser: parseRssFeed };
}

export function buildMarketContext(item, data = {}) {
  const tickers = Array.isArray(data.tickers) ? data.tickers : [];
  const candidatesByStrategy = data.candidatesByStrategy || {};
  const oiBySymbol = data.oiBySymbol || {};
  return {
    assets: (item.assets || []).map((asset) => {
      const futuresSymbol = `${asset}USDT`;
      const ticker = tickers.find((row) => row.symbol === futuresSymbol);
      const candidateStrategies = Object.entries(candidatesByStrategy)
        .filter(([, candidates]) => Array.isArray(candidates) && candidates.some((candidate) => candidate.symbol === futuresSymbol))
        .map(([strategy]) => strategy);
      return {
        asset,
        futuresSymbol: ticker ? futuresSymbol : null,
        change24hPct: ticker ? Number(ticker.changeUtc24h || 0) * 100 : null,
        volumeUsd: ticker ? Number(ticker.usdtVolume || 0) : null,
        fundingRate: ticker ? Number(ticker.fundingRate || 0) : null,
        oiChangePct: oiBySymbol[futuresSymbol]?.changePct ?? null,
        candidateStrategies,
      };
    }),
  };
}

export function createIntelligenceService({
  fetchImpl = fetch,
  now = () => Date.now(),
  ttlMs = 10 * 60 * 1000,
  listItems = () => [],
  saveItems = () => {},
  getSourceState = () => null,
  setSourceState = () => {},
  getMarketData = () => ({}),
} = {}) {
  const memory = new Map();

  async function refresh(source) {
    const cached = memory.get(source.key);
    if (cached && now() - cached.fetchedAt < ttlMs) return cached;
    const definition = sourceDefinition(source);
    const attemptedAt = now();
    try {
      const response = await fetchImpl(definition.url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json, application/xml, text/xml;q=0.9" } });
      if (!response.ok) throw new Error(`${source.key} HTTP ${response.status}`);
      const body = source.catalogId ? await response.json() : await response.text();
      const items = source.catalogId
        ? definition.parser(body, source.key, source.type)
        : definition.parser(body, source.key, source.type);
      saveItems(items, attemptedAt);
      const state = { source: source.key, lastSuccessAt: attemptedAt, lastAttemptAt: attemptedAt, stale: false, error: null };
      setSourceState(source.key, state);
      const value = { items, fetchedAt: attemptedAt, state };
      memory.set(source.key, value);
      return value;
    } catch (error) {
      const items = cached?.items || listItems({ source: source.key }) || [];
      const prior = getSourceState(source.key) || {};
      const state = {
        source: source.key,
        lastSuccessAt: prior.lastSuccessAt || cached?.state?.lastSuccessAt || null,
        lastAttemptAt: attemptedAt,
        stale: true,
        error: error?.message || "数据源暂时不可用",
      };
      setSourceState(source.key, state);
      return { items, fetchedAt: prior.lastSuccessAt || cached?.fetchedAt || null, state };
    }
  }

  function selectSources(filters = {}) {
    const requested = String(filters.source || "all");
    if (requested === "all") return INTELLIGENCE_SOURCES;
    return INTELLIGENCE_SOURCES.filter((source) => source.key === requested);
  }

  function filterItems(items, filters = {}) {
    const asset = String(filters.asset || "").trim().toUpperCase().replace(/USDT$/, "");
    const type = String(filters.type || "all");
    const limit = Math.min(Math.max(Number(filters.limit) || 60, 1), 100);
    return items
      .filter((item) => type === "all" || item.type === type)
      .filter((item) => !asset || item.assets.includes(asset))
      .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
      .slice(0, limit);
  }

  async function getFeed(filters = {}) {
    const results = await Promise.all(selectSources(filters).map(refresh));
    const sourceStates = Object.fromEntries(results.map((result) => [result.state.source, result.state]));
    const items = filterItems(results.flatMap((result) => result.items.map((item) => ({ ...item, stale: result.state.stale }))), filters)
      .map((item) => ({ ...item, marketContext: buildMarketContext(item, getMarketData()) }));
    return { items, sources: sourceStates, stale: Object.values(sourceStates).some((state) => state.stale), fetchedAt: new Date(now()).toISOString() };
  }

  async function getActivities(filters = {}) {
    return getFeed({ ...filters, source: "binance_activity", type: "activity" });
  }

  async function getEvent(id) {
    const feed = await getFeed({ limit: 100 });
    const item = feed.items.find((candidate) => candidate.id === id);
    return item || null;
  }

  return { getFeed, getActivities, getEvent };
}
