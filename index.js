const WebSocketManager = require('./websocket');

// Initialize the WebSocket manager
const wsManager = new WebSocketManager();

// Handle process termination
process.on('SIGINT', () => {
    console.log('Shutting down...');
    wsManager.cleanup();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    wsManager.cleanup();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    wsManager.cleanup();
    process.exit(1);
});