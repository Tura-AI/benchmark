import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = join(process.cwd(), 'public', 'media', 'prompts')
mkdirSync(out, { recursive: true })

const prompts = [207,233,174,301,118,198,142,160,255,189,211,31,276,212,248,156,267,101,290,77,221,63]
const palettes = [
  ['#171712','#c9fa46','#f5f4ef'], ['#28231f','#d8d0bf','#0f0f0d'], ['#725a43','#f0e3d5','#2a211b'],
  ['#1b1b19','#f8f4e8','#c9fa46'], ['#e8ddd2','#996d5c','#1b1714'], ['#f2f0e9','#11110f','#b3e637'],
  ['#d8e0c7','#25331f','#f8f6ed'], ['#151515','#d7dde5','#c9fa46'], ['#100e16','#40548a','#df5677'],
  ['#efe7d8','#3c332a','#c9fa46'], ['#18151f','#f0d577','#d96a78'], ['#f6f0df','#11120f','#a7cf3a'],
]

function svg(id, i) {
  const [a,b,c] = palettes[i % palettes.length]
  const tall = i % 3 === 1
  const w = 900
  const h = tall ? 1200 : (i % 4 === 0 ? 1100 : 780)
  const title = String(id)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Prompt artwork ${id}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .16"/></feComponentTransfer></filter></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" filter="url(#grain)" opacity=".45"/>
<circle cx="${w*.68}" cy="${h*.28}" r="${Math.min(w,h)*.22}" fill="${c}" opacity=".82"/>
<rect x="${w*.12}" y="${h*.18}" width="${w*.5}" height="${h*.54}" rx="${34 + i % 5 * 10}" fill="${c}" opacity=".22"/>
<path d="M${w*.14} ${h*.74} C${w*.35} ${h*.56}, ${w*.52} ${h*.92}, ${w*.86} ${h*.61}" fill="none" stroke="${c}" stroke-width="${18 + i % 6}" opacity=".72" stroke-linecap="round"/>
<g opacity=".92"><rect x="${w*.12}" y="${h*.82}" width="${w*.48}" height="10" rx="5" fill="${c}"/><rect x="${w*.12}" y="${h*.86}" width="${w*.3}" height="10" rx="5" fill="${c}" opacity=".6"/></g>
<text x="${w*.12}" y="${h*.13}" font-family="Arial, sans-serif" font-size="46" font-weight="700" fill="${c}" opacity=".28">${title}</text>
</svg>`
}

prompts.forEach((id, i) => writeFileSync(join(out, `pp${id}.svg`), svg(id, i)))
