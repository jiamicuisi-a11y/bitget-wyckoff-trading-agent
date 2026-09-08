const BINANCE_CMS = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query";
const MAJOR_ASSETS = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "SUI", "TON", "TRX", "DOT", "LTC", "BCH", "UNI", "AAVE", "PEPE", "SHIB", "NEAR", "ATOM", "ARB", "OP", "HYPE", "PUMP", "ZEC", "PONS", "ASTER", "TRUMP", "MEME", "AI", "CASHCAT", "MARSCOIN"]);
const ASSET_ALIASES = [
  ["BITCOIN", "BTC"],
  ["ETHEREUM", "ETH"],
  ["SOLANA", "SOL"],
  ["BINANCE COIN", "BNB"],
];

export const INTELLIGENCE_SOURCES = [
  { key: "binance_activity", label: "币安官方活动", type: "activity", catalogId: 93 },
  { key: "binance_announcement", label: "币安公告", type: "announcement", catalogId: 49 },
  { key: "binance_listing", label: "币安上币公告", type: "announcement", catalogId: 48 },
  { key: "panews", label: "PANews 中文资讯", type: "news", rssUrl: "https://www.panewslab.com/rss.xml" },
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
  const parenthesized = value.match(/\(([A-Z0-9]{2,12})\)/g) || [];
  for (const token of parenthesized) {
    const symbol = token.slice(1, -1);
    if (symbol !== "USDT" && symbol !== "USD" && symbol !== "BTC" && symbol !== "ETH") result.push(symbol);
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
        url: `https://www.binance.com/zh-CN/support/announcement/${externalId}`,
        summary,
        assets: extractAssets(`${article.title} ${summary}`),
        rawAvailable: false,
        activityDetails: type === "activity" ? deriveActivityDetails({ title: String(article.title), summary, publishedAt: toIso(article.releaseDate || article.publishDate) }) : null,
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
  if (source.catalogId) return {
    ...source,
    url: binanceCatalogUrl(source.catalogId),
    parser: parseBinanceCatalog,
    headers: { "Accept-Language": "zh-CN,zh;q=0.9", lang: "zh-CN", language: "zh-CN" },
  };
  return {
    ...source,
    url: source.rssUrl,
    parser: parseRssFeed,
    headers: { "Accept-Language": "zh-CN,zh;q=0.9" },
  };
}

function plainTextFromRichBody(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(plainTextFromRichBody).join(" ");
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    return plainTextFromRichBody(value.child || value.children || "");
  }
  return "";
}

function parseChineseDate(value, endOfDay = false) {
  const text = String(value || "");
  const match = text.match(/(\d{4})[年\/-](\d{1,2})[月\/-](\d{1,2})日?(?:\s*(\d{1,2}):?(\d{2})?(?::?(\d{2}))?)?/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? (endOfDay ? 23 : 0) : Number(match[4]);
  const minute = match[5] === undefined ? (endOfDay ? 59 : 0) : Number(match[5]);
  const second = match[6] === undefined ? (endOfDay ? 59 : 0) : Number(match[6]);
  const timestamp = Date.UTC(year, month - 1, day, hour - 8, minute, second);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function firstMatchingSentence(text, labels) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  for (const label of labels) {
    const index = normalized.indexOf(label);
    if (index < 0) continue;
    const tail = normalized.slice(index + label.length).replace(/^[:：\s]+/, "");
    const sentence = tail.split(/(?:。|；|;|\n)/)[0].trim();
    if (sentence) return sentence.slice(0, 220);
  }
  return "";
}

function activityCategory(title) {
  const text = String(title || "");
  if (/邀请|新用户|礼品|礼金/.test(text)) return "邀请与新用户";
  if (/交易|锦标赛|竞赛|奖池/.test(text)) return "交易活动";
  if (/理财|申购|收益|借贷|贷款/.test(text)) return "理财活动";
  if (/钱包|链上|返佣/.test(text)) return "钱包活动";
  if (/学院|测试|学习/.test(text)) return "学习活动";
  return "币安官方活动";
}

function extractReward(title, text) {
  const titleMatch = String(title || "").match(/(?:最高|瓜分|享|奖励|奖池|收益率|返现|折扣)[^。；;]{0,120}/);
  if (titleMatch?.[0]) return titleMatch[0].replace(/^[：:\s]+/, "").trim();
  const labeled = String(text || "").match(/(?:奖励|奖池|礼金|代币券|收益率|返现|折扣)[：:]?[^。；;]{0,180}/);
  return labeled?.[0]?.trim() || "奖励与具体数量以官方规则为准";
}

export function deriveActivityDetails({ title, summary = "", publishedAt = null, now = Date.now() } = {}) {
  const text = `${title || ""} ${summary || ""}`.replace(/\s+/g, " ").trim();
  const dates = [...text.matchAll(/\d{4}[年\/-]\d{1,2}[月\/-]\d{1,2}日?(?:\s*\d{1,2}:?\d{2}(?::?\d{2})?)?/g)].map((match) => match[0]);
  const startsAt = dates[0] ? parseChineseDate(dates[0]) : null;
  const endsAt = dates[1] ? parseChineseDate(dates[1], true) : null;
  const reward = extractReward(title, text);
  const qualification = firstMatchingSentence(text, ["参与条件", "参与资格", "如何参与", "活动对象", "受邀人需要"]) || "请以官方规则中的地区、账户、充值和交易要求为准";
  const participation = firstMatchingSentence(text, ["如何参与", "参与方式", "确认参与"]) || qualification;
  const nowMs = Number(now);
  const startMs = startsAt ? Date.parse(startsAt) : null;
  const endMs = endsAt ? Date.parse(endsAt) : null;
  const status = endMs && nowMs >= endMs ? "ended" : startMs && nowMs < startMs ? "upcoming" : startsAt || endMs ? "active" : "unknown";
  const statusLabel = { upcoming: "即将开始", active: "进行中", ended: "已结束", unknown: "时间未明确" }[status];
  return {
    category: activityCategory(title),
    reward: reward.slice(0, 240),
    qualification: qualification.slice(0, 260),
    participation: participation.slice(0, 260),
    startsAt,
    endsAt,
    status,
    statusLabel,
    sourceUpdatedAt: publishedAt,
  };
}

async function enrichBinanceActivity(item, fetchImpl, now) {
  const fallback = item.activityDetails || deriveActivityDetails(item);
  const url = `https://www.binance.com/bapi/composite/v1/public/cms/article/detail/query?articleCode=${encodeURIComponent(item.externalId)}`;
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json", "Accept-Language": "zh-CN,zh;q=0.9", lang: "zh-CN", language: "zh-CN" },
    });
    if (!response.ok) throw new Error(`activity detail HTTP ${response.status}`);
    const payload = await response.json();
    const detail = payload?.data || {};
    const summary = decodeHtml(detail.seoDesc || plainTextFromRichBody(detail.body)).slice(0, 1200);
    return {
      ...item,
      summary: summary || item.summary,
      assets: extractAssets(`${item.title} ${summary || item.summary}`),
      rawAvailable: Boolean(detail.body || detail.contentJson),
      activityDetails: deriveActivityDetails({ title: item.title, summary: summary || item.summary, publishedAt: item.publishedAt, now }),
    };
  } catch {
    return { ...item, activityDetails: fallback };
  }
}

