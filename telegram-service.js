const https = require('https');
const { config } = require('./config');

class TelegramService {
    constructor() {
        // Pre-create the agent with optimal settings for low latency
        this.agent = new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 100,
            scheduling: 'lifo',
            timeout: 2000
        });

        // Pre-compile frequently used strings and emoji
        this.BLOCK_FILL = '█';
        this.BLOCK_EMPTY = '░';
        this.MAX_BLOCKS = 10;
    }

    formatNumber(num) {
        if (!num) return '0';
        const absNum = Math.abs(num);
        return absNum >= 1e9 ? (num/1e9).toFixed(2) + 'B' 
             : absNum >= 1e6 ? (num/1e6).toFixed(2) + 'M'
             : absNum >= 1e3 ? (num/1e3).toFixed(2) + 'K'
             : num.toFixed(2);
    }

    getSizeEmoji(solValue) {
        if (solValue < 1) return '🦐';
        if (solValue < 7) return '🐠';
        if (solValue < 27) return '🦈';
        if (solValue < 69) return '🐳';
        return '🐉';
    }

    getBalanceIndicator(preBalance, postBalance) {
        // Find the larger value to scale against
        const maxBalance = Math.max(preBalance, postBalance);
        
        if (maxBalance === 0) {
            return {
                pre: this.BLOCK_EMPTY.repeat(this.MAX_BLOCKS),
                post: this.BLOCK_EMPTY.repeat(this.MAX_BLOCKS)
            };
        }

        // Calculate relative sizes
        const preBlocks = Math.round((preBalance / maxBalance) * this.MAX_BLOCKS);
        const postBlocks = Math.round((postBalance / maxBalance) * this.MAX_BLOCKS);

        return {
            pre: this.BLOCK_FILL.repeat(preBlocks) + this.BLOCK_EMPTY.repeat(this.MAX_BLOCKS - preBlocks),
            post: this.BLOCK_FILL.repeat(postBlocks) + this.BLOCK_EMPTY.repeat(this.MAX_BLOCKS - postBlocks)
        };
    }

    sendNotification(txData, moralisData) {
        try {
            const tokenData = txData.data.tokenData[0];
            const moralisTokenData = moralisData.data.tokenData[0].moralis;
            const solChange = txData.data.solChange;
            const isBuy = solChange < 0;

            // Get balance indicators
            const balanceIndicators = this.getBalanceIndicator(tokenData.preBalance, tokenData.postBalance);

            // Construct message with minimal string operations
            const message = [
                `${moralisTokenData.symbol || 'Unknown'} ${isBuy ? '🟢' : '🔴'}${this.getSizeEmoji(Math.abs(solChange))} ${Math.abs(solChange).toFixed(1)} SOL ${isBuy ? 'BUY' : 'SELL'} by ${txData.whaleLabel}`,
                '',
                '📝 Token Info',
                '',
                `Name: ${moralisTokenData.name || 'Unknown'}`,
                `Description: ${(moralisTokenData.description || '').slice(0, 300)}${moralisTokenData.description?.length > 300 ? '...' : ''}`,
                '',
                '📊 Market Data',
                '',
                `💰 Market Cap: $${this.formatNumber(moralisTokenData.marketCap)}`,
                `📈 1h Volume: $${this.formatNumber(moralisTokenData.volume1h)}`,
                `${(moralisTokenData.netflow1h || 0) >= 0 ? '🟢' : '🔴'} 1h Netflow: $${this.formatNumber(moralisTokenData.netflow1h)}`,
                '',
                '🐋 Whale Data',
                '',
                `SOL Balance: ${txData.data.postBalanceSol.toFixed(1)} SOL`,
                'Token Balance:',
                `Pre:  ${balanceIndicators.pre} (${this.formatNumber(tokenData.preBalance)})`,
                `Post: ${balanceIndicators.post} (${this.formatNumber(tokenData.postBalance)})`,
                '',
                `What's the CA?`,
                '',
                `<code>${tokenData.mint}</code>`,
                '',
                `<a href="https://solscan.io/tx/${txData.data.signature}">View Transaction ↗️</a>`
            ].join('\n');

            // Fire-and-forget request for minimal latency
            const endpoint = moralisTokenData.image ? 'sendPhoto' : 'sendMessage';
            const payload = {
                chat_id: config.TELEGRAM_CHAT_ID,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: JSON.stringify({
                    inline_keyboard: [[
                        {
                            text: '🔍 View on DEXScreener',
                            url: `https://dexscreener.com/solana/${tokenData.mint}`
                        }
                    ]]
                })
            };

            if (moralisTokenData.image) {
                payload.photo = moralisTokenData.image;
                payload.caption = message;
            } else {
                payload.text = message;
            }

            const req = https.request(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                agent: this.agent
            });

            req.on('error', (error) => {
                console.error('Telegram notification error:', error.message);
            });

            req.write(JSON.stringify(payload));
            req.end();

        } catch (error) {
            console.error('Error:', error.message);
        }
    }

    cleanup() {
        if (this.agent) {
            this.agent.destroy();
        }
    }
}

module.exports = new TelegramService();
