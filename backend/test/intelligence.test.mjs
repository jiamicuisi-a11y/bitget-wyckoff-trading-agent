import test from "node:test";
import assert from "node:assert/strict";

import {
  createIntelligenceService,
  extractAssets,
  parseBinanceCatalog,
  parseRssFeed,
  deriveActivityDetails,
  buildMarketContext,
} from "../server/intelligence.mjs";

test("extractAssets finds major assets and futures symbols without duplicates", () => {
  assert.deepEqual(
    extractAssets("Bitcoin, Ethereum, Solana and PONSUSDT will trade alongside BTCUSDT."),
    ["BTC", "ETH", "SOL", "PONS"]
  );
});

test("service returns cached activity with stale source state after a fetch failure", async () => {
  const cached = [{
    id: "binance_activity:abc",
    externalId: "abc",
    title: "Cached Binance activity",
    source: "binance_activity",
    type: "activity",
    publishedAt: "2026-09-07T10:00:00.000Z",
    url: "https://www.binance.com/en/support/announcement/abc",
    summary: "",
    assets: ["BTC"],
    rawAvailable: false,
  }];
  const states = new Map([["binance_activity", { lastSuccessAt: 1_000 }]]);
  const service = createIntelligenceService({
    fetchImpl: async () => { throw new DOMException("timeout", "AbortError"); },
    listItems: ({ source }) => source === "binance_activity" ? cached : [],
    getSourceState: (source) => states.get(source),
    setSourceState: (source, state) => states.set(source, state),
    now: () => 2_000,
  });

  const result = await service.getActivities();
  assert.equal(result.sources.binance_activity.stale, true);
  assert.equal(result.items[0].id, "binance_activity:abc");
  assert.equal(result.items[0].stale, true);
});

test("parseBinanceCatalog keeps public metadata and official article URL", () => {
  const payload = {
    data: {
      catalogs: [{
        articles: [{
          code: "abc123",
          title: "Binance Launchpool: SOL",
          releaseDate: 1_788_674_111_414,
        }],
      }],
    },
  };

  const item = parseBinanceCatalog(payload, "binance_activity", "activity")[0];
  assert.equal(item.id, "binance_activity:abc123");
  assert.equal(item.url, "https://www.binance.com/zh-CN/support/announcement/abc123");
  assert.equal(item.publishedAt, "2026-09-06T05:55:11.414Z");
  assert.deepEqual(item.assets, ["SOL"]);
});

test("service requests the Binance Chinese-language catalog", async () => {
  let headers;
  const service = createIntelligenceService({
    fetchImpl: async (_url, options) => {
      headers = options.headers;
      return { ok: true, json: async () => ({ data: { catalogs: [{ articles: [{ code: "cn-1", title: "币安中文站活动", releaseDate: 1_788_674_111_414 }] }] } }) };
    },
  });
  const result = await service.getActivities();
  assert.equal(headers["Accept-Language"], "zh-CN,zh;q=0.9");
  assert.equal(headers.lang, "zh-CN");
  assert.equal(headers.language, "zh-CN");
  assert.equal(result.items[0].title, "币安中文站活动");
});

test("parseRssFeed preserves link, publication time, and strips markup from description", () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><guid>news-1</guid><title>ETH jumps on protocol update</title><link>https://example.test/eth</link><pubDate>Sun, 07 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Ethereum update <strong>details</strong>.</p>]]></description></item></channel></rss>`;
  const item = parseRssFeed(xml, "coindesk", "news")[0];
  assert.equal(item.id, "coindesk:news-1");
  assert.equal(item.url, "https://example.test/eth");
  assert.equal(item.publishedAt, "2026-09-07T10:00:00.000Z");
  assert.equal(item.summary, "Ethereum update details.");
  assert.deepEqual(item.assets, ["ETH"]);
});

test("activity details summarize Chinese qualification, reward, dates, and status", () => {
  const details = deriveActivityDetails({
    title: "现货交易锦标赛：瓜分 300,000 USDC 奖池",
    summary: "活动时间：2026年09月04日14:00:00至2026年10月04日23:59:00（东八区时间）。如何参与：完成指定交易任务。奖励：瓜分300,000 USDC奖池。",
    now: Date.parse("2026-09-08T00:00:00.000Z"),
  });
  assert.equal(details.category, "交易活动");
  assert.equal(details.status, "active");
  assert.match(details.reward, /300,000 USDC/);
  assert.match(details.participation, /完成指定交易任务/);
  assert.equal(details.endsAt, "2026-10-04T15:59:00.000Z");
});

test("market context exposes strategy reasons and open positions", () => {
  const context = buildMarketContext({ assets: ["SOL"] }, {
    tickers: [{ symbol: "SOLUSDT", changeUtc24h: "0.08", usdtVolume: "500000", fundingRate: "0.001" }],
    candidatesByStrategy: { "anomaly-binance": [{ symbol: "SOLUSDT", score: 86, tag: "OI 与主动买盘同步" }] },
    positionsByStrategy: { "dualma4h-binance": [{ symbol: "SOLUSDT", direction: "long", entry_price: 100 }] },
  });
  assert.deepEqual(context.assets[0].candidateStrategies, ["anomaly-binance"]);
  assert.equal(context.assets[0].candidateMatches[0].reason, "OI 与主动买盘同步");
  assert.equal(context.assets[0].positionMatches[0].strategy, "dualma4h-binance");
});
