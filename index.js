const crypto = require('crypto');
const secp = require('secp256k1');
const bs58check = require('bs58check').default;

const wallets = require('./utils/wallets');
const ranges = require('./utils/ranges');

const range = ranges[67] // { min: 0x40000000000000000n, max: 0x7ffffffffffffffffn, status: 0, range: 67 }

const min = range.min;
const max = range.max;
const start = min;

let key = start;
let cont = 0;
const totalKeys = max - min + 1n;
const startTime = Date.now();
const privBuf = Buffer.alloc(32);

while (key <= max) {
  cont++;
  key += 1n;

  writeBigInt32BE(key, privBuf);
  const pub = secp.publicKeyCreate(privBuf, true);
  const sha = crypto.createHash('sha256').update(pub).digest();
  const rip = crypto.createHash('ripemd160').update(sha).digest();
  const hash160 = rip.toString('hex');

  const elapsedTime = (Date.now() - startTime);
  const speed = cont / (elapsedTime / 1000);

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
  const public = hash160ToAddress(rip);

  // Ajustando o cálculo de porcentagem
  const percentageChecked = ((Number(key - min) / Number(totalKeys)) * 100).toFixed(2);

  console.clear();
  console.log(`${pkey} ${public} ${Hs} (${percentageChecked}% verificado)`);

  if (wallets.has(hash160)) {
    console.log(`-----`);
    console.log(`Chave Encontrada`);

    const seconds = Math.floor(elapsedTime / 1000) % 60;
    const minutes = Math.floor((elapsedTime / 1000) / 60) % 60;
    const hours = Math.floor((elapsedTime / 1000) / 3600);

    const keyWif = privToWIF(privBuf);
    console.log(`${pkey} ${public} ${hours}:${minutes}:${seconds}`);
    console.log(`Sua Electron Key: ${keyWif}`);
    console.log(`-----`);

    break;
  }
}

function writeBigInt32BE(value, buf) {
  let v = value;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function hash160ToAddress(rip) {
  const payload = Buffer.concat([Buffer.from([0x00]), rip]);
  return bs58check.encode(payload);
}

function privToWIF(buf) {
  const payload = Buffer.concat([Buffer.from([0x80]), buf, Buffer.from([0x01])]);
  return bs58check.encode(payload);
}

console.log("Processo concluído.");