export function buildMarketContext(item, data = {}) {
  const tickers = Array.isArray(data.tickers) ? data.tickers : [];
  const candidatesByStrategy = data.candidatesByStrategy || {};
  const positionsByStrategy = data.positionsByStrategy || {};
  const oiBySymbol = data.oiBySymbol || {};
  return {
    assets: (item.assets || []).map((asset) => {
      const futuresSymbol = `${asset}USDT`;
      const ticker = tickers.find((row) => row.symbol === futuresSymbol);
      const candidateStrategies = Object.entries(candidatesByStrategy)
        .filter(([, candidates]) => Array.isArray(candidates) && candidates.some((candidate) => candidate.symbol === futuresSymbol))
        .map(([strategy]) => strategy);
      const candidateMatches = Object.entries(candidatesByStrategy).flatMap(([strategy, candidates]) =>
        (Array.isArray(candidates) ? candidates : [])
          .filter((candidate) => candidate.symbol === futuresSymbol)
          .map((candidate) => ({
            strategy,
            score: candidate.score ?? null,
            direction: candidate.direction || null,
            reason: candidate.tag || candidate.reason || "策略条件满足",
          }))
      );
      const positionMatches = Object.entries(positionsByStrategy).flatMap(([strategy, positions]) =>
        (Array.isArray(positions) ? positions : [])
          .filter((position) => position.symbol === futuresSymbol)
          .map((position) => ({ strategy, direction: position.direction || null, entryPrice: position.entry_price ?? null }))
      );
      return {
        asset,
        futuresSymbol: ticker ? futuresSymbol : null,
        change24hPct: ticker ? Number(ticker.changeUtc24h || 0) * 100 : null,
        volumeUsd: ticker ? Number(ticker.usdtVolume || 0) : null,
        fundingRate: ticker ? Number(ticker.fundingRate || 0) : null,
        oiChangePct: oiBySymbol[futuresSymbol]?.changePct ?? null,
        candidateStrategies,
        candidateMatches,
        positionMatches,
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
      const response = await fetchImpl(definition.url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json, application/xml, text/xml;q=0.9", ...definition.headers } });
      if (!response.ok) throw new Error(`${source.key} HTTP ${response.status}`);
      const body = source.catalogId ? await response.json() : await response.text();
      let items = source.catalogId
        ? definition.parser(body, source.key, source.type)
        : definition.parser(body, source.key, source.type);
      if (source.type === "activity" && items.length) {
        items = await Promise.all(items.map((item) => enrichBinanceActivity(item, fetchImpl, attemptedAt)));
      }
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
