const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const os = require('os');
const CoinKey = require('coinkey');
const readline = require('readline');
const fs = require('fs');

const wallets = require('./utils/wallets'); // Lista de endereços alvo
const ranges = require('./utils/ranges');   // Ranges por puzzle

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
    const { start, end, threadId, mode } = workerData;
    let key = start;
    let cont = 0;
    const startTime = Date.now();
    const rangeSize = end - start + 1n;

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

      if (mode === 1) {
        // Sequencial
        key += 1n;
        if (key > end) {
          key = start; // Volta ao início do range
        }
      } else {
        // Aleatório
        const MAX_SAFE = Number.MAX_SAFE_INTEGER;
        const maxStep = rangeSize > BigInt(MAX_SAFE) ? MAX_SAFE : Number(rangeSize);
        const step = BigInt(Math.floor(Math.random() * maxStep) + 1);
        key += step;
        if (key > end) {
          key = start + (key - end - 1n); // Continua "loopando" no range
          if (key > end) key = start;
        }
      }
    }
    process.exit(0);
  }
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
    const start = min + BigInt(i) * baseChunkSize;
    let end = start + baseChunkSize - 1n;
    if (i === numThreads - 1) {
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

  if (PHps >= 1) return `${PHps.toFixed(2)} PH/s`;
  if (THps >= 1) return `${THps.toFixed(2)} TH/s`;
  if (GHps >= 1) return `${GHps.toFixed(2)} GH/s`;
  if (MHps >= 1) return `${MHps.toFixed(2)} MH/s`;
  if (kHps >= 1) return `${kHps.toFixed(2)} kH/s`;
  return `${speed.toFixed(2)} H/s`;
}
