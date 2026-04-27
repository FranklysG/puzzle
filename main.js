const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const os = require('os');
const crypto = require('crypto');
const secp = require('secp256k1');
const bs58check = require('bs58check').default;
const hashWasm = require('hash-wasm');
const readline = require('readline');
const fs = require('fs');

const wallets = require('./utils/wallets'); // Set de hash160 hex
const ranges = require('./utils/ranges');   // Ranges por puzzle

const LOG_EVERY = 5000;

let threadLogs = [];

if (isMainThread) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Pergunta o puzzle
  rl.question('Selecione um puzzle de 1 a 160!\n- resposta: ', (puzzleInput) => {
    const puzzleNumber = parseInt(puzzleInput);
    if (!(puzzleNumber >= 1 && puzzleNumber <= 160)) {
      console.log('Puzzle inválido. Encerrando.');
      rl.close();
      process.exit(1);
    }

    // Pergunta o modo
    rl.question('Selecione o fator de busca (1) sequencial (2) aleatorio\n- resposta: ', (modeInput) => {
      const mode = parseInt(modeInput);
      if (mode !== 1 && mode !== 2) {
        console.log('Modo inválido. Encerrando.');
        rl.close();
        process.exit(1);
      }

      // Pergunta número de threads
      rl.question(`Quantas threads deseja usar? (máximo ${os.cpus().length})\n- resposta: `, (threadInput) => {
        let numThreads = parseInt(threadInput);
        if (isNaN(numThreads) || numThreads < 1 || numThreads > os.cpus().length) {
          console.log(`Número de threads inválido. Usando máximo disponível: ${os.cpus().length}`);
          numThreads = os.cpus().length;
        }

        rl.close();
        startWorkers(puzzleNumber, mode, numThreads);
      });
    });
  });

} else {
  // Worker code
  if (parentPort) {
    runWorker().catch((err) => {
      console.error('Worker error:', err);
      process.exit(1);
    });
  }
}

async function runWorker() {
  const { start, end, threadId, mode } = workerData;
  let key = start;
  let cont = 0;
  const startTime = Date.now();
  const rangeSize = end - start + 1n;
  const privBuf = Buffer.alloc(32);
  const ONE_BUF = Buffer.alloc(32); ONE_BUF[31] = 1;
  const pubBufA = new Uint8Array(33);
  const pubBufB = new Uint8Array(33);

  const sha256Hw = await hashWasm.createSHA256();
  const rip160Hw = await hashWasm.createRIPEMD160();

  const bitLen = rangeSize.toString(2).length;
  const rByteLen = Math.ceil(bitLen / 8);
  const topByteMask = bitLen % 8 === 0 ? 0xff : (1 << (bitLen % 8)) - 1;
  const RAND_BATCH = 4096;
  let randPool = crypto.randomBytes(RAND_BATCH);
  let randPos = 0;

  function nextRandomKey() {
    while (true) {
      if (randPos + rByteLen > RAND_BATCH) {
        randPool = crypto.randomBytes(RAND_BATCH);
        randPos = 0;
      }
      let r = BigInt(randPool[randPos] & topByteMask);
      for (let j = 1; j < rByteLen; j++) r = (r << 8n) | BigInt(randPool[randPos + j]);
      randPos += rByteLen;
      if (r < rangeSize) return start + r;
    }
  }

  if (mode === 2) key = nextRandomKey();
  writeBigInt32BE(key, privBuf);
  let pub = secp.publicKeyCreate(privBuf, true, pubBufA);
  let pubAlt = pubBufB;
  let ticksLeft = LOG_EVERY;

  while (true) {
    cont++;

    sha256Hw.init(); sha256Hw.update(pub);
    const sha = sha256Hw.digest('binary');
    rip160Hw.init(); rip160Hw.update(sha);
    const rip = rip160Hw.digest('binary');
    const hash160 = Buffer.from(rip).toString('hex');

    if (wallets.has(hash160)) {
      const pkey = key.toString(16).padStart(64, '0');
      const publicAddr = hash160ToAddress(Buffer.from(rip));
      const wif = privToWIF(privBuf);
      parentPort.postMessage({
        found: true,
        threadId,
        privKey: pkey,
        wif,
        publicAddr,
      });
      break;
    }

    if (--ticksLeft === 0) {
      ticksLeft = LOG_EVERY;
      const elapsedTime = (Date.now() - startTime) / 1000;
      const speed = cont / elapsedTime;
      const Hs = formatHashrate(speed);
      const checked = Number((key - start) * 10000n / rangeSize) / 100;
      const pkey = key.toString(16).padStart(64, '0');
      const publicAddr = hash160ToAddress(Buffer.from(rip));

      parentPort.postMessage({
        found: false,
        threadId,
        log: `Thread ${threadId}: ${pkey} ${publicAddr} ${Hs} (${checked.toFixed(2)}% verificado)`,
      });
    }

    if (mode === 1) {
      // Sequencial: avança chave + ponto público por adição EC
      key += 1n;
      if (key > end) {
        key = start;
        writeBigInt32BE(key, privBuf);
        pub = secp.publicKeyCreate(privBuf, true, pub);
      } else {
        privBuf[31]++;
        if (privBuf[31] === 0) writeBigInt32BE(key, privBuf);
        const next = secp.publicKeyTweakAdd(pub, ONE_BUF, true, pubAlt);
        pubAlt = pub;
        pub = next;
      }
    } else {
      // Aleatório: chave totalmente nova uniforme em [start,end] via CSPRNG
      key = nextRandomKey();
      writeBigInt32BE(key, privBuf);
      pub = secp.publicKeyCreate(privBuf, true, pub);
    }
  }
  process.exit(0);
}

