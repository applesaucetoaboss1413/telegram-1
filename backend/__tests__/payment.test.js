const request = require('supertest')
process.env.NODE_ENV = 'test'
process.env.PUBLIC_URL = 'https://example.com'
process.env.BOT_TOKEN = '123:test' // Dummy token for Telegraf
const loadApp = (stripeMock) => {
  if (stripeMock) global.__stripe = stripeMock
  process.env.STRIPE_SECRET_KEY = ''
  jest.resetModules()
  const { app } = require('../server')
  return app
}

const app = loadApp()

describe('Payment API', () => {
  test('healthz returns mode and env flags', async () => {
    const res = await request(app).get('/healthz')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('mode')
    expect(res.body).toHaveProperty('env')
  })

  test('create-point-session missing params → 400', async () => {
    const appX = loadApp({ checkout: { sessions: { create: jest.fn() } } })
    const res = await request(appX).post('/create-point-session').send({})
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  test('create-point-session tier not found → 404', async () => {
    const app2 = loadApp({ checkout: { sessions: { create: jest.fn().mockResolvedValue({ id: 'sess_test' }) } } })
    const res = await request(app2).post('/create-point-session').send({ userId: 'u1', tierId: 'nope' })
    expect(res.status).toBe(404)
    expect(res.body).toHaveProperty('error')
  })

  test('create-point-session success with mocked stripe', async () => {
    const app3 = loadApp({ checkout: { sessions: { create: jest.fn().mockResolvedValue({ id: 'sess_123' }) } } })
    const res = await request(app3).post('/create-point-session').send({ userId: 'u1', tierId: 'p60' })
    if (res.status !== 200) console.error('Test failed body:', res.body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'sess_123' })
  })

  test('confirm-point-session missing sessionId → 400', async () => {
    const res = await request(app).post('/confirm-point-session').send({})
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  test('confirm-point-session amount mismatch → 400', async () => {
    const app4 = loadApp({ checkout: { sessions: { retrieve: jest.fn().mockResolvedValue({ id: 'sess_x', payment_status: 'paid', status: 'complete', amount_total: 99999, currency: 'usd', metadata: { userId: 'u2', tierId: 'p60' } }) } } })
    const res = await request(app4).post('/confirm-point-session').send({ sessionId: 'sess_x' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })
})
