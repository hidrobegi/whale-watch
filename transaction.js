const https = require('https');
const { config, loadWhaleData } = require('./config');
const moralisService = require('./moralis-service');

// Load whale data
const { whaleAddresses, whaleLabels } = loadWhaleData();

// Create persistent HTTP agent for connection pooling
const httpAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 25,
    scheduling: 'lifo',
    timeout: 1000
});

class TransactionProcessor {
    constructor() {
        this.activeRequests = new Set();
    }

    shouldProcessTransaction(logData) {
        const logs = logData?.logs || [];
        return logs.some(log => 
            log.includes('Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke')
        );
    }

     meetsFilterCriteria(solChange, marketCap) {
        const solAmount = Math.abs(solChange);
        return solAmount >= config.MIN_SOL_AMOUNT && 
               marketCap && 
               marketCap > 0 && 
               marketCap >= config.MIN_MARKET_CAP && 
               marketCap <= config.MAX_MARKET_CAP;
    }
	
	async queueTransaction(signature, timestamp, logData) {
        if (this.activeRequests.has(signature)) return;
        
        if (!this.shouldProcessTransaction(logData)) return;
        
        this.activeRequests.add(signature);
        try {
            await this.processTransaction(signature, timestamp);
        } catch (error) {
            console.error(`TX Error ${signature}:`, error.message);
        } finally {
            this.activeRequests.delete(signature);
        }
    }
    
    processTransaction(signature, timestamp) {
        return new Promise((resolve, reject) => {
            console.log(`Fetching transaction details for ${signature}`);
            
            const txRequest = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'getTransaction',
                params: [
                    signature,
                    {
                        commitment: 'confirmed',
                        maxSupportedTransactionVersion: 0,
                        encoding: 'jsonParsed'
                    }
                ]
            };

            const req = https.request(config.RPC_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Connection': 'keep-alive'
                },
                timeout: config.TX_TIMEOUT,
                agent: httpAgent
            });

            let responseData = '';

