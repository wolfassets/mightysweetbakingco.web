// Vercel serverless entry. Imports the Hono app (which doesn't self-serve when
// VERCEL is set) and exposes it as a Node serverless function. The vercel.json
// rewrite funnels every non-static path here.
import { handle } from 'hono/vercel'
import { app } from '../src/index.js'

export const config = { runtime: 'nodejs' }

export default handle(app)
