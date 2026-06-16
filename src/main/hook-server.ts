import crypto from 'node:crypto'
import http from 'node:http'

export interface HookEvent {
  sessionId: string
  tabId: string
  eventType: string
  body: Record<string, unknown>
}

export class HookServer {
  private server: http.Server | null = null
  private port = 0
  private token = ''

  async start(handler: (event: HookEvent) => void): Promise<void> {
    if (this.server) return
    this.token = crypto.randomUUID()

    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404); res.end(); return
      }
      if (req.headers['x-overwatch-token'] !== this.token) {
        res.writeHead(403); res.end(); return
      }

      const sessionId = String(req.headers['x-overwatch-session-id'] || '')
      const tabId = String(req.headers['x-overwatch-tab-id'] || '')
      const eventType = String(req.headers['x-overwatch-event-type'] || '')

      if (!sessionId || !eventType) {
        res.writeHead(400); res.end(); return
      }

      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
        if (body.length > 512_000) { req.destroy(); return }
      })
      req.on('end', () => {
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(body) } catch {}
        handler({ sessionId, tabId, eventType, body: parsed })
        res.writeHead(200); res.end()
      })
    })

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address()
        if (addr && typeof addr === 'object') this.port = addr.port
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.port = 0
  }

  getPort(): number { return this.port }
  getToken(): string { return this.token }
}
