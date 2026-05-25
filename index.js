process.env.NTBA_FIX_319 = 1;  // Evita conflictos de polling

const dotenv = require('dotenv');
dotenv.config();
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const axios = require('axios');
const paperTrader = require('./paper-trader');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MIN_SOL_AMOUNT = parseFloat(process.env.MIN_SOL_AMOUNT) || 0.3;
const MIN_MARKET_CAP = parseFloat(process.env.MIN_MARKET_CAP) || 1000;
const MAX_MARKET_CAP = parseFloat(process.env.MAX_MARKET_CAP) || 1e12;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID");
    process.exit(1);
}

// Inicializar bot con polling robusto
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

let whales = [];
try {
    whales = require('./whales.json').whales || [];
    console.log(`🐋 Cargadas ${whales.length} ballenas`);
} catch(e) {
    console.error("Error cargando whales.json", e);
    process.exit(1);
}

// ---------- Funciones auxiliares ----------
async function getTokenPriceUSDC(mint) {
    try {
        const url = `https://price.jup.ag/v6/price?ids=${mint}`;
        const res = await axios.get(url);
        const price = res.data.data[mint]?.price;
        return price ? parseFloat(price) : null;
    } catch(e) {
        console.error(`Error precio ${mint}:`, e.message);
        return null;
    }
}

async function getTokenMetadata(mint) {
    const apiKey = process.env.MORALIS_API_KEY;
    if (!apiKey) return null;
    try {
        const url = `https://deep-index.moralis.io/api/v2.2/erc20/metadata?chain=solana&addresses=${mint}`;
        const res = await axios.get(url, { headers: { 'X-API-Key': apiKey } });
        const data = res.data[0];
        if (!data) return null;
        return {
            name: data.name,
            symbol: data.symbol,
            marketCap: parseFloat(data.market_cap) || 0
        };
    } catch(e) {
        console.error(`Error Moralis ${mint}:`, e.message);
        return null;
    }
}

async function processTransaction(wallet, signature, solAmount, tokenMints) {
    console.log(`🐋 Transacción de ${wallet}, SOL: ${solAmount}`);
    if (Math.abs(solAmount) < MIN_SOL_AMOUNT) return;
    for (const mint of tokenMints) {
        const meta = await getTokenMetadata(mint);
        if (!meta) continue;
        if (meta.marketCap < MIN_MARKET_CAP || meta.marketCap > MAX_MARKET_CAP) {
            console.log(`Token ${meta.symbol} market cap ${meta.marketCap} fuera de rango`);
            continue;
        }
        const price = await getTokenPriceUSDC(mint);
        if (!price) continue;
        const opened = await paperTrader.openPaperPosition(mint, meta.symbol, price, signature);
        const msg = `🐋 *ALERTA BALLENA*\nWallet: ${wallet}\nToken: ${meta.symbol} (${meta.name})\nPrecio: ${price} USDC\nSOL movido: ${solAmount}\n${opened ? '📊 PAPER TRADING: Invertidos 30 USDC' : '⚠️ Saldo insuficiente'}`;
        await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    }
}

async function monitorPositions() {
    const prices = {};
    for (const pos of paperTrader.activePositions) {
        const p = await getTokenPriceUSDC(pos.tokenMint);
        if (p) prices[pos.tokenMint] = p;
    }
    const events = await paperTrader.updatePositions(prices);
    for (const ev of events) {
        let text = '';
        if (ev.type === 'TP1') text = `✅ *TP1 (20%)* ${ev.symbol}: vendido parcial, ganancia ${ev.profit.toFixed(2)} USDC. Saldo: ${ev.balance.toFixed(2)} USDC`;
        else if (ev.type === 'TP2') text = `✅ *TP2 (30%)* ${ev.symbol}: vendido parcial, ganancia ${ev.profit.toFixed(2)} USDC. Saldo: ${ev.balance.toFixed(2)} USDC`;
        else if (ev.type === 'STOP_LOSS_FIJO') text = `🛑 *STOP FIJO (-15%)* ${ev.symbol}: cerrado, resultado ${ev.profit.toFixed(2)} USDC. Saldo: ${ev.balance.toFixed(2)} USDC`;
        else if (ev.type === 'TRAILING_STOP') text = `🛑 *TRAILING STOP (-5%)* ${ev.symbol}: cerrado, resultado ${ev.profit.toFixed(2)} USDC. Saldo: ${ev.balance.toFixed(2)} USDC`;
        if (text) await bot.sendMessage(TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' });
    }
    setTimeout(monitorPositions, 30000);
}

// ---------- Comandos de Telegram ----------
bot.onText(/\/balance/, async (msg) => {
    const status = paperTrader.getStatus();
    let text = `💰 *PAPER BALANCE*: ${status.balance.toFixed(2)} USDC\n📊 Posiciones abiertas: ${status.openPositions.length}\n📈 Trades cerrados: ${status.totalTradesClosed}`;
    if (status.openPositions.length) {
        text += `\n\n*Posiciones actuales:*\n` + status.openPositions.map(p => `• ${p.symbol}: ${p.quantity.toFixed(4)} @ ${p.entryPrice} USDC`).join('\n');
    }
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/resetpaper/, async (msg) => {
    paperTrader.resetPaper();
    await bot.sendMessage(msg.chat.id, "🔄 Paper trading reiniciado a 500 USDC. Todas las posiciones cerradas.");
});

bot.onText(/\/status/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "🐋 Bot activo. WebSocket conectado. Escuchando ballenas.");
});

// ---------- WebSocket para Solana ----------
function connectWebSocket() {
    const ws = new WebSocket(process.env.WEBSOCKET_ENDPOINT || 'wss://api.mainnet-beta.solana.com');
    ws.on('open', () => {
        console.log('✅ WebSocket conectado a Solana');
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'logsSubscribe',
            params: [{ mentions: whales.map(w => w.address) }, { commitment: 'confirmed' }]
        }));
    });
    ws.on('message', async (data) => {
        const parsed = JSON.parse(data);
        if (parsed.method === 'logsNotification') {
            const log = parsed.params.result;
            const signature = log.value.signature;
            let wallet = null;
            for (const w of whales) {
                if (log.value.logs?.some(l => l.includes(w.address))) {
                    wallet = w.address;
                    break;
                }
            }
            if (wallet) {
                // Aquí necesitas parsear los logs reales para obtener SOL change y token mints
                // Como ejemplo, extraemos de los logs que nos has pasado anteriormente
                const solChangeMatch = log.value.logs?.join(' ').match(/SOL change: ([-+]?\d*\.?\d+)/);
                const solChange = solChangeMatch ? parseFloat(solChangeMatch[1]) : 0;
                const tokenMintsMatch = log.value.logs?.join(' ').match(/Found \d+ tokens in transaction: \[ '([^']+)' \]/);
                const tokenMints = tokenMintsMatch ? [tokenMintsMatch[1]] : ["So11111111111111111111111111111111111111112"];
                if (solChange !== 0) {
                    await processTransaction(wallet, signature, solChange, tokenMints);
                }
            }
        }
    });
    ws.on('error', (err) => console.error('❌ WebSocket error:', err));
    ws.on('close', () => {
        console.log('⚠️ WebSocket cerrado, reconectando en 5s...');
        setTimeout(connectWebSocket, 5000);
    });
}

connectWebSocket();
monitorPositions();
