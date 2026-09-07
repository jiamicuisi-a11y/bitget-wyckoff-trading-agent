import test from "node:test";
import assert from "node:assert/strict";

import { routeIntent } from "../server/agent-chat.mjs";

const capabilities = {
  strategies: [{ key: "anomaly-binance", name: "A档异动扫描", source: "binance" }],
  tools: [
    { name: "market_intelligence_feed" },
    { name: "binance_activity_list" },
    { name: "event_market_context" },
  ],
};

test("routes Binance activity questions to the activity tool", () => {
  const plan = routeIntent("Binance 最近有哪些活动可以参与？", "anomaly-binance", capabilities);
  assert.deepEqual(plan.toolNames, ["binance_activity_list"]);
  assert.equal(plan.intent, "activities");
});

test("routes news and announcement questions to the intelligence feed", () => {
  const plan = routeIntent("今天 BTC 有什么重要资讯和公告？", "anomaly-binance", capabilities);
  assert.deepEqual(plan.toolNames, ["market_intelligence_feed"]);
  assert.equal(plan.intent, "intelligence");
  assert.equal(plan.toolArgs.market_intelligence_feed.asset, "BTC");
});
