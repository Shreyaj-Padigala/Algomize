const request = require('supertest');
const express = require('express');
const healthRouter = require('../src/routes/health');

const app = express();
app.use('/health', healthRouter);

describe('Health Route', () => {
  it('GET /health should return status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
  });
});
