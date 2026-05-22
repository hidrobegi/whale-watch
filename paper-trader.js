// paper-trader.js - Simulación con TP 20% (vende 50%) y TP 30% (vende resto)
// Reglas:
// - TP1 (+20%): vender 50% de la posición original
// - TP2 (+30%): vender el 50% restante (todo lo que quede)
// - Stop loss fijo: -15% desde entrada (cierra todo)
// - Trailing stop: -5% desde máximo (solo si ha subido al menos +5% desde entrada)
// - Capital inicial: 500 USDC
// - Tamaño por operación: 30 USDC

const INITIAL_BALANCE = 500.00;
const POSITION_SIZE = 30.00;           // 30 USDC por operación

// Take profits
const TP1_PERCENT = 0.20;              // +20%
const TP1_SELL_FRACTION = 0.50;        // vender el 50% de la posición ORIGINAL (la mitad)
const TP2_PERCENT = 0.30;              // +30%
// En TP2 se vende todo lo que quede (el otro 50% original, o lo que haya tras TP1)

// Stops
const STOP_LOSS_PERCENT = 0.15;        // -15% fijo desde entrada
const TRAILING_PERCENT = 0.05;         // -5% trailing desde máximo
const MIN_GAIN_TO_TRAIL = 0.05;        // mínimo +5% para activar trailing

let balance = INITIAL_BALANCE;
let activePositions = [];
let completedTrades = [];

// Abrir nueva posición simulada
async function openPaperPosition(tokenMint, tokenSymbol, entryPriceUSDC, txSignature) {
    const quantity = POSITION_SIZE / entryPriceUSDC;
    if (POSITION_SIZE > balance) {
        console.log(`⚠️ Saldo insuficiente para ${tokenSymbol}: necesita ${POSITION_SIZE.toFixed(2)} USDC, tiene ${balance.toFixed(2)} USDC`);
        return false;
    }
    const position = {
        id: Date.now(),
        tokenMint,
        tokenSymbol,
        quantity,               // cantidad total inicial
        originalQuantity: quantity,  // guardamos la cantidad original para TP1
        entryPrice: entryPriceUSDC,
        initialValue: POSITION_SIZE,
        highestPrice: entryPriceUSDC,
        txSignature,
        tp1Hit: false,
        tp2Hit: false,
        openDate: new Date().toISOString()
    };
    balance -= POSITION_SIZE;
    activePositions.push(position);
    console.log(`✅ PAPER: Abierta ${quantity.toFixed(4)} ${tokenSymbol} a ${entryPriceUSDC} USDC (${POSITION_SIZE.toFixed(2)} USDC). Saldo restante: ${balance.toFixed(2)} USDC`);
    return true;
}

