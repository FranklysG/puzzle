const { Worker, isMainThread, workerData } = require('worker_threads');
const os = require('os');

if (isMainThread) {
  // Número de threads disponíveis
  const numThreads = os.cpus().length;
  
  console.log(`Iniciando ${numThreads} workers`);

  // Criando um worker para cada thread disponível
  for (let i = 0; i < numThreads; i++) {
    new Worker(__filename, { workerData: i });
  }
} else {
  // Código executado por cada worker
  console.log(`Worker ${workerData} executando...`);
  
  // Simulação de processamento pesado
  let count = 0;
  for (let i = 0; i < 1e9; i++) {
    count++;
  }

  console.log(`Worker ${workerData} terminou processamento.`);
}
