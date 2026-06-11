/* ═══════════════════════════════════════════
   CREATE WITH ALLI — Web3 Price Oracle Worker
   Cloudflare Worker — Edge-cached price proxy

   Deploy:
     wrangler deploy workers/web3-worker.js --name createwithalli-web3

   Optional secrets (set via Cloudflare dashboard or CLI):
     wrangler secret put COINGECKO_API_KEY   # Pro tier API key
     wrangler secret put ETH_RPC_URL         # Custom RPC endpoint

   Routes (add in Cloudflare dashboard):
     createwithalli.com/api/web3/*
═══════════════════════════════════════════ */

const CG_FREE = 'https://api.coingecko.com/api/v3';
const CG_PRO  = 'https://pro-api.coingecko.com/api/v3';
const TTL     = 60; // cache seconds

const SYMBOL_MAP = {
  BTC: 'bitcoin',          ETH: 'ethereum',        SOL: 'solana',
  XRP: 'ripple',           ADA: 'cardano',          DOGE: 'dogecoin',
  LINK: 'chainlink',       SUI: 'sui',              TAO: 'bittensor',
  FET: 'fetch-ai',         DOT: 'polkadot',         AVAX: 'avalanche-2',
  MATIC: 'matic-network',  UNI: 'uniswap',          AAVE: 'aave',
  OP: 'optimism',          ARB: 'arbitrum',          INJ: 'injective-protocol',
  ATOM: 'cosmos',          NEAR: 'near',             APT: 'aptos',
  SEI: 'sei-network',      TIA: 'celestia',          PYTH: 'pyth-network',
  JUP: 'jupiter-exchange-solana',
  WIF: 'dogwifcoin',       BONK: 'bonk',             PEPE: 'pepe',
  SHIB: 'shiba-inu',       LTC: 'litecoin',          BCH: 'bitcoin-cash',
  FLOKI: 'floki',          RENDER: 'render-token',   GRT: 'the-graph',
};

const ALL_IDS = Object.values(SYMBOL_MAP).join(',');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function cgHeaders(env) {
  const key = env?.COINGECKO_API_KEY;
  return key ? { 'x-cg-pro-api-key': key } : {};
}

function cgBase(env) {
  return env?.COINGECKO_API_KEY ? CG_PRO : CG_FREE;
}

async function cachedFetch(url, headers = {}) {
  const cache    = caches.default;
  const req      = new Request(url, { method: 'GET', headers });
  const hit      = await cache.match(req);
  if (hit) return { data: await hit.json(), cached: true };

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Upstream ${res.status} from ${url}`);

  const data   = await res.json();
  const stored = new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` },
  });
  await cache.put(req, stored);
  return { data, cached: false };
}

// GET /api/web3/prices?ids=bitcoin,ethereum&vs=usd
async function handlePrices(url, env) {
  const ids = url.searchParams.get('ids') || ALL_IDS;
  const vs  = url.searchParams.get('vs')  || 'usd';

  const endpoint = `${cgBase(env)}/simple/price?ids=${ids}&vs_currencies=${vs}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  const { data, cached } = await cachedFetch(endpoint, cgHeaders(env));
  return jsonResp({ ok: true, cached, data });
}

// GET /api/web3/price/:symbol
async function handleSymbol(symbol, env) {
  const upper = symbol.toUpperCase();
  let id = SYMBOL_MAP[upper];

  if (!id) {
    // Fall back to CoinGecko search
    const searchUrl = `${cgBase(env)}/search?query=${encodeURIComponent(symbol)}`;
    const { data }  = await cachedFetch(searchUrl, cgHeaders(env));
    const coin      = data.coins?.[0];
    if (!coin) return jsonResp({ ok: false, error: 'Token not found' }, 404);
    id = coin.id;
  }

  const priceUrl    = `${cgBase(env)}/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  const { data }    = await cachedFetch(priceUrl, cgHeaders(env));
  const priceEntry  = data[id];
  if (!priceEntry)  return jsonResp({ ok: false, error: 'Price data unavailable' }, 404);

  // Also fetch coin info for name/image
  let name = id, thumb = null;
  try {
    const infoUrl   = `${cgBase(env)}/coins/${id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`;
    const { data: info } = await cachedFetch(infoUrl, cgHeaders(env));
    name  = info.name  || id;
    thumb = info.image?.thumb || null;
  } catch { /* non-critical */ }

  return jsonResp({ ok: true, token: { id, symbol: upper, name, thumb, ...priceEntry } });
}

// GET /api/web3/portfolio/:address
async function handlePortfolio(address, env) {
  const rpc = env?.ETH_RPC_URL || 'https://cloudflare-eth.com';

  // ETH balance via JSON-RPC
  const rpcRes = await fetch(rpc, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
  });
  if (!rpcRes.ok) return jsonResp({ ok: false, error: 'RPC error' }, 502);

  const rpcData    = await rpcRes.json();
  const balanceWei = BigInt(rpcData.result || '0x0');
  const balanceEth = Number(balanceWei) / 1e18;

  // ETH price (cached separately)
  let ethPrice = 0;
  try {
    const priceUrl   = `${CG_FREE}/simple/price?ids=ethereum&vs_currencies=usd`;
    const { data }   = await cachedFetch(priceUrl);
    ethPrice         = data.ethereum?.usd || 0;
  } catch { /* best-effort */ }

  return jsonResp({
    ok: true,
    address,
    eth: {
      balance:  balanceEth.toFixed(6),
      usd:      (balanceEth * ethPrice).toFixed(2),
      price:    ethPrice,
    },
  });
}

// GET /api/web3/trending
async function handleTrending(env) {
  const url          = `${cgBase(env)}/search/trending`;
  const { data }     = await cachedFetch(url, cgHeaders(env));
  const coins        = (data.coins || []).slice(0, 10).map(({ item }) => ({
    id:     item.id,
    symbol: item.symbol.toUpperCase(),
    name:   item.name,
    thumb:  item.thumb,
    rank:   item.market_cap_rank,
  }));
  return jsonResp({ ok: true, coins });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const path = url.pathname.replace(/^\/api\/web3/, '');

    try {
      if (path === '/prices' || path === '/prices/')
        return await handlePrices(url, env);

      if (path === '/trending' || path === '/trending/')
        return await handleTrending(env);

      const symbolMatch    = path.match(/^\/price\/([A-Za-z0-9]{1,20})$/);
      if (symbolMatch)     return await handleSymbol(symbolMatch[1], env);

      const portfolioMatch = path.match(/^\/portfolio\/(0x[a-fA-F0-9]{40})$/);
      if (portfolioMatch)  return await handlePortfolio(portfolioMatch[1], env);

      return jsonResp({
        ok: false,
        error: 'Not found',
        routes: ['/api/web3/prices', '/api/web3/price/:symbol', '/api/web3/portfolio/:address', '/api/web3/trending'],
      }, 404);
    } catch (err) {
      return jsonResp({ ok: false, error: err.message }, 500);
    }
  },
};
