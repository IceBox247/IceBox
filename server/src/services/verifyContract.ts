import { AbiCoder } from 'ethers';
import { config } from '../config';
import { TOKEN_FACTORY_SOURCE } from '../generated/tokenFactorySource';

// Etherscan V2 unified verification API (the classic per-chain V1 endpoints are
// deprecated). One key works across chains; the chain is selected with the
// `chainid` query param (56 = BNB Smart Chain). Every IceBox token is a
// CustomToken/TaxToken from TokenFactory.sol compiled with a fixed solc version
// + optimizer, so we rebuild the exact source + constructor args and submit the
// verification on the user's behalf — no Remix, no copy/paste.
const ETHERSCAN_V2_API = 'https://api.etherscan.io/v2/api';

export interface TokenForVerify {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string; // whole tokens (the constructor multiplies by 10**decimals)
  taxed: boolean;
  creator: string; // = the token owner (factory sets owner = msg.sender)
  // Tax-token extras (only needed when taxed):
  buyTaxBps?: number;
  sellTaxBps?: number;
  taxWallet?: string;
}

function constructorArgs(t: TokenForVerify): { contractName: string; encoded: string } {
  const coder = AbiCoder.defaultAbiCoder();
  const supply = BigInt(t.supply || '0');
  if (t.taxed) {
    const enc = coder.encode(
      ['string', 'string', 'uint8', 'uint256', 'address', 'uint16', 'uint16', 'address'],
      [t.name, t.symbol, t.decimals, supply, t.creator, t.buyTaxBps ?? 0, t.sellTaxBps ?? 0, t.taxWallet ?? t.creator],
    );
    return { contractName: 'TaxToken', encoded: enc.slice(2) };
  }
  const enc = coder.encode(
    ['string', 'string', 'uint8', 'uint256', 'address'],
    [t.name, t.symbol, t.decimals, supply, t.creator],
  );
  return { contractName: 'CustomToken', encoded: enc.slice(2) };
}

/** Submit a token for source verification. Returns a guid to poll, or a note if
 *  it's already verified. */
export async function submitVerification(
  t: TokenForVerify,
  chainId = 56,
): Promise<{ ok: boolean; guid?: string; alreadyVerified?: boolean; message: string }> {
  const apikey = config.verify.bscscanApiKey;
  if (!apikey) {
    return { ok: false, message: 'Verification isn’t configured yet (missing API key).' };
  }
  const { contractName, encoded } = constructorArgs(t);
  const body = new URLSearchParams({
    apikey,
    module: 'contract',
    action: 'verifysourcecode',
    codeformat: 'solidity-single-file',
    sourceCode: TOKEN_FACTORY_SOURCE,
    contractaddress: t.address,
    contractname: contractName,
    compilerversion: config.verify.compilerVersion,
    optimizationUsed: '1',
    runs: String(config.verify.optimizerRuns),
    constructorArguements: encoded,
    licenseType: '3', // MIT
  });
  const r = await fetch(`${ETHERSCAN_V2_API}?chainid=${chainId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j: any = await r.json().catch(() => null);
  if (!j) return { ok: false, message: 'Explorer returned no response — try again.' };
  if (j.status === '1') return { ok: true, guid: String(j.result), message: 'Submitted for verification.' };
  const msg = String(j.result || j.message || 'Verification error');
  if (/already verified/i.test(msg)) return { ok: true, alreadyVerified: true, message: 'Already verified ✅' };
  return { ok: false, message: msg };
}

/** Poll a verification guid for its result. */
export async function checkVerification(
  guid: string,
  chainId = 56,
): Promise<{ done: boolean; ok: boolean; message: string }> {
  const apikey = config.verify.bscscanApiKey;
  const url = `${ETHERSCAN_V2_API}?chainid=${chainId}&apikey=${apikey}&module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}`;
  const r = await fetch(url);
  const j: any = await r.json().catch(() => null);
  const res = String(j?.result || '');
  if (/pending/i.test(res)) return { done: false, ok: false, message: 'Pending in queue…' };
  if (j?.status === '1' || /pass|verified/i.test(res)) return { done: true, ok: true, message: 'Verified ✅' };
  return { done: true, ok: false, message: res || 'Verification failed' };
}
