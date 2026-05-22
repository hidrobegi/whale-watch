// index.js - whale-watch con paper trading y comandos Telegram
const dotenv = require('dotenv');
dotenv.config();

const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const axios = require('axios');
const paperTrader = require('./paper-trader');

// ---------- Configuración ----------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MIN_SOL_AMOUNT = parseFloat(process.env.MIN_SOL_AMOUNT) || 1;
const MIN_MARKET_CAP = parseFloat(process.env.MIN_MARKET_CAP) || 0;
const MAX_MARKET_CAP = parseFloat(process.env.MAX_MARKET_CAP) || 1e12;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Faltan variables de entorno: TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID");
    process.exit(1);
}

// Inicializar bot de Telegram
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Cargar ballenas
let whales = [];
try {
    const whalesJson = require('./whales.json');
    whales = whalesJson.whales || [];
    console.log(`🐋 Cargadas ${whales.length} ballenas desde whales.json`);
} catch (err) {
    console.error("Error cargando whales.json:", err.message);
    process.exit(1);
}

// ---------- Funciones auxiliares ----------
async function getTokenPriceUSDC(mint) {
    try {
        const url = `https://price.jup.ag/v6/price?ids=${mint}`;
        const response = await axios.get(url);
        const price = response.data.data[mint]?.price;
        return price ? parseFloat(price) : null;
    } catch (err) {
        console.error(`Error precio ${mint}:`, err.message);
        return null;
    }
}

async function getTokenMetadata(mint) {
    const apiKey = process.env.MORALIS_API_KEY;
    if (!apiKey) return null;
    try {
        const url = `https://deep-index.moralis.io/api/v2.2/erc20/metadata?chain=solana&addresses=${mint}`;
        const response = await axios.get(url, { headers: { 'X-API-Key': apiKey } });
        const data = response.data[0];
        if (!data) return null;
        return {
            name: data.name,
            symbol: data.symbol,
            marketCap: parseFloat(data.market_cap) || 0
        };
    } catch (err) {
        console.error(`Error Moralis ${mint}:`, err.message);
        return null;
    }
}

// Procesar transacción detectada
async function processTransaction(wallet, signature, solAmount, tokenMints) {
    console.log(`🐋 Transacción de ${wallet}, SOL: ${solAmount}, tokens: ${tokenMints.join(', ')}`);
    if (Math.abs(solAmount) < MIN_SOL_AMOUNT) {
        console.log(`Ignorada por SOL insuficiente (${solAmount} < ${MIN_SOL_AMOUNT})`);
        return;
    }
    for (const mint of tokenMints) {
        const metadata = await getTokenMetadata(mint);
        if (!metadata) continue;
        if (metadata.marketCap < MIN_MARKET_CAP || metadata.marketCap > MAX_MARKET_CAP) {
            console.log(`Token ${metadata.symbol} market cap ${metadata.marketCap} fuera de rango`);
            continue;
        }
        const price = await getTokenPriceUSDC(mint);
        if (!price) continue;
        
        // Abrir posición de paper trading con 30 USDC
        const opened = await paperTrader.openPaperPosition(mint, metadata.symbol, price, signature);
        
        // Enviar alerta a Telegram
        const msg = `
🐋 *ALERTA BALLENA*
Wallet: ${wallet}
Token: ${metadata.symbol} (${metadata.name})
Precio: ${price} USDC
SOL movido: ${solAmount} SOL (~${(Math.abs(solAmount)*200).toFixed(0)} USD)
${opened ? `📊 *PAPER TRADING*: Invertidos 30 USDC simulados en ${metadata.symbol}` : '⚠️ Saldo insuficiente para paper trading'}
        `;
        await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    }
}

