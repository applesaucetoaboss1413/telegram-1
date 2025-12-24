const fetch = require('node-fetch')

async function run() {
  const key = process.env.API_MARKET_KEY || process.env.MAGICAPI_KEY
  if (!key) {
    console.error('Missing API_MARKET_KEY/MAGICAPI_KEY in environment')
    process.exit(1)
  }
  const urlAll = 'https://prod.api.market/api/v1/user/usage/'
  const resAll = await fetch(urlAll, { headers: { 'x-magicapi-key': key, 'accept': 'application/json' } })
  const textAll = await resAll.text()
  let jAll
  try { jAll = JSON.parse(textAll) } catch (_) {}
  console.log('Status:', resAll.status)
  console.log('Body:', (textAll || '').substring(0, 500))
  if (resAll.ok && jAll && Array.isArray(jAll.usageData)) {
    const face = jAll.usageData.find(x => String(x.apiName || '').includes('faceswap'))
    if (face) {
      console.log('Faceswap quota:', face.quota, 'left:', face.apiCallsLeft, 'made:', face.apiCallsMade)
    }
  }
}

run().catch(e => { console.error(e.message); process.exit(1) })
