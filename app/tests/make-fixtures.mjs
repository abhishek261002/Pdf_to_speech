// Generates test PDFs into tests/fixtures:
//  sample.pdf  - real text: heading, paragraphs, hyphenation, running header, page numbers, abbreviations
//  columns.pdf - two-column page
//  scan.pdf    - the same kind of text but as a picture only (needs OCR); made from scan.png (rendered by e2e)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
fs.mkdirSync(dir, { recursive: true })

function wrap(text, font, size, width) {
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const w of words) {
    const t = line ? line + ' ' + w : w
    if (font.widthOfTextAtSize(t, size) > width && line) {
      lines.push(line)
      line = w
    } else line = t
  }
  if (line) lines.push(line)
  return lines
}

const paras = [
  'He is going to Mumbai. Dr. Smith met Mr. Jones there, and they talked about the plan for a long while.',
  'The inter-national community met today to discuss the new agreement in detail; many delegates (including the ones from the north) were present... Was it a success? Nobody could say yet!',
  'In 2024, the group published 3.14 pages of notes, e.g. on voice and sound. They said "this is fine" and left.',
]

{
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  for (let p = 1; p <= 4; p++) {
    const page = pdf.addPage([612, 792])
    page.drawText('The Great Book of Things', { x: 72, y: 760, size: 9, font })
    page.drawText(String(p), { x: 300, y: 30, size: 10, font })
    let y = 700
    if (p === 1) {
      page.drawText('CHAPTER ONE', { x: 72, y, size: 22, font: bold })
      y -= 40
    }
    for (const para of paras) {
      for (const l of wrap(para + ` (page ${p})`, font, 12, 460)) {
        page.drawText(l, { x: 72, y, size: 12, font })
        y -= 16
      }
      y -= 14
    }
  }
  fs.writeFileSync(path.join(dir, 'sample.pdf'), await pdf.save())
}

{
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const page = pdf.addPage([612, 792])
  const left = 'Left column text goes here. It talks about apples and oranges, and how they grow in the warm south during the long summer months. '.repeat(4)
  const right = 'Right column text goes here. It talks about rivers and mountains, and how they shape the land across many thousands of years. '.repeat(4)
  let y = 700
  for (const l of wrap(left, font, 11, 230)) { page.drawText(l, { x: 60, y, size: 11, font }); y -= 14 }
  y = 700
  for (const l of wrap(right, font, 11, 230)) { page.drawText(l, { x: 320, y, size: 11, font }); y -= 14 }
  fs.writeFileSync(path.join(dir, 'columns.pdf'), await pdf.save())
}

if (fs.existsSync(path.join(dir, 'scan.png'))) {
  const pdf = await PDFDocument.create()
  const img = await pdf.embedPng(fs.readFileSync(path.join(dir, 'scan.png')))
  for (let i = 0; i < 2; i++) {
    const page = pdf.addPage([612, 792])
    page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 })
  }
  fs.writeFileSync(path.join(dir, 'scan.pdf'), await pdf.save())
}
console.log('fixtures ready')

// 300 pages of plain text, to check large documents stay responsive
{
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  for (let p = 1; p <= 300; p++) {
    const page = pdf.addPage([612, 792])
    page.drawText('A Long Book', { x: 72, y: 760, size: 9, font })
    page.drawText(String(p), { x: 300, y: 30, size: 10, font })
    let y = 700
    for (let k = 0; k < 3; k++) {
      for (const l of wrap(`Paragraph ${k + 1} on page ${p}. ` + paras[k % 3], font, 12, 460)) {
        page.drawText(l, { x: 72, y, size: 12, font })
        y -= 16
      }
      y -= 14
    }
  }
  fs.writeFileSync(path.join(dir, 'big.pdf'), await pdf.save())
}
