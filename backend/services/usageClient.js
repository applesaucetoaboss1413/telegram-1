const fetch = require('node-fetch')

async function getUsageFor(storeSlug, productSlug, key) {
  const url = `https://prod.api.market/api/v1/user/usage/${storeSlug}/${productSlug}/`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-magicapi-key': key,
      'accept': 'application/json'
    }
  })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } }
  catch (_) { return { ok: res.ok, status: res.status, raw: text } }
}

async function getAllUsage(key) {
  const url = `https://prod.api.market/api/v1/user/usage/`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-magicapi-key': key,
      'accept': 'application/json'
    }
  })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } }
  catch (_) { return { ok: res.ok, status: res.status, raw: text } }
}

module.exports = { getUsageFor, getAllUsage }
