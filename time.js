const ranges = require('./utils/ranges');

const range = ranges[66]

const min = range.min;
const max = range.max;

// Número total de chaves
const totalKeys = max - min + 1n;

// Função para calcular o tempo necessário em várias unidades de hash rate
function calculateTime(hashRate) {
    const timeInSeconds = Number(totalKeys) / hashRate;
    const timeInMinutes = timeInSeconds / 60;
    const timeInHours = timeInMinutes / 60;
    const timeInDays = timeInHours / 24;
    const timeInYears = timeInDays / 365;
    
    return {
        timeInSeconds: timeInSeconds.toFixed(2),
        timeInMinutes: timeInMinutes.toFixed(2),
        timeInHours: timeInHours.toFixed(2),
        timeInDays: timeInDays.toFixed(2),
        timeInYears: timeInYears.toFixed(2)
    };
}

const hashRate = 3

// Taxas de hash
const rates = {
    "1 kH/s": hashRate * 1e3,
    "1 MH/s": hashRate * 1e6,
    "1 GH/s": hashRate * 1e9,
    "1 TH/s": hashRate * 1e12,
    "1 PH/s": hashRate * 1e15,
    "1 EH/s": hashRate * 1e18,
    "1 ZH/s": hashRate * 1e21,
    "1 YH/s": hashRate * 1e24,
};

// Calcular e exibir o tempo necessário para cada taxa de hash
for (const [label, hashRate] of Object.entries(rates)) {
    const time = calculateTime(hashRate);
    console.log(`\nHash rate: ${label}`);
    console.log(`Tempo necessário: ${time.timeInSeconds} segundos`);
    console.log(`Tempo necessário: ${time.timeInMinutes} minutos`);
    console.log(`Tempo necessário: ${time.timeInHours} horas`);
    console.log(`Tempo necessário: ${time.timeInDays} dias`);
    console.log(`Tempo necessário: ${time.timeInYears} anos`);
}
