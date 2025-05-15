# SolWhale Tracker

A real-time Solana blockchain monitoring system that tracks transactions from influential "whale" wallets and sends notifications to Telegram when they interact with tokens that meet specific market criteria.

## 📋 Features

- **Real-time whale transaction monitoring** via Solana WebSocket connections
- **Smart transaction filtering** based on token market cap and transaction size
- **Rich token data enrichment** via Moralis API integration
- **Detailed Telegram notifications** with transaction analysis and visual indicators
- **Robust error handling and reconnection strategies** for 24/7 operation

## 🛠️ Prerequisites

- Node.js (v14+)
- npm or yarn
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Moralis API Key ([Sign up here](https://moralis.io/))
- Access to Solana RPC and WebSocket endpoints

## 🚀 Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/solwhale-tracker.git
   cd solwhale-tracker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root with the following variables:
   ```
   # Solana WebSocket and RPC endpoints
   WEBSOCKET_ENDPOINT=wss://api.mainnet-beta.solana.com
   RPC_ENDPOINT=https://api.mainnet-beta.solana.com
   
   # Telegram configuration
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_CHAT_ID=your_telegram_chat_id
   
   # Moralis API
   MORALIS_API_KEY=your_moralis_api_key
   
   # Optional configuration
   MIN_SOL_AMOUNT=1
   MIN_MARKET_CAP=369000
   MAX_MARKET_CAP=21000000
   PING_INTERVAL=3000
   PONG_TIMEOUT=1000
   MORALIS_TIMEOUT=5000
   ```

4. Update the `whales.json` file with the wallet addresses you want to track:
   ```json
   {
     "whales": [
       {
         "address": "WALLET_ADDRESS_1",
         "label": "Whale Name 1"
       },
       {
         "address": "WALLET_ADDRESS_2",
         "label": "Whale Name 2"
       }
     ]
   }
   ```

## ▶️ Usage

Start the tracker:

```bash
node index.js
```

For production environments, it's recommended to use a process manager:

```bash
npm install -g pm2
pm2 start index.js --name solwhale-tracker
```

## ⚙️ Configuration

The application behavior can be customized through environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `MIN_SOL_AMOUNT` | Minimum SOL transaction amount to trigger a notification | 1 |
| `MIN_MARKET_CAP` | Minimum token market cap (in USD) | 369000 |
| `MAX_MARKET_CAP` | Maximum token market cap (in USD) | 21000000 |
| `PING_INTERVAL` | WebSocket ping interval (ms) | 3000 |
| `PONG_TIMEOUT` | WebSocket pong timeout (ms) | 1000 |
| `MORALIS_TIMEOUT` | Moralis API request timeout (ms) | 5000 |
| `MAX_CONCURRENT_TXS` | Maximum concurrent transaction processing | 21 |
| `TX_QUEUE_SIZE` | Maximum transaction queue size | 1000 |
| `TX_TIMEOUT` | Transaction processing timeout (ms) | 5000 |

## 🏭 System Architecture

The system consists of the following components:

1. **WebSocketManager** (`websocket.js`): Manages the connection to Solana's WebSocket API and subscribes to transaction logs from whale addresses.

2. **TransactionProcessor** (`transaction.js`): Processes transaction data, filters based on criteria, and extracts token balance changes.

3. **MoralisService** (`moralis-service.js`): Enriches token data with market information from Moralis API.

4. **TelegramService** (`telegram-service.js`): Formats and sends notifications to Telegram.

5. **Config** (`config.js`): Loads and validates configuration from environment variables.

## 🚧 Limitations

- The free tier of Solana RPC endpoints may have rate limits that affect performance
- Moralis API has rate limits that are handled by the application's rate limiter
- Large volume of transactions may require adjusting the queue size and concurrency settings

## 🔧 Troubleshooting

**Connection Issues:**
- Ensure your RPC and WebSocket endpoints are correct and accessible
- Check if your IP is rate-limited by the RPC provider

**Missing Transactions:**
- Verify that whale addresses are correctly formatted
- Increase the `TX_QUEUE_SIZE` and `MAX_CONCURRENT_TXS` values

**API Rate Limits:**
- The Moralis rate limiter should handle this automatically, but you may need to adjust if encountering persistent issues

## 📊 Example Notification

```
BONK 🔴🐳 2.5 SOL SELL by Whale Name

📝 Token Info

Name: Bonk
Description: A community token for the Solana ecosystem...

📊 Market Data

💰 Market Cap: $15.7M
📈 1h Volume: $2.1M
🔴 1h Netflow: -$150K

🐋 Whale Data

SOL Balance: 1250.7 SOL
Token Balance:
Pre:  ████████░░ (15,000,000.00)
Post: ░░░░░░░░░░ (0.00)

What's the CA?

So11111111111111111111111111111111111111112

View Transaction ↗️
```

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgements

- Thanks to the Solana and Moralis teams for providing the APIs that make this project possible
- Inspired by various whale tracking services across the crypto ecosystem