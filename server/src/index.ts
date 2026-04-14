import { createServer } from './server.js'
import { env } from './env.js'

const { httpServer, stopTicker } = createServer()
httpServer.listen(env.PORT, () => {
  console.log(`proximate server listening on :${env.PORT}`)
})

function shutdown(signal: string): void {
  console.log(`received ${signal}, shutting down`)
  stopTicker()
  httpServer.close(() => {
    process.exit(0)
  })
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  shutdown('SIGINT')
})
