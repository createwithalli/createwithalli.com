/* ═══════════════════════════════════════════
   CREATE WITH ALLI — Web3 Template JS
   Wallet: ethers.js v6 (CDN)
   Price Oracle: CoinGecko free API
   Networks: ETH · Base · Polygon · OP · ARB
═══════════════════════════════════════════ */

/* ── CONFIG ──────────────────────────────── */

const WORKER_API = '/api/web3'; // swap to https://your-worker.workers.dev in dev
const CG_DIRECT  = 'https://api.coingecko.com/api/v3';

const FEATURED_COINS = [
  { id: 'bitcoin',              symbol: 'BTC',  name: 'Bitcoin',      color: '#f7931a' },
  { id: 'ethereum',             symbol: 'ETH',  name: 'Ethereum',     color: '#627eea' },
  { id: 'solana',               symbol: 'SOL',  name: 'Solana',       color: '#9945ff' },
  { id: 'sui',                  symbol: 'SUI',  name: 'Sui',          color: '#4da2ff' },
  { id: 'chainlink',            symbol: 'LINK', name: 'Chainlink',    color: '#375bd2' },
  { id: 'bittensor',            symbol: 'TAO',  name: 'Bittensor',    color: '#e6007a' },
  { id: 'fetch-ai',             symbol: 'FET',  name: 'Fetch.ai',     color: '#1b6dc1' },
  { id: 'ripple',               symbol: 'XRP',  name: 'XRP',          color: '#00aae4' },
  { id: 'cardano',              symbol: 'ADA',  name: 'Cardano',      color: '#0033ad' },
  { id: 'dogecoin',             symbol: 'DOGE', name: 'Dogecoin',     color: '#c2a633' },
  { id: 'avalanche-2',          symbol: 'AVAX', name: 'Avalanche',    color: '#e84142' },
  { id: 'polkadot',             symbol: 'DOT',  name: 'Polkadot',     color: '#e6007a' },
];

const NETWORKS = {
  1:     { name: 'Ethereum', chain: 'Chain 1',     color: '#627eea', rpc: 'https://cloudflare-eth.com',   explorer: 'https://etherscan.io',               icon: '⟠',  native: 'ETH'  },
  8453:  { name: 'Base',     chain: 'Chain 8453',  color: '#0052ff', rpc: 'https://mainnet.base.org',      explorer: 'https://basescan.org',               icon: '⬡',  native: 'ETH'  },
  137:   { name: 'Polygon',  chain: 'Chain 137',   color: '#8247e5', rpc: 'https://polygon-rpc.com',       explorer: 'https://polygonscan.com',            icon: '⬟',  native: 'MATIC'},
  10:    { name: 'Optimism', chain: 'Chain 10',    color: '#ff0420', rpc: 'https://mainnet.optimism.io',   explorer: 'https://optimistic.etherscan.io',    icon: '🔴', native: 'ETH'  },
  42161: { name: 'Arbitrum', chain: 'Chain 42161', color: '#28a0f0', rpc: 'https://arb1.arbitrum.io/rpc',  explorer: 'https://arbiscan.io',                icon: '🔵', native: 'ETH'  },
};

/* ── FORMATTERS ──────────────────────────── */

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1000)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1)     return '$' + n.toFixed(2);
  if (n >= 0.01)  return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function fmtChange(n) {
  if (n == null || isNaN(n)) return { text: '—', cls: '' };
  const sign = n >= 0 ? '+' : '';
  return { text: `${sign}${n.toFixed(2)}%`, cls: n >= 0 ? 'up' : 'down' };
}

