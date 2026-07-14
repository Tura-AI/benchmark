import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MarketplaceDb } from '../src/data/db.server'

const path = join(process.cwd(), 'data/powerprompt.sqlite')
if (process.argv.includes('--fresh') && existsSync(path)) unlinkSync(path)
const db = new MarketplaceDb(path)
const count = (db.db.prepare('SELECT COUNT(*) n FROM prompts').get() as { n: number }).n
console.log(`POWERPROMPT database ready: ${count} prompts at ${path}`)
db.close()
