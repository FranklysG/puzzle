const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const os = require('os');
const CoinKey = require('coinkey');

const wallets = require('./utils/wallets');
const ranges = require('./utils/ranges');

const range = ranges[67]; // { min: 0x40000000000000000n, max: 0x7ffffffffffffffffn, status: 0, range: 67 }
const totalThreads = os.cpus().length;
let threadLogs = Array(totalThreads).fill(''); // Armazena o log de cada thread

if (isMainThread) {
  const min = range.min;
  const max = range.max;
  const totalKeys = max - min + 1n;
  const baseChunkSize = totalKeys / BigInt(totalThreads);

  console.clear(); // Limpa o terminal antes de iniciar o processamento
  console.log(`Iniciando ${totalThreads} threads para processar as chaves...\n`);

  // Inicializa as linhas para cada thread no terminal
  for (let i = 0; i < totalThreads; i++) {
    console.log(`Thread ${i}: Aguardando...`);
  }

  for (let i = 0; i < totalThreads; i++) {
    const start = min + BigInt(i) * baseChunkSize;
    let end = start + baseChunkSize - 1n;

    if (i === totalThreads - 1) {
      end = max;
    }

    const worker = new Worker(__filename, { workerData: { start, end, threadId: i } });

    // Recebe e loga mensagens dos workers
    worker.on('message', (msg) => {
      threadLogs[i] = msg; // Atualiza o log da thread correspondente
      updateLogs(); // Atualiza os logs no terminal
    });
  }
} else {
  if (parentPort) {
    const { start, end, threadId } = workerData;
    let key = start;
    let cont = 0;
    const startTime = Date.now();

    while (key <= end) {
      cont++;
      key += 1n;

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
      const public = generatePublicKey(pkey);
      const percentageChecked = ((Number(key - start) / Number(end - start + 1n)) * 100).toFixed(2);

      if (cont % 1000 === 0) {
          // Envia a mensagem para ser logada na thread principal
          console.clear();
          parentPort.postMessage(`Thread ${threadId}: ${pkey} ${public} ${Hs} (${percentageChecked}% verificado)`);
      }

      if (wallets.includes(public)) {
        const keyWif = generateWIF(pkey);
        parentPort.postMessage(`Encontrada ${threadId}: ${pkey} -> WIF: ${keyWif} em (${percentageChecked}% range)`);
        process.exit();
      }
    }
  }
}

// Função para atualizar os logs no terminal
function updateLogs() {
  // Move o cursor para o início (linha 0)
  process.stdout.write('\x1B[0;0H');
  console.log(`Iniciando ${totalThreads} threads para processar as chaves...\n`);

  // Reescreve os logs de cada thread
  for (let i = 0; i < totalThreads; i++) {
    console.log(threadLogs[i] || `Thread ${i}: Aguardando...`);
  }
}

function generatePublicKey(privatekey) {
  const key = new CoinKey(Buffer.from(privatekey, 'hex'));
  key.compressed = true;
  return key.publicAddress;
}

function generateWIF(privateKey) {
  let _key = new CoinKey(Buffer.from(privateKey, 'hex'));
  return _key.privateWif;
}