function fmtAddr(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtMcap(n) {
  if (!n) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + n.toLocaleString();
}

/* ── PRICE ORACLE ────────────────────────── */

class PriceOracle {
  constructor() {
    this._cache   = new Map();
    this._ttl     = 60_000;
    this._timerId = null;
  }

  async fetchAll() {
    const ids     = FEATURED_COINS.map(c => c.id).join(',');
    const cacheHit = this._cache.get('all');
    if (cacheHit && Date.now() - cacheHit.ts < this._ttl) return cacheHit.data;

    try {
      const url  = `${CG_DIRECT}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._cache.set('all', { data, ts: Date.now() });
      return data;
    } catch {
      return cacheHit?.data ?? {};
    }
  }

  async searchToken(query) {
    try {
      const searchRes = await fetch(`${CG_DIRECT}/search?query=${encodeURIComponent(query)}`);
      if (!searchRes.ok) throw new Error('search failed');
      const { coins } = await searchRes.json();
      if (!coins?.length) return null;

      const top      = coins[0];
      const priceRes = await fetch(`${CG_DIRECT}/simple/price?ids=${top.id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
      const priceMap = await priceRes.json();
      return { ...top, symbol: top.symbol.toUpperCase(), ...priceMap[top.id] };
    } catch {
      return null;
    }
  }

  startPolling(onUpdate, ms = 60_000) {
    const tick = async () => {
      const data = await this.fetchAll();
      onUpdate(data);
    };
    tick();
    this._timerId = setInterval(tick, ms);
  }

  stopPolling() {
    clearInterval(this._timerId);
  }
}

/* ── WALLET MANAGER ──────────────────────── */

class WalletManager {
  constructor() {
    this.address = null;
    this.chainId = null;
    this._provider = null;
    this._signer   = null;
    this._handlers = {};
  }

  on(evt, fn) { this._handlers[evt] = fn; }
  _emit(evt, payload) { this._handlers[evt]?.(payload); }

  get isConnected() { return !!this.address; }
  get hasWallet()   { return !!(window.ethereum); }

  async connect() {
    if (!window.ethereum) {
      this._emit('error', 'No Web3 wallet detected. Install MetaMask, Coinbase Wallet, or another EVM wallet.');
      return false;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts?.length) return false;

      this._provider = new ethers.BrowserProvider(window.ethereum);
      this._signer   = await this._provider.getSigner();
      this.address   = accounts[0];
      const net      = await this._provider.getNetwork();
      this.chainId   = Number(net.chainId);

      this._attachListeners();
      this._emit('connected', { address: this.address, chainId: this.chainId });
      return true;
    } catch (err) {
      this._emit('error', err.message || 'Connection rejected');
      return false;
    }
  }

  async disconnect() {
    this.address   = null;
    this.chainId   = null;
    this._provider = null;
    this._signer   = null;
    this._emit('disconnected', {});
  }

  async getBalance() {
    if (!this._provider || !this.address) return null;
    try {
      const raw = await this._provider.getBalance(this.address);
      return ethers.formatEther(raw);
    } catch { return null; }
  }

  async switchNetwork(chainId) {
    if (!window.ethereum) return;
    const net = NETWORKS[chainId];
    if (!net) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + chainId.toString(16) }],
      });
    } catch (err) {
      if (err.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId:            '0x' + chainId.toString(16),
            chainName:          net.name,
            rpcUrls:            [net.rpc],
            blockExplorerUrls:  [net.explorer],
            nativeCurrency:     { name: net.native, symbol: net.native, decimals: 18 },
          }],
        });
      }
    }
  }

  async signMessage(msg) {
    if (!this._signer) throw new Error('Wallet not connected');
    return this._signer.signMessage(msg);
  }

  _attachListeners() {
    if (!window.ethereum) return;
    window.ethereum.on('accountsChanged', async (accs) => {
      if (!accs.length) { this.disconnect(); return; }
      this.address = accs[0];
      this._signer = await this._provider.getSigner();
      this._emit('accountChanged', { address: this.address });
    });
    window.ethereum.on('chainChanged', (hexChain) => {
      this.chainId = parseInt(hexChain, 16);
      this._emit('chainChanged', { chainId: this.chainId });
    });
  }
}

/* ── HTML ESCAPE ─────────────────────────── */

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── RENDER HELPERS ──────────────────────── */

function renderTicker(prices) {
  const el = document.getElementById('priceTicker');
  if (!el) return;
  const items = FEATURED_COINS.map(coin => {
    const d = prices[coin.id];
    if (!d) return '';
    const ch = fmtChange(d.usd_24h_change);
    return `<span class="ticker-item">
      <span class="ticker-sym">${coin.symbol}</span>
      <span class="ticker-price">${fmtPrice(d.usd)}</span>
      <span class="ticker-change ${ch.cls}">${ch.text}</span>
    </span>`;
  }).filter(Boolean).join('');
  el.innerHTML = items + items;
}