function startWorkers(puzzleNumber, mode, numThreads) {
  const range = ranges[puzzleNumber];
  if (!range) {
    console.log('Range para o puzzle selecionado não encontrado.');
    process.exit(1);
  }

  const min = range.min;
  const max = range.max;
  const totalKeys = max - min + 1n;
  const baseChunkSize = totalKeys / BigInt(numThreads);

  threadLogs = Array(numThreads).fill('');

  console.clear();
  console.log(`Iniciando ${numThreads} threads para processar as chaves...\n`);

  for (let i = 0; i < numThreads; i++) {
    console.log(`Thread ${i}: Aguardando...`);
  }

  for (let i = 0; i < numThreads; i++) {
    let start, end;
    if (mode === 1) {
      start = min + BigInt(i) * baseChunkSize;
      end = i === numThreads - 1 ? max : start + baseChunkSize - 1n;
    } else {
      // Aleatório: cada thread amostra o range inteiro (cobertura agregada melhor;
      // colisão entre threads é desprezível em ranges grandes)
      start = min;
      end = max;
    }

    const worker = new Worker(__filename, {
      workerData: { start, end, threadId: i, mode },
    });

    worker.on('message', (msg) => {
      if (msg.found) {
        console.clear();
        console.log(`🔥 CHAVE ENCONTRADA NA THREAD ${msg.threadId}!\nPrivada: ${msg.privKey}\nWIF: ${msg.wif}`);

        // Salva chave em arquivo txt
        const content = `CHAVE PRIVADA ENCONTRADA:\n\nPrivada (hex): ${msg.privKey}\nWIF: ${msg.wif}\nThread: ${msg.threadId}\nData: ${new Date().toISOString()}\n`;
        fs.writeFileSync('new_million.txt', content, { encoding: 'utf8' });

        console.log('\nChave salva em "new_million.txt".');
        process.exit(0);
      } else if (msg.log) {
        threadLogs[msg.threadId] = msg.log;
        updateLogs();
      }
    });

    worker.on('error', (err) => {
      console.error(`Erro na thread ${i}:`, err);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.log(`Thread ${i} finalizou com código ${code}`);
      }
    });
  }
}

function updateLogs() {
  process.stdout.write('\x1B[0;0H');
  console.clear();
  console.log(`Iniciando threads para processar as chaves...\n`);

  for (let i = 0; i < threadLogs.length; i++) {
    console.log(threadLogs[i] || `Thread ${i}: Aguardando...`);
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

function privToWIF(privBuf) {
  const payload = Buffer.concat([Buffer.from([0x80]), privBuf, Buffer.from([0x01])]);
  return bs58check.encode(payload);
}

function formatHashrate(speed) {
  const kHps = speed / 1000;
  const MHps = speed / 1e6;
  const GHps = speed / 1e9;
  const THps = speed / 1e12;
  const PHps = speed / 1e15;

  if (PHps >= 1) return `${PHps.toFixed(2)} PH/s`;
  if (THps >= 1) return `${THps.toFixed(2)} TH/s`;
  if (GHps >= 1) return `${GHps.toFixed(2)} GH/s`;
  if (MHps >= 1) return `${MHps.toFixed(2)} MH/s`;
  if (kHps >= 1) return `${kHps.toFixed(2)} kH/s`;
  return `${speed.toFixed(2)} H/s`;
}
