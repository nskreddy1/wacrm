import { createApp } from "../server/app"
import { loadServerConfig } from "../server/config"

// Vercel invokes the exported Express application as a function. Do not call
// listen() here: Vercel owns the public listener and routes HTTPS requests to it.
const app = createApp(loadServerConfig())

export default app
