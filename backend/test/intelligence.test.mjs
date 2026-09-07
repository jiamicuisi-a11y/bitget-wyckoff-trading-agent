import test from "node:test";
import assert from "node:assert/strict";

import {
  createIntelligenceService,
  extractAssets,
  parseBinanceCatalog,
  parseRssFeed,
} from "../server/intelligence.mjs";

test("extractAssets finds major assets and futures symbols without duplicates", () => {
  assert.deepEqual(
    extractAssets("BTC, ETH and PONSUSDT will trade alongside BTCUSDT."),
    ["BTC", "ETH", "PONS"]
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
  assert.equal(item.url, "https://www.binance.com/en/support/announcement/abc123");
  assert.equal(item.publishedAt, "2026-09-06T05:55:11.414Z");
  assert.deepEqual(item.assets, ["SOL"]);
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
