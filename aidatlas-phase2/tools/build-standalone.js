/* Builds the two self-contained pages users open:
     index.html  ← src/index.html   (landing)
     app.html    ← src/app.html     (map app)
     guide.html  ← src/guide.html   (user guide)
     field.html  ← src/field.html   (field app for phones; works offline with sw.js)
   All local CSS, JS and the sketch SVG are inlined, so each page works on its own from any folder
   (double-click, flattened download, GitHub Pages). Only CDN libraries (Leaflet, KaTeX, LP solver,
   Google Fonts) stay linked. Edit files in src/, js/, css/, assets/ — then run: node tools/build-standalone.js */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const svgUri = 'data:image/svg+xml;base64,' + Buffer.from(read('assets/sketch.svg')).toString('base64');
const css = read('css/aidatlas.css').replace("url('../assets/sketch.svg')", `url('${svgUri}')`);

const build = (srcFile, outFile) => {
  let html = read(srcFile);
  html = html.replace('<link rel="stylesheet" href="../css/aidatlas.css">', () => `<style>\n${css}\n</style>`);
  html = html.replace(/<script src="\.\.\/(js\/[^"]+)"><\/script>/g, (_, p) => `<script>/* ${p} */\n${read(p).replace(/<\/script>/gi, '<\\/script>')}\n</script>`);
  if (/(href|src)="\.\.\//.test(html)) throw new Error(`${srcFile}: unresolved relative reference left after inlining`);
  html = html.replace('<head>', `<head>\n<!-- Built from ${srcFile} by tools/build-standalone.js — edit the sources, not this file. -->`);
  fs.writeFileSync(path.join(ROOT, outFile), html);
  console.log(`${outFile}  ${(html.length / 1024).toFixed(0)} KB`);
};
build('src/index.html', 'index.html');
build('src/app.html', 'app.html');
build('src/guide.html', 'guide.html');
build('src/field.html', 'field.html');
