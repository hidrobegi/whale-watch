const https = require('https');
const EventEmitter = require('events');
const { config } = require('./config');

class MoralisService extends EventEmitter {
    constructor() {
        super();
        
        this.rateLimiter = {
            tokens: 1500,
            lastRefill: Date.now(),
            refillRate: 1500,
            maxConcurrent: 10
        };

        this.agent = new https.Agent({
            keepAlive: true,
            maxSockets: this.rateLimiter.maxConcurrent,
            timeout: 5000
        });
    }

    async acquireToken(cost = 1) {
        const now = Date.now();
        const timePassed = (now - this.rateLimiter.lastRefill) / 1000;
        this.rateLimiter.tokens = Math.min(1500, this.rateLimiter.tokens + timePassed * this.rateLimiter.refillRate);
        this.rateLimiter.lastRefill = now;

        if (this.rateLimiter.tokens < cost) {
            const waitTime = ((cost - this.rateLimiter.tokens) / this.rateLimiter.refillRate) * 1000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.acquireToken(cost);
        }

        this.rateLimiter.tokens -= cost;
        return true;
    }
	
	async fetchWithTimeout(url, options, timeout = 5000) {
		return new Promise((resolve, reject) => {
			// Create the request first
			const req = https.request(url, {
				...options,
				agent: this.agent,
				timeout: timeout
			});

			// Then set up the timeout
			const timer = setTimeout(() => {
				req.destroy();
				reject(new Error('Request timeout'));
			}, timeout);

			// Set up response handling
			req.on('response', (res) => {
				const chunks = [];

				res.on('data', chunk => chunks.push(chunk));
				res.on('end', () => {
					clearTimeout(timer);
					if (res.statusCode !== 200) {
						reject(new Error(`API Error ${res.statusCode}`));
						return;
					}

					try {
						resolve(JSON.parse(Buffer.concat(chunks)));
					} catch {
						reject(new Error('Invalid JSON'));
					}
				});
			});

			req.on('error', (error) => {
				clearTimeout(timer);
				reject(error);
			});

			req.end();
		});
	}
    
    fixIPFSUrl(url) {
        if (!url) return null;
        
        // Handle IPFS URLs
        if (url.startsWith('ipfs://')) {
            return url.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }

        // Handle direct CID URLs
        if (url.startsWith('Qm') || url.startsWith('baf')) {
            return `https://ipfs.io/ipfs/${url}`;
        }

        // Handle cf-ipfs.com URLs
        if (url.includes('cf-ipfs.com')) {
            const ipfsPath = url.split('/ipfs/')[1];
            if (ipfsPath) {
                return `https://ipfs.io/ipfs/${ipfsPath}`;
            }
        }

        return url;
    }

    async fetchExtendedMetadata(metadataUri) {
        if (!metadataUri) return null;

        try {
            const fixedUri = this.fixIPFSUrl(metadataUri);
            if (!fixedUri) return null;

            const extendedMetadata = await this.fetchWithTimeout(
                fixedUri,
                { method: 'GET' },
                5000
            );

            if (extendedMetadata?.image) {
                extendedMetadata.image = this.fixIPFSUrl(extendedMetadata.image);
            }

            return {
                image: extendedMetadata?.image || null,
                description: extendedMetadata?.description || ''
            };
        } catch (error) {
            console.log(`Extended metadata fetch error: ${error.message}`);
            return null;
        }
    }

    async getTokenMetadata(mint) {
        try {
            await this.acquireToken();
            
            const options = {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    'X-API-Key': config.MORALIS_API_KEY
                }
            };

            const metadata = await this.fetchWithTimeout(
                `https://solana-gateway.moralis.io/token/mainnet/${mint}/metadata`,
                options,
                5000
            );

            if (metadata?.metaplex?.metadataUri) {
                const extended = await this.fetchExtendedMetadata(metadata.metaplex.metadataUri);
                metadata.extendedMetadata = extended || {
                    image: null,
                    description: ''
                };
            } else {
                metadata.extendedMetadata = {
                    image: null,
                    description: ''
                };
            }

            return metadata;
        } catch (error) {
            console.error(`Metadata fetch error for ${mint}:`, error.message);
            return null;
        }
    }

    async getMarketStats(mint) {
        try {
            await this.acquireToken();
            
            const options = {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    'X-API-Key': config.MORALIS_API_KEY
                }
            };

            const stats = await this.fetchWithTimeout(
                `https://solana-gateway.moralis.io/token/mainnet/${mint}/pairs/stats`,
                options,
                5000
            );

            if (!stats) return null;

            stats.netflow = {
                '1h': (stats.totalBuyVolume?.['1h'] || 0) - (stats.totalSellVolume?.['1h'] || 0)
            };

            return stats;
        } catch (error) {
            console.error(`Market stats fetch error for ${mint}:`, error.message);
            return null;
        }
    }

    async getTokenData(mint) {
        try {
            const [metadata, marketStats] = await Promise.all([
                this.getTokenMetadata(mint),
                this.getMarketStats(mint)
            ]);

            if (!metadata) return null;

            return {
                mint,
                name: metadata?.name,
                symbol: metadata?.symbol,
                marketCap: metadata?.fullyDilutedValue,
                volume1h: marketStats?.totalVolume?.['1h'],
                netflow1h: marketStats?.netflow?.['1h'],
                image: metadata?.extendedMetadata?.image,
                description: metadata?.extendedMetadata?.description
            };
        } catch (error) {
            console.error(`Error getting token data for ${mint}:`, error.message);
            return null;
        }
    }

    async getTokensData(mints) {
        try {
            const uniqueMints = [...new Set(mints)];
            const results = await Promise.all(
                uniqueMints.map(mint => 
                    this.getTokenData(mint).catch(() => null)
                )
            );
            
            return results.filter(result => result !== null);
        } catch (error) {
            console.error('Error getting tokens data:', error.message);
            return [];
        }
    }

    cleanup() {
        this.removeAllListeners();
        if (this.agent) {
            this.agent.destroy();
        }
    }
}

module.exports = new MoralisService();