import { OpenClawResponse } from './types'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'

const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'
const OPENCLAW_ENABLED = process.env.OPENCLAW_ENABLED !== 'false'

// Load Gateway token from OpenClaw's local configuration file (~/.openclaw/openclaw.json)
function loadOpenClawToken(): string | undefined {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ((process.env.HOMEDRIVE || '') + (process.env.HOMEPATH || ''))
    if (!homeDir) {
      console.error('[OpenClaw] Cannot determine home directory for config file')
      return undefined
    }

    const configPath = path.join(homeDir, '.openclaw', 'openclaw.json')

    if (!fs.existsSync(configPath)) {
      console.log('[OpenClaw] OpenClaw config file not found at:', configPath)
      return undefined
    }

    const configContent = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(configContent)
    const token = config?.gateway?.auth?.token

    if (!token || typeof token !== 'string') {
      console.log('[OpenClaw] No gateway token found in OpenClaw configuration')
      return undefined
    }

    if (token.length < 20) {
      console.error('[OpenClaw] Invalid gateway token format')
      return undefined
    }

    console.log('[OpenClaw] Successfully loaded Gateway token from OpenClaw configuration')
    return token
  } catch (error) {
    console.error('[OpenClaw] Failed to load configuration:', error instanceof Error ? error.message : String(error))
    return undefined
  }
}

const OPENCLAW_GATEWAY_TOKEN = loadOpenClawToken()

// Use official @openclaw/gateway-client for authenticated WebSocket communication
// Imported dynamically to support ESM modules in Next.js API routes

class OpenClawGatewayClient {
  private gatewayUrl: string
  private token: string | undefined
  private enabled: boolean

  constructor() {
    this.gatewayUrl = OPENCLAW_GATEWAY_URL
    this.token = OPENCLAW_GATEWAY_TOKEN
    this.enabled = OPENCLAW_ENABLED && !!this.token

    if (!this.enabled) {
      console.log('[OpenClaw] Client disabled or unconfigured')
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  async executeAgentRequest(userMessage: string): Promise<OpenClawResponse> {
    if (!this.enabled) {
      return {
        success: false,
        error: 'OpenClaw is not enabled. Configure OPENCLAW_ENABLED, OPENCLAW_GATEWAY_URL, and token in ~/.openclaw/openclaw.json.',
      }
    }

    try {
      console.log('[OpenClaw] Connecting to Gateway using official client')

      const result = await this.sendAgentRequest(userMessage)

      if (result.success) {
        console.log('[OpenClaw] Agent request completed successfully')
        return result
      } else {
        console.error('[OpenClaw] Agent request failed:', result.error)
        return result
      }
    } catch (error) {
      console.error('[OpenClaw] Agent request error:', error)
      return {
        success: false,
        error: 'Failed to communicate with OpenClaw Gateway',
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async sendAgentRequest(userMessage: string): Promise<OpenClawResponse> {
    try {
      // Dynamically import ESM modules
      const [gatewayClientModule, versionModule] = await Promise.all([
        import('@openclaw/gateway-client'),
        import('@openclaw/gateway-protocol/version'),
      ])

      const GatewayClient = gatewayClientModule.GatewayClient
      const PROTOCOL_VERSION = versionModule.PROTOCOL_VERSION

      let client: any = null
      let taskRunId: string | null = null
      let taskCompleted = false
      let taskResult: any = null
      let taskError: string | null = null

      const cleanup = () => {
        if (client) {
          try {
            client.stop()
          } catch (_) {
            // ignore
          }
        }
      }

      // Setup connection promise
      const connected = Promise.withResolvers<void>()
      const taskFinished = Promise.withResolvers<void>()

      // Create official Gateway client
      client = new GatewayClient({
        url: this.gatewayUrl,
        token: this.token,
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        onHelloOk: () => {
          console.log('[OpenClaw] Authentication successful, hello-ok received')
          connected.resolve()
        },
        onConnectError: (error: unknown) => {
          console.error('[OpenClaw] Connect error:', error)
          const errorMsg = error instanceof Error ? error.message : String(error)
          connected.reject(new Error(`Gateway connection error: ${errorMsg}`))
        },
        onEvent: (event: unknown) => {
          if (typeof event === 'object' && event !== null) {
            const eventObj = event as Record<string, unknown>
            const eventType = eventObj.event as string

            // Listen for task completion/result events related to our runId
            if (taskRunId && eventObj.runId === taskRunId) {
              console.log(`[OpenClaw] Event for task ${taskRunId}:`, eventType)

              if (eventType === 'agent.completed' || eventType === 'completed') {
                console.log('[OpenClaw] Agent task completed successfully')
                taskCompleted = true
                taskResult = eventObj.payload || eventObj
                taskFinished.resolve()
                return
              }

              if (eventType === 'agent.failed' || eventType === 'failed') {
                console.error('[OpenClaw] Agent task failed')
                taskError = String(eventObj.error || 'Task failed')
                taskFinished.resolve()
                return
              }

              // Handle clarification/question events
              if (eventType === 'agent.clarification' || eventType === 'agent.question') {
                console.log('[OpenClaw] Agent asking for clarification')
                taskResult = eventObj.payload || eventObj
                taskFinished.resolve()
                return
              }
            }
          }
        },
      })

      // Start the client
      console.log('[OpenClaw] Starting Gateway client')
      client.start()

      // Setup timeout
      const timeout = setTimeout(() => {
        console.error('[OpenClaw] Request timeout')
        taskError = 'Request timeout'
        taskFinished.resolve()
      }, 120000) // 2 minute timeout for task completion

      // Wait for authentication
      await connected.promise

      try {
        console.log('[OpenClaw] Sending agent request')

        // Make agent RPC request
        const response = await client.request('agent', {
          message: userMessage,
          idempotencyKey: randomUUID(),
        })

        // Response should have runId for tracking
        taskRunId = response?.runId
        const status = response?.status

        if (status === 'accepted' && taskRunId) {
          console.log(`[OpenClaw] Agent request accepted with runId: ${taskRunId}`)
          console.log('[OpenClaw] Waiting for agent task completion...')

          // Wait for the actual task to complete (not just acceptance)
          await taskFinished.promise
        } else {
          console.error('[OpenClaw] Unexpected response status:', status)
          taskError = `Unexpected response: ${status}`
        }

        clearTimeout(timeout)

        // Return result based on task outcome
        if (taskError) {
          cleanup()
          return {
            success: false,
            error: taskError,
          }
        }

        if (taskCompleted && taskResult) {
          cleanup()
          return {
            success: true,
            result: {
              type: 'text',
              content: JSON.stringify(taskResult),
              raw_content: taskResult,
            },
          }
        }

        // If we got here without completion, something went wrong
        cleanup()
        return {
          success: false,
          error: 'Task did not complete',
        }
      } catch (error) {
        console.error('[OpenClaw] Agent request failed:', error)
        clearTimeout(timeout)
        cleanup()

        return {
          success: false,
          error: `Agent request failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    } catch (error) {
      console.error('[OpenClaw] Failed to create Gateway client:', error)

      return {
        success: false,
        error: 'Failed to create Gateway client',
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export const openClawClient = new OpenClawGatewayClient()

export async function executeOpenClawAgent(userMessage: string): Promise<OpenClawResponse> {
  return openClawClient.executeAgentRequest(userMessage)
}
