// IceBox — TON jetton ("Gram") creator. Bundled to a single inlined script so it
// runs inside the Telegram in-app browser with no external <script> tags, matching
// the BEP-20 tool pages. Uses the audited @ton-community/assets-sdk jetton code and
// sends the deploy through the user's TON wallet via TON Connect.
import { TonConnectUI } from '@tonconnect/ui';
import { Address, beginCell, storeStateInit, toNano } from '@ton/core';
import { AssetsSDK, createApi, NoopStorage } from '@ton-community/assets-sdk';

// A @ton/core Sender that forwards each outgoing message to the connected wallet
// through TON Connect. The SDK computes the minter address, its state init, and the
// mint message; we only translate them into a TON Connect transaction.
function tonConnectSender(tonConnectUI, address) {
  return {
    address,
    async send(args) {
      const message = { address: args.to.toString(), amount: args.value.toString() };
      if (args.body) message.payload = args.body.toBoc().toString('base64');
      if (args.init) {
        const initCell = beginCell().store(storeStateInit(args.init)).endCell();
        message.stateInit = initCell.toBoc().toString('base64');
      }
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [message],
      });
    },
  };
}

const API = {
  ui: null,
  network: 'testnet', // 'testnet' | 'mainnet' — set from the page toggle

  init(manifestUrl, buttonRootId) {
    this.ui = new TonConnectUI({ manifestUrl, buttonRootElementId: buttonRootId });
    return this.ui;
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
};

window.IceTon = API;
export default API;
