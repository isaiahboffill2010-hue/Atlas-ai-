// OpenClaw Gateway integration types

export interface OpenClawToolInput {
  [key: string]: string | number | boolean | unknown
}

export interface OpenClawToolResult {
  type: 'text' | 'image' | 'error'
  content: string
  raw_content?: unknown
}

export interface OpenClawRequest {
  tool: string
  input: OpenClawToolInput
}

export interface OpenClawResponse {
  success: boolean
  result?: OpenClawToolResult
  error?: string
  details?: string
}

export interface BrowserToolInput {
  action: 'search' | 'navigate' | 'screenshot' | 'click' | 'type'
  query?: string
  url?: string
  xpath?: string
  text?: string
}

export interface AtlasToolDefinition {
  name: string
  description: string
  input_schema: {
    type: string
    properties: Record<string, unknown>
    required: string[]
  }
}