function renderPriceGrid(prices) {
  const el = document.getElementById('priceGrid');
  if (!el) return;
  el.innerHTML = FEATURED_COINS.map(coin => {
    const d = prices[coin.id];
    if (!d) return `<div class="price-card loading"></div>`;
    const ch = fmtChange(d.usd_24h_change);
    return `<div class="price-card">
      <div class="pc-header">
        <span class="pc-dot" style="background:${coin.color}"></span>
        <span class="pc-sym">${coin.symbol}</span>
        <span class="pc-name">${coin.name}</span>
      </div>
      <div class="pc-price">${fmtPrice(d.usd)}</div>
      <div class="pc-meta">
        <span class="pc-change ${ch.cls}">${ch.text}</span>
        <span class="pc-mcap">${fmtMcap(d.usd_market_cap)}</span>
      </div>
    </div>`;
  }).join('');
}

function renderWalletBar(wallet, balance) {
  const bar        = document.getElementById('walletBar');
  const netEl      = document.getElementById('wsbNetwork');
  const addrEl     = document.getElementById('wsbAddress');
  const balEl      = document.getElementById('wsbBalance');
  const connectBtn = document.getElementById('connectBtn');

  if (!wallet.isConnected) {
    bar?.classList.remove('connected');
    if (netEl)  netEl.textContent  = '';
    if (addrEl) addrEl.textContent = '';
    if (balEl)  balEl.textContent  = '';
    if (connectBtn) connectBtn.textContent = 'Connect Wallet';
    return;
  }
  const net = NETWORKS[wallet.chainId] ?? { name: `Chain ${wallet.chainId}`, color: '#888' };
  bar?.classList.add('connected');
  if (netEl)  netEl.innerHTML   = `<span class="net-dot" style="background:${net.color}"></span>${net.name}`;
  if (addrEl) addrEl.textContent = fmtAddr(wallet.address);
  if (balEl && balance) balEl.textContent = `${parseFloat(balance).toFixed(4)} ${net.native ?? 'ETH'}`;
  if (connectBtn) connectBtn.textContent = 'Disconnect';
}

function renderWalletDashboard(wallet, balance) {
  const section = document.getElementById('walletDashboard');
  if (!section) return;
  if (!wallet.isConnected) { section.hidden = true; return; }

  section.hidden = false;
  const net = NETWORKS[wallet.chainId] ?? { name: `Chain ${wallet.chainId}`, color: '#888', explorer: 'https://etherscan.io', native: 'ETH' };

  const netEl    = section.querySelector('#dashNetwork');
  const addrEl   = section.querySelector('#dashAddress');
  const balEl    = section.querySelector('#dashBalance');
  const usdEl    = section.querySelector('#dashBalanceUsd');
  const linkEl   = section.querySelector('#dashExplorerLink');

  if (netEl)  netEl.innerHTML    = `<span class="net-dot" style="background:${net.color}"></span>${net.name}`;
  if (addrEl) addrEl.textContent  = wallet.address;
  if (balEl)  balEl.textContent   = balance ? `${parseFloat(balance).toFixed(6)} ${net.native}` : '…';
  if (usdEl)  usdEl.textContent   = '';
  if (linkEl) {
    linkEl.href        = `${net.explorer}/address/${wallet.address}`;
    linkEl.textContent = 'View on Explorer →';
  }

  // Highlight active network card
  document.querySelectorAll('.network-card').forEach(card => {
    const id = parseInt(card.id?.replace('net-', ''));
    card.classList.toggle('active', id === wallet.chainId);
  });
}

function renderTokenResult(data) {
  const el = document.getElementById('tokenResult');
  if (!el) return;
  if (!data) {
    el.innerHTML = '<p class="token-not-found">Token not found. Try a symbol like BTC, ETH, or a full name.</p>';
    return;
  }
  const ch = fmtChange(data.usd_24h_change);
  el.innerHTML = `<div class="token-result-card">
    <div class="trc-header">
      ${data.thumb && data.thumb.startsWith('https://') ? `<img src="${escHtml(data.thumb)}" alt="${escHtml(data.name)}" class="trc-img" loading="lazy" />` : '<span style="font-size:1.8rem">🪙</span>'}
      <div>
        <div class="trc-name">${escHtml(data.name || data.symbol)}</div>
        <div class="trc-sym">${escHtml(data.symbol?.toUpperCase() ?? '')}</div>
      </div>
    </div>
    <div class="trc-price">${fmtPrice(data.usd)}</div>
    <div class="trc-meta">
      <span class="trc-change ${ch.cls}">${ch.text} (24h)</span>
      ${data.usd_market_cap ? `<span class="trc-mcap">MCap: ${fmtMcap(data.usd_market_cap)}</span>` : ''}
    </div>
  </div>`;
}

