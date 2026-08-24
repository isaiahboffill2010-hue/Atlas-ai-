const fs = require('fs')
const path = require('path')
const {
  createSquareDeviceCode,
  getSquareDeviceCode,
  getSquareEnvironment,
  getSquareLocationId,
  getStoredPairedDeviceId,
  updateSquarePairing,
} = require('../lib/square')

function loadLocalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return
  }

  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, equalsIndex).trim()
    let value = trimmed.slice(equalsIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!process.env[key] || process.env[key].trim().length === 0) {
      process.env[key] = value
    }
  }
}

function loadSquareEnv() {
  const projectRoot = path.join(__dirname, '..')
  loadLocalEnvFile(path.join(projectRoot, '.env.local'))
  loadLocalEnvFile(path.join(projectRoot, '.env'))
}

loadSquareEnv()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatDateTime(value) {
  if (!value) {
    return 'unknown'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

async function main() {
  const environment = getSquareEnvironment()
  const locationId = getSquareLocationId()

  const existingDeviceId = getStoredPairedDeviceId()
  if (existingDeviceId) {
    console.log('Square Terminal Setup')
    console.log('')
    console.log('A paired Square Terminal is already stored.')
    console.log(`Device ID: ${existingDeviceId}`)
    console.log('')
    console.log('If you want to re-pair the terminal, clear the stored Square state and run this command again.')
    return
  }

  console.log('Square Terminal Setup')
  console.log('')
  console.log(`Environment: ${environment}`)
  console.log(`Location ID: ${locationId}`)
  console.log('')

  const deviceCode = await createSquareDeviceCode({
    name: 'Atlas Front Desk',
    locationId,
  })

  if (!deviceCode || !deviceCode.id || !deviceCode.code) {
    throw new Error('Square did not return a usable device code')
  }

  updateSquarePairing({
    location_id: deviceCode.location_id || locationId,
    device_code_id: deviceCode.id || null,
    device_code: deviceCode.code || null,
    device_name: deviceCode.name || 'Atlas Front Desk',
    status: deviceCode.status || 'UNPAIRED',
    pair_by: deviceCode.pair_by || null,
    created_at: deviceCode.created_at || null,
  })

  console.log(`Pairing code: ${deviceCode.code}`)
  console.log('')
  console.log('Enter this code on your Square Terminal.')
  console.log(`Pair by: ${formatDateTime(deviceCode.pair_by)}`)
  console.log('')
  console.log('Waiting for Terminal to pair...')

  const deadline = deviceCode.pair_by ? new Date(deviceCode.pair_by).getTime() : Date.now() + 10 * 60 * 1000
  const deviceCodeId = deviceCode.id
  const pollIntervalMs = 5000

  while (Date.now() <= deadline + 15000) {
    try {
      const latest = await getSquareDeviceCode(deviceCodeId)
      updateSquarePairing({
        location_id: latest.location_id || locationId,
        device_code_id: latest.id || deviceCodeId,
        device_code: latest.code || deviceCode.code || null,
        device_name: latest.name || 'Atlas Front Desk',
        status: latest.status || null,
        pair_by: latest.pair_by || deviceCode.pair_by || null,
        created_at: latest.created_at || deviceCode.created_at || null,
        device_id: latest.device_id || null,
        paired_at: latest.status === 'PAIRED' ? latest.status_changed_at || new Date().toISOString() : null,
      })

      if (latest.status === 'PAIRED' && latest.device_id) {
        console.log('')
        console.log('✓ Square Terminal connected.')
        console.log(`Device ID: ${latest.device_id}`)
        return
      }

      if (latest.status === 'EXPIRED') {
        console.log('')
        console.log('Square device code expired before pairing completed.')
        console.log('Run npm run square:pair again to generate a new pairing code.')
        process.exitCode = 1
        return
      }
    } catch (error) {
      const status = error && typeof error === 'object' ? error.status : undefined
      if (status === 404) {
        console.log('')
        console.log('Square device code is no longer available.')
        console.log('Run npm run square:pair again to generate a new pairing code.')
        process.exitCode = 1
        return
      }

      console.error('[Square Pair] Polling error:', error)
    }

    await sleep(pollIntervalMs)
  }

  console.log('')
  console.log('Square device code expired before the terminal paired.')
  console.log('Run npm run square:pair again to generate a new pairing code.')
  process.exitCode = 1
}

main().catch((error) => {
  console.error('[Square Pair] Setup failed:', error)
  process.exit(1)
})
