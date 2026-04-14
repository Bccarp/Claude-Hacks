import { createServer } from './server.js'
import { env } from './env.js'

const { httpServer } = createServer()
httpServer.listen(env.PORT, () => {
  console.log(`proximate server listening on :${env.PORT}`)
})
