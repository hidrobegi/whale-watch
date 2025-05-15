const WebSocket = require('ws');
const { config, loadWhaleData } = require('./config');
const TransactionProcessor = require('./transaction');

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.isAlive = false;
        this.pingInterval = null;
        this.pongTimeout = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 1000; // Allow many more attempts
        this.baseReconnectDelay = 100;   // Start with 100ms
        this.maxReconnectDelay = 1000;   // Cap at 1 second
        this.subscriptions = new Set();
        this.txProcessor = new TransactionProcessor();
        this.whaleData = loadWhaleData();
        
        // Start connection
        this.connect();
    }

    connect() {
        // Clear any existing connection
        this.cleanup(false);
        
        try {
            console.log(`Attempting connection (attempt ${this.reconnectAttempts + 1})`);
            
            this.ws = new WebSocket(config.WEBSOCKET_ENDPOINT, {
                handshakeTimeout: 10000,
                perMessageDeflate: false,
                headers: {
                    'User-Agent': 'WhaleTracker/1.0'
                }
            });

            this.setupEventListeners();
        } catch (error) {
            console.error('Error creating WebSocket connection:', error);
            this.handleConnectionFailure();
        }
    }

    setupEventListeners() {
        if (!this.ws) return;

        // Connection events
        this.ws.on('open', () => {
            console.log('WebSocket connected successfully');
            this.onOpen();
        });

        this.ws.on('close', (code, reason) => {
            console.log(`WebSocket closed with code ${code}${reason ? ': ' + reason : ''}`);
            this.onClose();
        });

        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.onError(error);
        });

        // Message handling
        this.ws.on('message', this.onMessage.bind(this));
        
        // Heartbeat
        this.ws.on('ping', this.heartbeat.bind(this));
        this.ws.on('pong', this.heartbeat.bind(this));
    }

    onOpen() {
        this.isAlive = true;
        this.reconnectAttempts = 0; // Reset reconnect counter on successful connection
        this.setupHeartbeat();
        this.resubscribeAll();
    }

    onMessage(data) {
        try {
            const wsReceiveTime = Date.now();
            const response = JSON.parse(data);

            if (response.method === 'logsNotification') {
                const { signature, err, logs } = response.params.result.value;
                
                if (!err) {
                    this.txProcessor.queueTransaction(signature, wsReceiveTime, { logs });
                }
            } else if (response.result !== undefined) {
                // Store successful subscriptions
                if (response.result !== undefined && !response.error) {
                    this.subscriptions.add(response.id);
                }
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    }

    onError(error) {
        console.error('WebSocket error occurred:', error);
        // Don't call cleanup here - let the close handler handle it
    }

    onClose() {
        console.log('WebSocket connection closed');
        this.handleConnectionFailure();
    }

    handleConnectionFailure() {
        this.cleanup(false);
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.min(
                this.baseReconnectDelay + (this.reconnectAttempts * 50), // Linear increase of 50ms per attempt
                this.maxReconnectDelay
            );
            
            console.log(`Scheduling reconnection in ${delay}ms`);
            
            this.reconnectTimer = setTimeout(() => {
                this.reconnectAttempts++;
                this.connect();
            }, delay);
        } else {
            console.error('Max reconnection attempts reached. Please check the connection manually.');
            this.cleanup(true);
            process.exit(1);
        }
    }

    heartbeat() {
        this.isAlive = true;
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }

    setupHeartbeat() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        
        this.pingInterval = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            if (!this.isAlive) {
                console.log('Connection dead - no pong received');
                this.ws.terminate();
                return;
            }

            this.isAlive = false;
            this.ws.ping();
            
            // Set pong timeout
            this.pongTimeout = setTimeout(() => {
                console.log('Pong timeout - terminating connection');
                this.ws.terminate();
            }, config.PONG_TIMEOUT);
            
        }, config.PING_INTERVAL);
    }

    resubscribeAll() {
        // Clear existing subscriptions
        this.subscriptions.clear();
        
        // Resubscribe to all whale addresses
        for (const address of this.whaleData.whaleAddresses) {
            this.subscribeToAddress(address);
        }
    }

    subscribeToAddress(address) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('Cannot subscribe - connection not open');
            return;
        }

        const subscribeMsg = {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'logsSubscribe',
            params: [
                { mentions: [address] },
                { commitment: 'confirmed' }
            ]
        };

        try {
            this.ws.send(JSON.stringify(subscribeMsg));
        } catch (error) {
            console.error(`Error subscribing to address ${address}:`, error);
        }
    }

    cleanup(fullCleanup = true) {
        // Clear all timers
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Close WebSocket connection if it exists
        if (this.ws) {
            try {
                this.ws.removeAllListeners();
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.close(1000, 'Cleanup initiated');
                }
                this.ws = null;
            } catch (error) {
                console.error('Error during WebSocket cleanup:', error);
            }
        }

        // Clear subscriptions
        this.subscriptions.clear();

        // Full cleanup also cleans up the transaction processor
        if (fullCleanup && this.txProcessor) {
            this.txProcessor.cleanup();
        }
    }

    // Public method to initiate a clean shutdown
    shutdown() {
        console.log('Initiating clean shutdown...');
        this.cleanup(true);
    }
}

module.exports = WebSocketManager;