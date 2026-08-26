// IceBox — TON jetton ("Gram") creator. Bundled to a single inlined script so it
// runs inside the Telegram in-app browser with no external <script> tags, matching
// the BEP-20 tool pages. Uses the audited @ton-community/assets-sdk jetton code and
// sends the deploy through the user's TON wallet via TON Connect.
import { TonConnectUI } from '@tonconnect/ui';
import { Address, beginCell, storeStateInit, toNano } from '@ton/core';
import { AssetsSDK, createApi, NoopStorage } from '@ton-community/assets-sdk';

// The TON zero address (workchain 0, all-zero hash). Setting a jetton's admin to
// this permanently removes the admin — supply can never be minted again.
const ZERO_ADDRESS = new Address(0, Buffer.alloc(32));
import { DEX, pTON } from '@ston-fi/sdk';
import { StonApiClient } from '@ston-fi/api';

// Turn a @ton/core SenderArguments into a TON Connect message object.
function toTonConnectMessage(args) {
  const m = { address: args.to.toString(), amount: args.value.toString() };
  if (args.body) m.payload = args.body.toBoc().toString('base64');
  if (args.init) {
    m.stateInit = beginCell().store(storeStateInit(args.init)).endCell().toBoc().toString('base64');
  }
  return m;
}

// A @ton/core Sender that forwards each outgoing message to the connected wallet
// through TON Connect. The SDK computes the minter address, its state init, and the
// mint message; we only translate them into a TON Connect transaction.
function tonConnectSender(tonConnectUI, address) {
  return {
    address,
    async send(args) {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [toTonConnectMessage(args)],
      });
    },
  };
}

