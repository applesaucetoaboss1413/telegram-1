const request = require('supertest')
const path = require('path')
const fs = require('fs')
process.env.NODE_ENV = 'test'
const { app } = require('../server')

describe('Faceswap API', () => {
  test('faceswap missing photo → 400', async () => {
    const res = await request(app).post('/faceswap').field('userId', 'u1')
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  test('faceswap missing user → 400', async () => {
    const tmp = path.join(__dirname, 'tmp_photo.jpg')
    fs.writeFileSync(tmp, Buffer.from('x'))
    const res = await request(app).post('/faceswap').attach('swap', tmp)
    expect(res.status).toBe(400)
    fs.unlinkSync(tmp)
  })
})