// Actualizar posiciones con precios actuales
async function updatePositions(currentPrices) {
    const events = [];
    for (let i = 0; i < activePositions.length; i++) {
        const pos = activePositions[i];
        const currentPrice = currentPrices[pos.tokenMint];
        if (!currentPrice) continue;

        // Actualizar precio máximo
        if (currentPrice > pos.highestPrice) pos.highestPrice = currentPrice;

        const fixedStopPrice = pos.entryPrice * (1 - STOP_LOSS_PERCENT);
        const trailingStopPrice = pos.highestPrice * (1 - TRAILING_PERCENT);
        const trailingActive = pos.highestPrice >= pos.entryPrice * (1 + MIN_GAIN_TO_TRAIL);

        let closed = false;
        let sellPrice = null;
        let reason = '';
        let totalProfit = 0;

        // ---- TP1: +20% -> vender el 50% de la posición ORIGINAL ----
        if (!pos.tp1Hit && currentPrice >= pos.entryPrice * (1 + TP1_PERCENT)) {
            // La cantidad a vender es el 50% de la cantidad original
            const sellQty = pos.originalQuantity * TP1_SELL_FRACTION;
            // No vender más de lo que tenemos
            const actualSellQty = Math.min(sellQty, pos.quantity);
            const sellValue = actualSellQty * currentPrice;
            const profit = sellValue - (actualSellQty * pos.entryPrice);
            balance += sellValue;
            pos.quantity -= actualSellQty;
            pos.tp1Hit = true;
            events.push({
                type: 'TP1',
                symbol: pos.tokenSymbol,
                price: currentPrice,
                profit: profit,
                balance: balance
            });
            console.log(`🎯 TP1 (20%) en ${pos.tokenSymbol}: vendido ${actualSellQty.toFixed(4)} a ${currentPrice} USDC, ganancia ${profit.toFixed(2)} USDC. Saldo: ${balance.toFixed(2)} USDC`);
            if (pos.quantity <= 0.000001) {
                closed = true;
                sellPrice = currentPrice;
                reason = 'TP1';
                totalProfit = profit;
            }
        }

        // ---- TP2: +30% -> vender TODO lo que quede (el resto de la posición) ----
        if (!closed && !pos.tp2Hit && currentPrice >= pos.entryPrice * (1 + TP2_PERCENT)) {
            const sellQty = pos.quantity;
            if (sellQty > 0) {
                const sellValue = sellQty * currentPrice;
                const profit = sellValue - (sellQty * pos.entryPrice);
                balance += sellValue;
                pos.quantity = 0;
                pos.tp2Hit = true;
                events.push({
                    type: 'TP2',
                    symbol: pos.tokenSymbol,
                    price: currentPrice,
                    profit: profit,
                    balance: balance
                });
                console.log(`🎯 TP2 (30%) en ${pos.tokenSymbol}: vendido ${sellQty.toFixed(4)} a ${currentPrice} USDC, ganancia ${profit.toFixed(2)} USDC. Saldo: ${balance.toFixed(2)} USDC`);
                closed = true;
                sellPrice = currentPrice;
                reason = 'TP2';
                totalProfit = profit;
            }
        }

        // ---- Stop Loss Fijo (-15%) ----
        if (!closed && currentPrice <= fixedStopPrice) {
            const sellValue = pos.quantity * currentPrice;
            const profit = sellValue - (pos.quantity * pos.entryPrice);
            balance += sellValue;
            events.push({
                type: 'STOP_LOSS_FIJO',
                symbol: pos.tokenSymbol,
                price: currentPrice,
                profit: profit,
                balance: balance
            });
            console.log(`🛑 STOP FIJO (-15%) en ${pos.tokenSymbol}: cerrado a ${currentPrice} USDC, resultado ${profit.toFixed(2)} USDC. Saldo: ${balance.toFixed(2)} USDC`);
            closed = true;
            sellPrice = currentPrice;
            reason = 'SL_FIJO';
            totalProfit = profit;
        }

        // ---- Trailing Stop (-5% desde máximo) ----
        if (!closed && trailingActive && currentPrice <= trailingStopPrice) {
            const sellValue = pos.quantity * currentPrice;
            const profit = sellValue - (pos.quantity * pos.entryPrice);
            balance += sellValue;
            events.push({
                type: 'TRAILING_STOP',
                symbol: pos.tokenSymbol,
                price: currentPrice,
                profit: profit,
                balance: balance
            });
            console.log(`🛑 TRAILING STOP (-5%) en ${pos.tokenSymbol}: cerrado a ${currentPrice} USDC (máximo ${pos.highestPrice}), resultado ${profit.toFixed(2)} USDC. Saldo: ${balance.toFixed(2)} USDC`);
            closed = true;
            sellPrice = currentPrice;
            reason = 'TRAILING';
            totalProfit = profit;
        }

        if (closed) {
            completedTrades.push({
                ...pos,
                closePrice: sellPrice,
                closeReason: reason,
                closeDate: new Date().toISOString(),
                finalBalance: balance,
                totalProfit: totalProfit
            });
            activePositions.splice(i, 1);
            i--;
        }
    }
    return events;
}

// Obtener estado actual
function getStatus() {
    return {
        balance: balance,
        openPositions: activePositions.map(p => ({
            symbol: p.tokenSymbol,
            quantity: p.quantity,
            entryPrice: p.entryPrice,
            highestPrice: p.highestPrice,
            entryValue: p.initialValue,
        })),
        totalTradesClosed: completedTrades.length
    };
}

// Reiniciar simulación
function resetPaper() {
    balance = INITIAL_BALANCE;
    activePositions = [];
    completedTrades = [];
    console.log("🔄 Paper trading reiniciado a 500 USDC");
}

module.exports = {
    openPaperPosition,
    updatePositions,
    getStatus,
    resetPaper,
    get activePositions() { return activePositions; },
    get balance() { return balance; }
};