// ---------- Monitor de posiciones (cada 30 segundos) ----------
async function monitorPositions() {
    const currentPrices = {};
    for (const pos of paperTrader.activePositions) {
        const price = await getTokenPriceUSDC(pos.tokenMint);
        if (price) currentPrices[pos.tokenMint] = price;
    }
    const events = await paperTrader.updatePositions(currentPrices);
    for (const ev of events) {
        let text = '';
        if (ev.type === 'TP1') text = `✅ *TP1 (20%)* ${ev.symbol}: vendido parcial a ${ev.price} USDC, ganancia ${ev.profit.toFixed(2)} USDC. Saldo: ${ev.balance.toFixed(2)} USDC`;
        else if (ev.type === 'TP2') text = `✅ *TP2 (30%)* ${ev.symbol}: vendido parcial a ${ev.price} USDC, ganancia ${ev.profit.toFixed(2)} USDC. Saldo: ${ev.balance.toFixed(2)} USDC`;
        else if (ev.type === 'STOP_LOSS_FIJO') text = `🛑 *STOP FIJO (-15%)* ${ev.symbol}: cerrado a ${ev.price} USDC, resultado ${ev.profit.toFixed(2)} USDC. Saldo: ${ev.balance.toFixed(2)} USDC`;
        else if (ev.type === 'TRAILING_STOP') text = `🛑 *TRAILING STOP (-5%)* ${ev.symbol}: cerrado a ${ev.price} USDC, resultado ${ev.profit.toFixed(2)} USDC. Saldo: ${ev.balance.toFixed(2)} USDC`;
        if (text) await bot.sendMessage(TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' });
    }
    setTimeout(monitorPositions, 30000);
}

// ---------- Comandos de Telegram ----------
bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const status = paperTrader.getStatus();
        let text = `💰 *PAPER BALANCE*: ${status.balance.toFixed(2)} USDC\n`;
        text += `📊 Posiciones abiertas: ${status.openPositions.length}\n`;
        text += `📈 Trades cerrados: ${status.totalTradesClosed}\n`;
        if (status.openPositions.length > 0) {
            text += `\n*Posiciones actuales:*\n`;
            for (const pos of status.openPositions) {
                text += `• ${pos.symbol}: ${pos.quantity.toFixed(4)} tokens a ${pos.entryPrice} USDC\n`;
            }
        }
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error("Error en /balance:", err);
        await bot.sendMessage(chatId, "❌ Error al obtener estado del paper trading.");
    }
});

bot.onText(/\/resetpaper/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        paperTrader.resetPaper();
        await bot.sendMessage(chatId, "🔄 Paper trading reiniciado a 500 USDC. Todas las posiciones cerradas.");
    } catch (err) {
        console.error("Error en /resetpaper:", err);
        await bot.sendMessage(chatId, "❌ Error al reiniciar paper trading.");
    }
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, "🐋 Bot activo. WebSocket conectado. Escuchando ballenas.");
});

// ---------- WebSocket para Solana ----------
let ws = null;
let isConnected = false;

function connectWebSocket() {
    const wsUrl = process.env.WEBSOCKET_ENDPOINT || 'wss://api.mainnet-beta.solana.com';
    ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
        console.log('WebSocket conectado');
        isConnected = true;
        const subscribeMsg = {
            jsonrpc: '2.0',
            id: 1,
            method: 'logsSubscribe',
            params: [
                { mentions: whales.map(w => w.address) },
                { commitment: 'confirmed' }
            ]
        };
        ws.send(JSON.stringify(subscribeMsg));
    });
    
    ws.on('message', async (data) => {
        const parsed = JSON.parse(data);
        if (parsed.method === 'logsNotification') {
            const log = parsed.params.result;
            const signature = log.value.signature;
            // Buscar wallet mencionada
            let involvedWallet = null;
            for (const whale of whales) {
                if (log.value.logs?.some(l => l.includes(whale.address))) {
                    involvedWallet = whale.address;
                    break;
                }
            }
            if (involvedWallet) {
                // Extraer cambios de SOL y mints de tokens (simplificado)
                // En una implementación real, parsearías los logs detalladamente
                const solChange = 5.0; // Placeholder
                const tokenMints = ["So11111111111111111111111111111111111111112"]; // Placeholder
                await processTransaction(involvedWallet, signature, solChange, tokenMints);
            }
        }
    });
    
    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        isConnected = false;
        setTimeout(connectWebSocket, 5000);
    });
    
    ws.on('close', () => {
        console.log('WebSocket cerrado, reconectando...');
        isConnected = false;
        setTimeout(connectWebSocket, 5000);
    });
}

// ---------- Arranque ----------
console.log('🚀 Iniciando whale-watch con paper trading');
connectWebSocket();
monitorPositions();