const API = {
  ui: null,
  network: 'testnet', // 'testnet' | 'mainnet' — set from the page toggle

  init(manifestUrl) {
    // Drive the connect flow with our own button via openModal() — the auto-rendered
    // `buttonRootElementId` widget is unreliable inside the Telegram in-app browser.
    this.ui = new TonConnectUI({ manifestUrl });
    return this.ui;
  },

  // Short display form of the connected address, e.g. "EQAb…7TiU".
  shortAddress() {
    const a = this.wallet();
    return a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  },

  // Wire an explicit button element to connect/disconnect and keep its label in sync.
  bindConnectButton(btn, onChange) {
    if (!btn) return;
    const sync = () => {
      btn.textContent = this.connected() ? ('Disconnect ' + this.shortAddress()) : 'Connect Wallet';
      if (typeof onChange === 'function') onChange(this.connected());
    };
    btn.addEventListener('click', async () => {
      try { if (this.connected()) await this.disconnect(); else await this.connect(); }
      catch (_) { /* user closed the modal */ }
    });
    this.onStatusChange(sync);
    sync();
  },

  setNetwork(n) {
    this.network = n === 'mainnet' ? 'mainnet' : 'testnet';
  },

  connected() {
    return !!(this.ui && this.ui.account && this.ui.account.address);
  },

  wallet() {
    return this.ui && this.ui.account ? this.ui.account.address : null;
  },

  onStatusChange(cb) {
    if (this.ui) this.ui.onStatusChange(cb);
  },

  async connect() {
    if (this.ui) await this.ui.openModal();
  },

  async disconnect() {
    if (this.ui) await this.ui.disconnect();
  },

  /**
   * Deploy a standard jetton with on-chain metadata and premint the whole supply to
   * the creator. Returns the new jetton (minter) address, both raw and user-friendly.
   * @param {{name:string, symbol:string, decimals:number, supply:string|number,
   *          description?:string, image?:string}} form
   */
  async createJetton(form) {
    if (!this.connected()) throw new Error('Connect your TON wallet first.');
    const decimals = Number(form.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
      throw new Error('Decimals must be a whole number between 0 and 30.');
    }
    const whole = BigInt(String(form.supply).replace(/[^0-9]/g, '') || '0');
    if (whole <= 0n) throw new Error('Total supply must be greater than zero.');
    const premintAmount = whole * 10n ** BigInt(decimals);

    const owner = Address.parse(this.wallet());
    const sender = tonConnectSender(this.ui, owner);
    const api = await createApi(this.network);
    const sdk = AssetsSDK.create({ api, storage: new NoopStorage(), sender });

    const content = {
      name: String(form.name).trim(),
      symbol: String(form.symbol).trim(),
      decimals,
      description: form.description ? String(form.description).trim() : undefined,
      image: form.image ? String(form.image).trim() : undefined,
    };

    // premintAmount + onchainContent => one message that deploys the minter and mints
    // the full supply to the admin (creator). value covers deploy + mint + forward.
    const jetton = await sdk.deployJetton(content, {
      onchainContent: true,
      premintAmount,
      value: toNano('0.25'),
      adminAddress: owner,
    });

    return {
      addressRaw: jetton.address.toString(),
      addressFriendly: jetton.address.toString({ bounceable: true, testOnly: this.network === 'testnet' }),
      network: this.network,
      owner: owner.toString({ bounceable: false, testOnly: this.network === 'testnet' }),
      name: content.name,
      symbol: content.symbol,
      decimals,
      supply: whole.toString(),
    };
  },

  /**
   * Add liquidity for a jetton on STON.fi (mainnet), pairing it with TON. For a
   * brand-new token this creates the pool. Sends both the jetton side and the TON
   * side in a single wallet-approved transaction.
   * @param {{jettonAddress:string, jettonAmount:string|number, decimals:number,
   *          tonAmount:string|number}} form
   */
  async addLiquidity(form) {
    if (!this.connected()) throw new Error('Connect your TON wallet first.');
    // STON.fi operates on mainnet; liquidity uses real TON.
    const owner = Address.parse(this.wallet());
    const jettonMaster = Address.parse(String(form.jettonAddress).trim());
    const decimals = Number(form.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
      throw new Error('Decimals must be a whole number between 0 and 30.');
    }
    const jettonWhole = BigInt(String(form.jettonAmount).replace(/[^0-9]/g, '') || '0');
    if (jettonWhole <= 0n) throw new Error('Enter how many tokens to add.');
    const jettonUnits = jettonWhole * 10n ** BigInt(decimals);
    const tonNano = toNano(String(form.tonAmount).trim() || '0');
    if (tonNano <= 0n) throw new Error('Enter how much TON to pair.');

    // Resolve a v2.2 constant-product router that allows creating new pools.
    const ston = new StonApiClient();
    const routers = await ston.getRouters();
    const r = routers.find(
      (x) => x.majorVersion === 2 && x.minorVersion === 2 &&
        x.routerType === 'ConstantProduct' && x.poolCreationEnabled,
    ) || routers.find(
      (x) => x.majorVersion === 2 && x.routerType === 'ConstantProduct' && x.poolCreationEnabled,
    );
    if (!r) throw new Error('No STON.fi router available for pool creation right now.');

    const api = await createApi('mainnet');
    const router = api.open(DEX.v2_2.Router.create(r.address));
    const proxyTon = pTON.v2_1.create(r.ptonMasterAddress);

    const jettonParams = await router.getProvideLiquidityJettonTxParams({
      userWalletAddress: owner,
      sendTokenAddress: jettonMaster,
      otherTokenAddress: proxyTon.address,
      sendAmount: jettonUnits,
      minLpOut: '1',
    });
    const tonParams = await router.getProvideLiquidityTonTxParams({
      userWalletAddress: owner,
      proxyTon,
      otherTokenAddress: jettonMaster,
      sendAmount: tonNano,
      minLpOut: '1',
    });

    await this.ui.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 300,
      messages: [toTonConnectMessage(jettonParams), toTonConnectMessage(tonParams)],
    });

    return {
      router: r.address,
      pair: jettonMaster.toString({ bounceable: true }),
      tonAmount: String(form.tonAmount),
      jettonAmount: jettonWhole.toString(),
    };
  },

  /**
   * Renounce the admin of a jetton by handing it to the zero address. After this the
   * supply is fixed forever — nobody (including the creator) can mint more. Irreversible.
   * @param {string} jettonAddress
   */
  async renounceAdmin(jettonAddress) {
    if (!this.connected()) throw new Error('Connect your TON wallet first.');
    const owner = Address.parse(this.wallet());
    const sender = tonConnectSender(this.ui, owner);
    const api = await createApi(this.network);
    const sdk = AssetsSDK.create({ api, storage: new NoopStorage(), sender });
    const minter = sdk.openJetton(Address.parse(String(jettonAddress).trim()));
    await minter.sendChangeAdmin(sender, ZERO_ADDRESS, { value: toNano('0.05') });
    return { address: String(jettonAddress).trim(), network: this.network };
  },

  /**
   * List TON tokens the connected wallet created (recorded by the IceBox backend),
   * across mainnet (chain 607) and testnet (chain 608). Returns [] on any error.
   */
  async listMyTokens() {
    if (!this.connected()) throw new Error('Connect your TON wallet first.');
    const raw = Address.parse(this.wallet());
    const out = [];
    const chains = [[607, false], [608, true]];
    for (let i = 0; i < chains.length; i++) {
      const chainId = chains[i][0];
      const owner = raw.toString({ bounceable: false, testOnly: chains[i][1] });
      try {
        const resp = await fetch('/api/tokens?owner=' + encodeURIComponent(owner) + '&chainId=' + chainId);
        const j = await resp.json();
        if (j && j.tokens) {
          j.tokens.forEach((t) => out.push(Object.assign({}, t, {
            network: chainId === 607 ? 'mainnet' : 'testnet',
          })));
        }
      } catch (_) { /* ignore per-chain failures */ }
    }
    return out;
  },
};

window.IceTon = API;
export default API;