            req.on('response', (res) => {
                res.on('data', chunk => responseData += chunk);
                res.on('end', async () => {
                    try {
                        const response = JSON.parse(responseData);
                        
                        if (response.error) {
                            console.error('RPC error:', response.error);
                            reject(new Error(response.error.message));
                            return;
                        }

                        await this.handleTransactionResponse(response, timestamp);
                        resolve();
                    } catch (error) {
                        console.error('Error processing response:', error);
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                console.error('Request error:', error);
                reject(error);
            });

            req.on('timeout', () => {
                console.error('Request timeout');
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(JSON.stringify(txRequest));
            req.end();
        });
    }
    
    async handleTransactionResponse(response, timestamp) {
        try {
            const tx = response.result;
            if (!tx) {
                console.log('No transaction data found');
                return;
            }

            const signer = tx.transaction?.message?.accountKeys?.[0]?.pubkey;
            if (!signer) {
                console.log('No signer found in transaction');
                return;
            }

            if (!whaleAddresses.has(signer)) {
                console.log(`Signer ${signer} is not a whale`);
                return;
            }

            console.log(`Whale transaction detected from ${whaleLabels.get(signer)}`);

            const { preTokenBalances, postTokenBalances, walletAddresses, tokenMints } = 
                this.processTokenBalances(tx, signer);

            if (Object.keys(postTokenBalances).length === 0) {
                console.log('No token balance changes found');
                return;
            }

            console.log(`Found ${tokenMints.length} tokens in transaction:`, tokenMints);

            const preBalanceSol = tx.meta?.preBalances?.[0] / 1e9 || 0;
            const postBalanceSol = tx.meta?.postBalances?.[0] / 1e9 || 0;
            const solChange = postBalanceSol - preBalanceSol;

            console.log(`SOL change: ${solChange}`);

            // Parallel fetch of Moralis data for all tokens
            console.log('Fetching Moralis data...');
            const moralisData = await moralisService.getTokensData(tokenMints);
            
            if (!moralisData || moralisData.length === 0) {
                console.log('No valid Moralis data found for tokens');
                return;
            }

            console.log('Moralis data received:', JSON.stringify(moralisData, null, 2));

            // Create map for easy token data lookup
            const moralisMap = {};
            moralisData.forEach(data => {
                if (data && data.mint) {
                    moralisMap[data.mint] = data;
                }
            });

            // Check if any token meets the filter criteria
            const validTokens = tokenMints.filter(mint => {
                const tokenData = moralisMap[mint];
                if (!tokenData) {
                    console.log(`No Moralis data for token ${mint}`);
                    return false;
                }
                const meetsFilters = this.meetsFilterCriteria(solChange, tokenData.marketCap);
                if (!meetsFilters) {
                    console.log(`Token ${mint} failed filters: SOL change ${solChange}, Market cap ${tokenData.marketCap}`);
                }
                return meetsFilters;
            });

            if (validTokens.length === 0) {
                console.log('No tokens met the filter criteria');
                return;
            }

            console.log(`Found ${validTokens.length} valid tokens, preparing notification...`);

            // Prepare transaction details
            const txDetails = {
                timestamp: new Date(timestamp).toISOString(),
                receivedTime: timestamp,
                whaleAddress: signer,
                whaleLabel: whaleLabels.get(signer),
                data: {
                    signature: tx.transaction?.signatures[0],
                    blockTime: tx.blockTime,
                    preBalanceSol,
                    postBalanceSol,
                    solChange,
                    tokenData: validTokens.map(mint => ({
                        mint,
                        walletAddress: walletAddresses[mint],
                        preBalance: preTokenBalances[mint] || 0,
                        postBalance: postTokenBalances[mint] || 0,
                        change: (postTokenBalances[mint] || 0) - (preTokenBalances[mint] || 0)
                    }))
                }
            };

            // Prepare Moralis data for notification
            const moralisLogData = {
                timestamp: new Date(timestamp).toISOString(),
                receivedTime: timestamp,
                data: {
                    signature: txDetails.data.signature,
                    tokenData: validTokens.map(mint => ({
                        mint,
                        moralis: moralisMap[mint] || {}
                    }))
                }
            };

            console.log('Sending notification...');
            // Send Telegram notification
            const telegramService = require('./telegram-service');
            await telegramService.sendNotification(txDetails, moralisLogData);
            console.log('Notification sent successfully');

        } catch (error) {
            console.error('Error processing transaction data:', error);
            throw error;
        }
    }
    
    processTokenBalances(tx, whaleAddress) {
        if (!tx.meta) {
            console.log('No meta data in transaction');
            return { 
                preTokenBalances: {}, 
                postTokenBalances: {}, 
                walletAddresses: {},
                tokenMints: []
            };
        }

        const preTokenBalances = {};
        const postTokenBalances = {};
        const walletAddresses = {};
        const tokenMints = new Set();

        // Process pre-balances
        tx.meta.preTokenBalances?.forEach(balance => {
            if (balance.owner === whaleAddress && 
                balance.mint !== 'So11111111111111111111111111111111111111112') {
                preTokenBalances[balance.mint] = balance.uiTokenAmount.uiAmount || 0;
                walletAddresses[balance.mint] = balance.owner;
                tokenMints.add(balance.mint);
            }
        });

        // Process post-balances
        tx.meta.postTokenBalances?.forEach(balance => {
            if (balance.owner === whaleAddress && 
                balance.mint !== 'So11111111111111111111111111111111111111112') {
                postTokenBalances[balance.mint] = balance.uiTokenAmount.uiAmount || 0;
                walletAddresses[balance.mint] = balance.owner;
                tokenMints.add(balance.mint);
            }
        });

        console.log(`Found ${tokenMints.size} tokens with balance changes`);
        return { 
            preTokenBalances, 
            postTokenBalances, 
            walletAddresses,
            tokenMints: Array.from(tokenMints)
        };
    }

    cleanup() {
        console.log('Cleaning up TransactionProcessor...');
        this.activeRequests.clear();
        if (httpAgent) {
            httpAgent.destroy();
        }
    }
}

module.exports = TransactionProcessor;