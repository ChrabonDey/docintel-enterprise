import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createApp } from '../../src/app';
import { getDatabase, closeDatabase } from '../../src/config/database';
import { JobQueue } from '../../src/modules/jobs/queue.service';
import type { Server } from 'node:http';

describe('API Endpoints Integration Tests', () => {
  let server: Server;
  const baseUrl = 'http://127.0.0.1:4099';
  let authToken = '';

  beforeAll(async () => {
    getDatabase();
    JobQueue.init();
    const app = createApp();

    await new Promise<void>((resolve) => {
      server = app.listen(4099, '127.0.0.1', () => {
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    closeDatabase();
  });

  it('GET /api/v1/health should return UP status and database metrics', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('UP');
    expect(json.services.database).toBe('CONNECTED');
    expect(json.services.jobQueue).toBeDefined();
  });

  it('POST /api/v1/auth/register and /login should authenticate user', async () => {
    const registerPayload = {
      username: `apiuser_${Date.now()}`,
      email: `api_${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      role: 'ADMIN',
    };

    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerPayload),
    });
    expect(regRes.status).toBe(201);
    const regJson = await regRes.json();
    expect(regJson.success).toBe(true);
    expect(regJson.data.token).toBeDefined();

    // Login
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernameOrEmail: registerPayload.email,
        password: registerPayload.password,
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginJson = await loginRes.json();
    expect(loginJson.success).toBe(true);
    authToken = loginJson.data.token;
  });

  it('GET /api/v1/documents should return paginated documents list', async () => {
    const res = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.pagination).toBeDefined();
  });

  it('GET /api/v1/search should return keyword and semantic search results', async () => {
    const res = await fetch(`${baseUrl}/api/v1/search?q=Invoice&mode=hybrid`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('GET /api/v1/analytics/metrics should return aggregate system performance', async () => {
    const res = await fetch(`${baseUrl}/api/v1/analytics/metrics`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.overview).toBeDefined();
    expect(json.data.overview.totalDocuments).toBeGreaterThanOrEqual(0);
    expect(json.data.financials).toBeDefined();
  });
});

