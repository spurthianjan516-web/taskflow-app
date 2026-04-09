
const request = require('supertest');
const { app, server } = require('../src/server');

afterAll(done => {
  server.close(done);   // ← no implicit return now
});

describe('Infrastructure Endpoints', () => {

  test('GET / → returns app info', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('app', 'taskflow-app');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('uptime');
  });

  test('GET /health → returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('memory');
  });

  test('GET /ready → returns ready', async () => {
    const res = await request(app).get('/ready');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body).toHaveProperty('tasks');
  });

  test('GET /metrics → returns Prometheus data', async () => {
    const res = await request(app).get('/metrics');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('# HELP taskflow_');
    expect(res.headers['content-type']).toContain('text/plain');
  });

});

describe('Task API', () => {
  let createdTaskId;

  test('GET /tasks → returns task list', async () => {
    const res = await request(app).get('/tasks');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('tasks');
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  test('GET /tasks?status=done → filters by status', async () => {
    const res = await request(app).get('/tasks?status=done');
    expect(res.statusCode).toBe(200);
    res.body.tasks.forEach(task => {
      expect(task.status).toBe('done');
    });
  });

  test('POST /tasks → creates new task', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Test CI Pipeline', priority: 'high' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe('Test CI Pipeline');
    expect(res.body.status).toBe('todo');
    expect(res.body.priority).toBe('high');
    expect(res.body).toHaveProperty('createdAt');
    createdTaskId = res.body.id;   // save for next tests
  });

  test('POST /tasks → 400 when title missing', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ priority: 'low' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /tasks/:id → returns specific task', async () => {
    const res = await request(app).get(`/tasks/${createdTaskId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(createdTaskId);
    expect(res.body.title).toBe('Test CI Pipeline');
  });

  test('PATCH /tasks/:id → updates task status', async () => {
    const res = await request(app)
      .patch(`/tasks/${createdTaskId}`)
      .send({ status: 'active' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body).toHaveProperty('updatedAt');
  });

  test('GET /tasks/:id → 404 for invalid id', async () => {
    const res = await request(app).get('/tasks/nonexistent-id-999');
    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('DELETE /tasks/:id → removes task', async () => {
    const res = await request(app).delete(`/tasks/${createdTaskId}`);
    expect(res.statusCode).toBe(204);
  });

  test('GET /tasks/:id → 404 after deletion', async () => {
    const res = await request(app).get(`/tasks/${createdTaskId}`);
    expect(res.statusCode).toBe(404);
  });

});
