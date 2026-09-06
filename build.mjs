import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const read = name => readFile(`${root}${name}`, 'utf8');
const stripImports = source => source.replace(/^import[^\n]+;\s*$/gm, '');
const stripExports = source => source.replace(/^export\s+/gm, '');
const [html, css, coreSource, rendererSource, workerSource, appSource] = await Promise.all([
  read('index.html'), read('styles.css'), read('src/core.js'), read('src/renderer.js'), read('src/worker.js'), read('src/app.js')
]);
const core = stripExports(coreSource);
const worker = core + '\n' + stripImports(workerSource);
const embeddedWorker = `const WORKER_URL = URL.createObjectURL(new Blob([${JSON.stringify(worker)}], {type:'text/javascript'}));\n`;
const app = stripImports(appSource).replace("new Worker(new URL('./worker.js',import.meta.url),{type:'module'})", "new Worker(WORKER_URL)");
const code = core + '\n' + stripExports(rendererSource) + '\n' + embeddedWorker + app;
const standalone = html.replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`)
 .replace('<script type="module" src="src/app.js"></script>', () => `<script type="module">\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`);
await mkdir(`${root}dist`, {recursive:true});
await writeFile(`${root}dist/silicore-studio.html`, standalone);
console.log(`Built dependency-free standalone HTML: ${(Buffer.byteLength(standalone)/1024).toFixed(1)} KiB`);
