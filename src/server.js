/**
 * taskflow-app — Production Task Management API
 * Includes: REST API + Health probes + Prometheus metrics
 */

const express    = require('express');
const { v4: uuidv4 } = require('uuid');
const client     = require('prom-client');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ═══════════════════════════════════════════════
// IN-MEMORY TASK STORE (replace with DB in prod)
// ═══════════════════════════════════════════════
let tasks = [
  { id: uuidv4(), title: 'Setup Kubernetes', status: 'done',    priority: 'high' },
  { id: uuidv4(), title: 'Configure Jenkins', status: 'active', priority: 'high' },
  { id: uuidv4(), title: 'Setup Prometheus',  status: 'todo',   priority: 'medium' }
];

// ═══════════════════════════════════════════════
// PROMETHEUS METRICS SETUP
// WHY: Prometheus scrapes /metrics every 15s
//      to monitor our app health & performance
// ═══════════════════════════════════════════════
const register = new client.Registry();

// Default Node.js metrics (CPU, memory, event loop)
client.collectDefaultMetrics({
  register,
  prefix: 'taskflow_'
});

// Custom: track how long each HTTP request takes
const httpDuration = new client.Histogram({
  name:       'taskflow_http_request_duration_seconds',
  help:       'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets:    [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers:  [register]
});

// Custom: count total requests
const httpTotal = new client.Counter({
  name:       'taskflow_http_requests_total',
  help:       'Total HTTP requests count',
  labelNames: ['method', 'route', 'status'],
  registers:  [register]
});

// Custom: count tasks by status
const taskGauge = new client.Gauge({
  name:       'taskflow_tasks_total',
  help:       'Total tasks by status',
  labelNames: ['status'],
  registers:  [register]
});

// Helper to refresh task metrics
function updateTaskMetrics() {
  const counts = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  ['todo', 'active', 'done'].forEach(s => {
    taskGauge.set({ status: s }, counts[s] || 0);
  });
}
updateTaskMetrics();

// ═══════════════════════════════════════════════
// MIDDLEWARE — Track every request
// ═══════════════════════════════════════════════
app.use((req, res, next) => {
  const timer = httpDuration.startTimer();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route:  req.route?.path || req.path,
      status: res.statusCode
    };
    timer(labels);
    httpTotal.inc(labels);
  });
  next();
});

// ═══════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════

// Root
app.get('/', (req, res) => {
  res.json({
    app:         'taskflow-app',
    version:     process.env.APP_VERSION  || '1.0.0',
    environment: process.env.NODE_ENV     || 'development',
    pod:         process.env.POD_NAME     || 'local',
    namespace:   process.env.POD_NAMESPACE|| 'local',
    uptime:      `${Math.floor(process.uptime())}s`
  });
});

// Health probe — Kubernetes liveness check
// WHY: K8s calls this every 20s. If it fails 3x → pod restarts
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Readiness probe — Kubernetes readiness check
// WHY: K8s calls this before sending traffic to pod
//      Pod only gets requests when /ready returns 200
app.get('/ready', (req, res) => {
  res.status(200).json({ status: 'ready', tasks: tasks.length });
});

// Prometheus metrics endpoint
// WHY: Prometheus scrapes this URL every 15s
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── TASK API ──────────────────────────────────

// GET all tasks
app.get('/tasks', (req, res) => {
  const { status } = req.query;
  const result = status
    ? tasks.filter(t => t.status === status)
    : tasks;
  res.json({ count: result.length, tasks: result });
});

// GET single task
app.get('/tasks/:id', (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// POST create task
app.post('/tasks', (req, res) => {
  const { title, priority = 'medium' } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const task = {
    id:        uuidv4(),
    title,
    status:    'todo',
    priority,
    createdAt: new Date().toISOString()
  };
  tasks.push(task);
  updateTaskMetrics();
  res.status(201).json(task);
});

// PATCH update task
app.patch('/tasks/:id', (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  Object.assign(task, req.body, { updatedAt: new Date().toISOString() });
  updateTaskMetrics();
  res.json(task);
});

// DELETE task
app.delete('/tasks/:id', (req, res) => {
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });

  tasks.splice(idx, 1);
  updateTaskMetrics();
  res.status(204).send();
});

// ═══════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════
const server = app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════╗');
  console.log(`║  taskflow-app started on port ${PORT}  ║`);
  console.log(`║  ENV: ${(process.env.NODE_ENV || 'development').padEnd(27)}║`);
  console.log('╚══════════════════════════════════════╝');
});

module.exports = { app, server };
