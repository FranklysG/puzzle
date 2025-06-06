const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const os = require('os');
const CoinKey = require('coinkey');
const readline = require('readline');

const wallets = require('./utils/wallets');
const ranges = require('./utils/ranges');

if (isMainThread) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function ask(question) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });
  }

  (async () => {
    let puzzleNumber;
    while (true) {
      const ans = await ask('Selecione um puzzle de 1 a 160!\n');
      puzzleNumber = parseInt(ans, 10);
      if (!isNaN(puzzleNumber) && puzzleNumber >= 1 && puzzleNumber <= 160 && ranges[puzzleNumber]) break;
      console.log('Por favor, informe um número válido entre 1 e 160 que exista nos ranges.');
    }

    let mode;
    while (true) {
      const ans = await ask('Selecione o fator de busca (1) sequencial (2) aleatório\n');
      if (ans === '1') {
        mode = 'sequential';
        break;
      }
      if (ans === '2') {
        mode = 'random';
        break;
      }
      console.log('Por favor, digite 1 para sequencial ou 2 para aleatório.');
    }

    const maxThreads = os.cpus().length;
    let numThreads;
    while (true) {
      const ans = await ask(`Selecione o número de threads (1 a ${maxThreads}):\n`);
      numThreads = parseInt(ans, 10);
      if (!isNaN(numThreads) && numThreads >= 1 && numThreads <= maxThreads) break;
      console.log(`Por favor, informe um número válido entre 1 e ${maxThreads}.`);
    }

    rl.close();

    startWorkers(puzzleNumber, mode, numThreads);
  })();
} else {
  if (parentPort) {
    const { start, end, threadId, mode } = workerData;
    const rangeSize = end - start + 1n;

    let key = mode === 'random' ? randomBigIntInRange(start, end) : start;
    let cont = 0;
    const startTime = Date.now();

    while (true) {
      cont++;

      const pkey = key.toString(16).padStart(64, '0');
      const publicAddr = generatePublicKey(pkey);

      if (wallets.includes(publicAddr)) {
        const wif = generateWIF(pkey);
        parentPort.postMessage({
          found: true,
          threadId,
          privKey: pkey,
          wif,
        });
        break;
      }

      if (cont % 1000 === 0) {
        const elapsedTime = (Date.now() - startTime) / 1000;
        const speed = cont / elapsedTime;
        const Hs = formatHashrate(speed);
        const checked = Number((key - start) * 10000n / rangeSize) / 100;

        parentPort.postMessage({
          found: false,
          threadId,
          log: `Thread ${threadId}: ${pkey} ${publicAddr} ${Hs} (${checked.toFixed(2)}% verificado)`,
        });
      }

      if (mode === 'random') {
        const MAX_SAFE = Number.MAX_SAFE_INTEGER;
        const maxStep = rangeSize > BigInt(MAX_SAFE) ? MAX_SAFE : Number(rangeSize);
        const step = BigInt(Math.floor(Math.random() * maxStep) + 1);
        key += step;

        if (key > end) {
          key = randomBigIntInRange(start, end);
        }
      } else {
        key++;
        if (key > end) break;
      }
    }

    process.exit(0);
  }
}

function startWorkers(puzzleNumber, mode, numThreads) {
  const range = ranges[puzzleNumber];
  let threadLogs = Array(numThreads).fill('');

  const min = range.min;
  const max = range.max;
  const totalKeys = max - min + 1n;
  const baseChunkSize = totalKeys / BigInt(numThreads);

  console.clear();
  console.log(`Iniciando ${numThreads} threads para processar as chaves...`);
  console.log(`Puzzle escolhido: ${puzzleNumber} (${mode})\n`);

  for (let i = 0; i < numThreads; i++) {
    console.log(`Thread ${i}: Aguardando...`);
  }

  for (let i = 0; i < numThreads; i++) {
    const start = min + BigInt(i) * baseChunkSize;
    let end = start + baseChunkSize - 1n;

    if (i === numThreads - 1) {
      end = max;
    }

    const worker = new Worker(__filename, { workerData: { start, end, threadId: i, mode } });

    worker.on('message', (msg) => {
      if (msg.found) {
        console.clear();
        console.log(`🔥 CHAVE ENCONTRADA NA THREAD ${msg.threadId}!\nPrivada: ${msg.privKey}\nWIF: ${msg.wif}`);
        process.exit(0);
      } else if (msg.log) {
        threadLogs[msg.threadId] = msg.log;
        updateLogs(threadLogs, numThreads, puzzleNumber, mode);
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

function updateLogs(threadLogs, numThreads, puzzleNumber, mode) {
  process.stdout.write('\x1B[0;0H');
  console.clear();
  console.log(`Iniciando ${numThreads} threads para processar as chaves...`);
  console.log(`Puzzle escolhido: ${puzzleNumber} (${mode})\n`);

  for (let i = 0; i < numThreads; i++) {
    console.log(threadLogs[i] || `Thread ${i}: Aguardando...`);
  }
}

function generatePublicKey(privatekey) {
  const key = new CoinKey(Buffer.from(privatekey, 'hex'));
  key.compressed = true;
  return key.publicAddress;
}

function generateWIF(privateKey) {
  const key = new CoinKey(Buffer.from(privateKey, 'hex'));
  return key.privateWif;
}

function formatHashrate(speed) {
  const kHps = speed / 1000;
  const MHps = speed / 1e6;
  const GHps = speed / 1e9;
  const THps = speed / 1e12;
  const PHps = speed / 1e15;

  if (PHps >= 1) {
    return `${PHps.toFixed(2)} PH/s`;
  } else if (THps >= 1) {
    return `${THps.toFixed(2)} TH/s`;
  } else if (GHps >= 1) {
    return `${GHps.toFixed(2)} GH/s`;
  } else if (MHps >= 1) {
    return `${MHps.toFixed(2)} MH/s`;
  } else if (kHps >= 1) {
    return `${kHps.toFixed(2)} kH/s`;
  }
  return `${speed.toFixed(2)} H/s`;
}

function randomBigIntInRange(min, max) {
  const range = max - min + 1n;
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

  if (range <= MAX_SAFE) {
    const rand = BigInt(Math.floor(Math.random() * Number(range)));
    return min + rand;
  } else {
    let randStr = '';
    for (let i = 0; i < 6; i++) {
      const part = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
      randStr += part;
    }
    let rand = BigInt('0x' + randStr);
    rand = rand % range;
    return min + rand;
  }
}
