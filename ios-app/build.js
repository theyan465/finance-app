// Копирует статику сайта в ios-app/www для Capacitor
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..'), dst = path.join(__dirname, 'www');
fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst);
['index.html','config.js','manifest.webmanifest','icon.svg','icon-180.png','icon-192.png','icon-512.png','privacy.html']
  .forEach(f => fs.copyFileSync(path.join(src, f), path.join(dst, f)));
console.log('www готов');
