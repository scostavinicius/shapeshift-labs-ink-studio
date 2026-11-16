// Development server.   npm run dev [-- --port 5173]
import { startServer } from './server.mjs';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 5173;
const { url } = await startServer({ port });
console.log(`ink-engine dev server: ${url}`);
