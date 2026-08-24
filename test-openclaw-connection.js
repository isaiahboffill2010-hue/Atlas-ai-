// Test script to verify OpenClaw Gateway connection using official @openclaw/gateway-client
// Run with: node test-openclaw-connection.js

const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { GatewayClient } = require('@openclaw/gateway-client')
const { PROTOCOL_VERSION } = require('@openclaw/gateway-protocol/version')

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'

// Load token from OpenClaw configuration (~/.openclaw/openclaw.json)
let GATEWAY_TOKEN = null
try {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ((process.env.HOMEDRIVE || '') + (process.env.HOMEPATH || ''))
  const configPath = path.join(homeDir, '.openclaw', 'openclaw.json')

  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    GATEWAY_TOKEN = config?.gateway?.auth?.token
  }
} catch (error) {
  // ignore
}

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', '@openclaw', 'gateway-client', 'package.json'), 'utf-8'))

console.log('[Test] OpenClaw Gateway Connection Test')
console.log('[Test] ================================')
console.log(`[Test] Gateway URL: ${GATEWAY_URL}`)
console.log(`[Test] Using official @openclaw/gateway-client`)
console.log(`[Test] Package version: ${packageJson.version}`)
console.log(`[Test] Protocol version: ${PROTOCOL_VERSION}`)
console.log(`[Test] Token loaded from OpenClaw config: ${!!GATEWAY_TOKEN}`)
console.log('')

if (!GATEWAY_TOKEN) {
  console.error('[Test] ERROR: Could not load OPENCLAW_GATEWAY_TOKEN from ~/.openclaw/openclaw.json')
  process.exit(1)
}

const testResults = {
  handshakeSuccess: false,
  authenticationSuccess: false,
  agentRequestSuccess: false,
  resultReceived: false,
  packageUsed: '@openclaw/gateway-client',
  packageVersion: packageJson.version,
}

let client = null

try {
  const connected = Promise.withResolvers()

  // Create official Gateway client
  console.log('[Test] Creating Gateway client...')
  client = new GatewayClient({
    url: GATEWAY_URL,
    token: GATEWAY_TOKEN,
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    onHelloOk: () => {
      console.log('[Test] ✅ hello-ok received - authentication successful')
      testResults.handshakeSuccess = true
      testResults.authenticationSuccess = true
      connected.resolve()
    },
    onConnectError: (error) => {
      console.error('[Test] ❌ Connect error:', error)
      connected.reject(error)
    },
    onEvent: (event) => {
      if (event?.event) {
        console.log('[Test] Event:', event.event)
      }
    },
  })

  // Start the client
  console.log('[Test] Starting Gateway client...')
  client.start()

  // Wait for authentication, then send agent request
  connected.promise
    .then(async () => {
      try {
        console.log('[Test] → Sending agent request: "Open Google and search for Atlas Printers"')

        // Make agent RPC request
        const response = await client.request('agent', {
          message: 'Open Google and search for Atlas Printers.',
          idempotencyKey: randomUUID(),
        })

        console.log('[Test] ✅ Agent request successful')
        testResults.agentRequestSuccess = true
        testResults.resultReceived = true

        if (response) {
          const responseStr = JSON.stringify(response).substring(0, 300)
          console.log(`[Test] Result preview: ${responseStr}...`)
        }

        client.stop()
        reportResults()
        process.exit(0)
      } catch (error) {
        console.error('[Test] ❌ Agent request failed:', error?.message || String(error))
        testResults.agentRequestSuccess = false
        if (client) client.stop()
        reportResults()
        process.exit(1)
      }
    })
    .catch((error) => {
      console.error('[Test] ❌ Authentication failed:', error?.message || String(error))
      testResults.authenticationSuccess = false
      if (client) client.stop()
      reportResults()
      process.exit(1)
    })

  // Timeout after 60 seconds
  setTimeout(() => {
    console.error('[Test] ERROR: Connection timeout')
    if (client) client.stop()
    reportResults()
    process.exit(1)
  }, 60000)
} catch (error) {
  console.error('[Test] ERROR: Failed to create Gateway client:', error?.message || String(error))
  if (client) client.stop()
  reportResults()
  process.exit(1)
}

function reportResults() {
  console.log('')
  console.log('[Test] Test Results')
  console.log('[Test] ================================')
  console.log(`[Test] Package: ${testResults.packageUsed}`)
  console.log(`[Test] Version: ${testResults.packageVersion}`)
  console.log(`[Test] Handshake (WebSocket):      ${testResults.handshakeSuccess ? '✅' : '❌'}`)
  console.log(`[Test] Authentication (hello-ok): ${testResults.authenticationSuccess ? '✅' : '❌'}`)
  console.log(`[Test] Agent request:             ${testResults.agentRequestSuccess ? '✅' : '❌'}`)
  console.log(`[Test] Result received:           ${testResults.resultReceived ? '✅' : '❌'}`)

  const allPassed =
    testResults.handshakeSuccess && testResults.authenticationSuccess && testResults.agentRequestSuccess && testResults.resultReceived

  console.log('')
  if (allPassed) {
    console.log('[Test] ✅ ALL TESTS PASSED - OpenClaw Gateway integration working!')
  } else {
    console.log('[Test] ❌ SOME TESTS FAILED - See details above')
  }
}