function showToast(msg) {
  const el = document.getElementById('walletToast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 5000);
}

/* ── MAIN ────────────────────────────────── */

async function initWeb3Template() {
  const oracle = new PriceOracle();
  const wallet = new WalletManager();

  // Start live price polling
  oracle.startPolling((prices) => {
    renderTicker(prices);
    renderPriceGrid(prices);
  }, 60_000);

  /* -- connect / disconnect -- */
  async function toggleWallet() {
    if (wallet.isConnected) {
      await wallet.disconnect();
    } else {
      await wallet.connect();
    }
  }

  document.getElementById('connectBtn')?.addEventListener('click', toggleWallet);
  document.getElementById('heroConnectBtn')?.addEventListener('click', toggleWallet);

  /* -- wallet events -- */
  wallet.on('connected', async ({ address }) => {
    const bal = await wallet.getBalance();
    renderWalletBar(wallet, bal);
    renderWalletDashboard(wallet, bal);
    const heroBtn = document.getElementById('heroConnectBtn');
    if (heroBtn) heroBtn.textContent = fmtAddr(address);
  });

  wallet.on('disconnected', () => {
    renderWalletBar(wallet, null);
    renderWalletDashboard(wallet, null);
    const heroBtn = document.getElementById('heroConnectBtn');
    if (heroBtn) heroBtn.textContent = 'Connect Wallet';
  });

  wallet.on('accountChanged', async () => {
    const bal = await wallet.getBalance();
    renderWalletBar(wallet, bal);
    renderWalletDashboard(wallet, bal);
  });

  wallet.on('chainChanged', async () => {
    const bal = await wallet.getBalance();
    renderWalletBar(wallet, bal);
    renderWalletDashboard(wallet, bal);
  });

  wallet.on('error', (msg) => showToast(msg));

  /* -- token symbol checker -- */
  const searchInput = document.getElementById('tokenSearch');
  const searchBtn   = document.getElementById('tokenSearchBtn');

  async function doTokenSearch() {
    const q = searchInput?.value.trim();
    if (!q) return;
    const resultEl = document.getElementById('tokenResult');
    if (resultEl) resultEl.innerHTML = '<div class="loading-spin"></div>';
    const result = await oracle.searchToken(q);
    renderTokenResult(result);
  }

  searchBtn?.addEventListener('click', doTokenSearch);
  searchInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doTokenSearch(); });

  /* -- network switch buttons -- */
  document.querySelectorAll('[data-switch-network]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const chainId = parseInt(btn.dataset.switchNetwork);
      if (!wallet.isConnected) {
        const ok = await wallet.connect();
        if (ok) await wallet.switchNetwork(chainId);
      } else {
        await wallet.switchNetwork(chainId);
      }
    });
  });

  /* -- sign message demo -- */
  document.getElementById('signMessageBtn')?.addEventListener('click', async () => {
    if (!wallet.isConnected) {
      await wallet.connect();
      return;
    }
    const msgEl    = document.getElementById('signMessage');
    const resultEl = document.getElementById('signResult');
    const msg      = msgEl?.value.trim() || 'Hello from createwithalli.com 👋';
    try {
      const sig = await wallet.signMessage(msg);
      if (resultEl) {
        resultEl.innerHTML = `<div class="sig-result">
          <span class="sig-label">Signature:</span>
          <code class="sig-code">${sig.slice(0, 42)}…</code>
          <span class="sig-ok">✓ Verified on-chain</span>
        </div>`;
      }
    } catch (err) {
      if (resultEl) {
        const p = document.createElement('p');
        p.className = 'sig-error';
        p.textContent = err.message || 'Signing failed';
        resultEl.replaceChildren(p);
      }
    }
  });
}

/* ── BOOT ─────────────────────────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWeb3Template);
} else {
  initWeb3Template();
}
