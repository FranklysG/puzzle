const { GPU } = require('gpu.js');
const CoinKey = require('coinkey');
const wallets = require('./utils/wallets');
const ranges = require('./utils/ranges');

const gpu = new GPU();
const range = ranges[66];
const min = range.min;
const max = range.max;

let key = min;
let cont = 0;
const startTime = Date.now();

const generatePublicKey = gpu.createKernel(function(pkey) {
  const key = new CoinKey(Buffer.from(pkey, 'hex'));
  key.compressed = true;
  return key.publicAddress;
}).setOutput([1]);

console.log("Mode:", gpu.getMode());

while (key <= max) {
  cont++;
  key += 1n;

  const elapsedTime = (Date.now() - startTime);
  const speed = cont / (elapsedTime / 1000);

  // Cálculo da velocidade
  let Hs = 0;
  const kHps = speed / 1000;
  const MHps = speed / 1e6;
  const GHps = speed / 1e9;
  const THps = speed / 1e12;
  const PHps = speed / 1e15;

  if (PHps >= 1) {
    Hs = `${PHps.toFixed(2)} PH/s`;
  } else if (THps >= 1) {
    Hs = `${THps.toFixed(2)} TH/s`;
  } else if (GHps >= 1) {
    Hs = `${GHps.toFixed(2)} GH/s`;
  } else if (MHps >= 1) {
    Hs = `${MHps.toFixed(2)} MH/s`;
  } else if (kHps >= 1) {
    Hs = `${kHps.toFixed(2)} kH/s`;
  } else {
    Hs = `${speed.toFixed(2)} H/s`;
  }

  const pkey = key.toString(16).padStart(64, '0');
  const public = generatePublicKey(pkey);
  
  console.log(`${pkey} ${public} ${Hs}`);

  if (wallets.includes(public)) {
    console.log(`-----`);
    console.log(`Chave Encontrada`);

    const seconds = Math.floor(elapsedTime / 1000) % 60;
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(seconds / 3600);

    const keyWif = generateWIF(pkey);
    console.log(`${pkey} ${public} ${hours}:${minutes}:${seconds}`);
    console.log(`Sua Electron Key: ${keyWif}`);
    console.log(`-----`);

    break;
  }
}

function generateWIF(privateKey) {
  let _key = new CoinKey(Buffer.from(privateKey, 'hex'));
  return _key.privateWif;
}

console.log("Processo concluído.");
