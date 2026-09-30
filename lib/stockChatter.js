// Stock-analysis and analyst-rating pieces ("Rated Strong Sell", "Buy, Sell Or
// Hold", "Share Price Rise: Key Facts", "How should you trade X") aren't
// business news for a hotel sales team, and a rating shown next to a company
// would read as investment advice. Used wherever a company's headlines are shown.
// The word "stock(s)" itself is the strongest sign: business news about a hotel
// company rarely uses it, market commentary almost always does.
const STOCK_CHATTER_RE = new RegExp(
  [
    "\\b(rated|ratings?|downgraded?|strong (buy|sell)|buy or sell|buy,? sell|sell or hold|target price|price target|share price|trade spotlight|volume shocker|how should you trade|technical (analysis|outlook)|upper circuit|lower circuit|block deal|multibagger|52-week (high|low))\\b",
    "\\bstocks?\\b",
    "\\bshares? (rise|rises|fall|falls|jump|jumps|surge|surges|slip|slips|gain|gains|drop|drops|climb|climbs|tank|tanks)\\b",
    // exchange tickers ("HAN:MY1", "NSE: LEMONTREE") and balance-sheet line items
    "\\b(NSE|BSE|NASDAQ|NYSE|HAN|FRA) ?: ?[A-Z0-9]+",
    "\\b(cost of goods sold|market cap|p/e ratio|dividend yield)\\b",
    // "X vs Y vs Z" stock comparisons
    "\\bvs\\.? .+ vs\\.? ",
  ].join("|"),
  "i"
);

const isStockChatter = (title) => STOCK_CHATTER_RE.test(title || "");

module.exports = { isStockChatter };
