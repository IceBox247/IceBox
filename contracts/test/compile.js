const fs = require('fs');
const solc = require('solc');

const src = fs.readFileSync(require('path').join(__dirname, '../IceUsd.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'IceUsd.sol': { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (out.errors || []).filter((e) => e.severity === 'error');
if (errors.length) {
  console.error('COMPILE ERRORS:');
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}
(out.errors || []).forEach((e) => console.error('warning:', e.formattedMessage.split('\n')[0]));

const c = out.contracts['IceUsd.sol']['IceUsd'];
fs.writeFileSync(require('path').join(__dirname,'abi.json'), JSON.stringify(c.abi));
fs.writeFileSync(require('path').join(__dirname,'bytecode.txt'), '0x' + c.evm.bytecode.object);
console.log('OK  abi entries:', c.abi.length, ' bytecode bytes:', c.evm.bytecode.object.length / 2);
