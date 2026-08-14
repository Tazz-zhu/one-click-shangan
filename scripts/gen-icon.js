// Copy icon.jpg to icon.png (Electron uses .png for app icon)
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, 'electron', 'icon.jpg');
const dst = path.join(__dirname, 'electron', 'icon.png');
if (fs.existsSync(src)) {
  fs.copyFileSync(src, dst);
  console.log('✅ icon.png created (256x256)');
} else {
  console.log('⚠️ No icon.jpg found, skipping');
}
