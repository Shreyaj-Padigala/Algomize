const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const config = require('./config');
const { authenticateToken } = require('./middleware/auth');

// Routes
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const exchangeRouter = require('./routes/exchange');
const marketRouter = require('./routes/market');
const chartRouter = require('./routes/chart');
const strategiesRouter = require('./routes/strategies');
const tradesRouter = require('./routes/trades');
const historyRouter = require('./routes/history');
const createAgentRoutes = require('./routes/agents');
const createAnalysisRoutes = require('./routes/analysis');
const createSessionRoutes = require('./routes/session');
const createDashboardRoutes = require('./routes/dashboard');
const createVoiceRoutes = require('./routes/voice');

// Orchestrator & WebSocket
const Orchestrator = require('./agents/orchestrator');
const BlofinWebSocket = require('./websocket/wsClient');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Initialize orchestrator
const orchestrator = new Orchestrator(io);

// Public routes (no auth required)
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// Protected routes (JWT auth required)
app.use('/api/exchange', authenticateToken, exchangeRouter);
app.use('/api/market', authenticateToken, marketRouter);
app.use('/api/chart', authenticateToken, chartRouter);
app.use('/api/strategies', authenticateToken, strategiesRouter);
app.use('/api/trades', authenticateToken, tradesRouter);
app.use('/api/history', authenticateToken, historyRouter);
app.use('/api/agents', authenticateToken, createAgentRoutes(orchestrator));
app.use('/api/analysis', authenticateToken, createAnalysisRoutes(orchestrator));
app.use('/api/session', authenticateToken, createSessionRoutes(orchestrator));
app.use('/api/dashboard', authenticateToken, createDashboardRoutes(orchestrator));
app.use('/api/voice', authenticateToken, createVoiceRoutes(orchestrator));

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('market:subscribe', () => {
    console.log('Client subscribed to market data');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Initialize BloFin WebSocket for real-time market data
const blofinWs = new BlofinWebSocket(io);
if (config.blofin.apiKey) {
  blofinWs.connect();
  blofinWs.subscribeTicker();
  blofinWs.subscribeCandles('BTC-USDT', '15m');
  blofinWs.subscribeCandles('BTC-USDT', '1h');
  blofinWs.subscribeTrades();
}

// Auto-run database migration on startup, then start server
const { migrate } = require('./db/migrate');
migrate(false).then(() => {
  server.listen(config.port, () => {
    console.log(`Algomize server running on http://localhost:${config.port}`);
    console.log(`API docs: http://localhost:${config.port}/api-docs`);
  });
});

module.exports = { app, server };
