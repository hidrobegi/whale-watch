require('dotenv').config();
const fs = require('fs');

// Environment Variables
const config = {
    // WebSocket and RPC endpoints from environment variables
    WEBSOCKET_ENDPOINT: process.env.WEBSOCKET_ENDPOINT,
    RPC_ENDPOINT: process.env.RPC_ENDPOINT,

    // Telegram configuration
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    
    // Moralis configuration
    MORALIS_API_KEY: process.env.MORALIS_API_KEY,
    MAX_RETRY_ATTEMPTS: 1,
    RETRY_DELAY_MS: 333,
    
    // File paths
    WHALES_FILE: process.env.WHALES_FILE || 'whales.json',
    
    // WebSocket configuration
    PING_INTERVAL: parseInt(process.env.PING_INTERVAL) || 3000,
    PONG_TIMEOUT: parseInt(process.env.PONG_TIMEOUT) || 1000,
	MORALIS_TIMEOUT: parseInt(process.env.MORALIS_TIMEOUT) || 5000,
    
    // Transaction processing configuration
    MAX_CONCURRENT_TXS: parseInt(process.env.MAX_CONCURRENT_TXS) || 21,
    TX_QUEUE_SIZE: parseInt(process.env.TX_QUEUE_SIZE) || 1000,
    TX_TIMEOUT: parseInt(process.env.TX_TIMEOUT) || 5000,

    // Filter settings
    MIN_SOL_AMOUNT: parseFloat(process.env.MIN_SOL_AMOUNT) || 1, // Minimum SOL amount for notification
    MIN_MARKET_CAP: parseFloat(process.env.MIN_MARKET_CAP) || 369000, // Minimum market cap in USD
    MAX_MARKET_CAP: parseFloat(process.env.MAX_MARKET_CAP) || 21000000, // Maximum market cap in USD
};

// Validate required environment variables
const requiredEnvVars = [
    'WEBSOCKET_ENDPOINT', 
    'RPC_ENDPOINT',
    'MORALIS_API_KEY'
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}

// Load and process whale data
function loadWhaleData() {
    try {
        const whalesData = JSON.parse(fs.readFileSync(config.WHALES_FILE, 'utf8'));
        const whaleAddresses = new Set(whalesData.whales.map(whale => whale.address));
        const whaleLabels = new Map(whalesData.whales.map(whale => [whale.address, whale.label]));
        
        return {
            whaleAddresses,
            whaleLabels
        };
    } catch (error) {
        console.error('Error loading whale data:', error);
        throw error;
    }
}

module.exports = {
    config,
    loadWhaleData
};