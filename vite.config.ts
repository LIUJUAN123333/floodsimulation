import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import cesium from 'vite-plugin-cesium';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function sendJson(response: any, statusCode: number, body: Record<string, unknown>) {
  if (response.writableEnded || response.destroyed) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function readRequestJson(request: any) {
  return new Promise<any>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('error', reject);
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('请求内容不是有效 JSON。'));
      }
    });
  });
}

function meshLocalApi() {
  return {
    name: 'mesh-local-api',
    configureServer(server: any) {
      server.middlewares.use('/api/mesh-index', async (request: any, response: any, next: any) => {
        if (request.method !== 'POST') return next();
        try {
          const { folder } = await readRequestJson(request);
          const indexPath = path.resolve(String(folder || ''), 'index.json');
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf8').replace(/^\uFEFF/, ''));
          if (!Array.isArray(index.frames) || !index.frames.length) {
            throw new Error('index.json 中没有 frames 索引。');
          }
          const frames = index.frames.map(({ name, index, pointCount, triangleCount, stats }: any) => ({
            name: path.basename(name),
            index,
            pointCount,
            triangleCount,
            stats
          }));
          sendJson(response, 200, { success: true, folder: path.dirname(indexPath), frames });
        } catch (error) {
          sendJson(response, 400, { success: false, error: `无法读取 index.json：${error instanceof Error ? error.message : String(error)}` });
        }
      });

      server.middlewares.use('/api/mesh-frame', (request: any, response: any, next: any) => {
        if (request.method !== 'GET') return next();
        try {
          const query = new URL(request.url || '', 'http://localhost').searchParams;
          const folder = path.resolve(query.get('folder') || '');
          const name = path.basename(query.get('name') || '');
          if (!name.endsWith('.mesh.json')) throw new Error('无效的 Mesh 文件名。');
          const filePath = path.resolve(folder, name);
          if (!filePath.startsWith(`${folder}${path.sep}`)) throw new Error('无效的 Mesh 路径。');
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
        } catch (error) {
          sendJson(response, 404, { success: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/api/select-folder', (request: any, response: any, next: any) => {
        if (request.method !== 'POST') return next();
        const command = [
          'Add-Type -AssemblyName System.Windows.Forms',
          'Add-Type -AssemblyName System.Drawing',
          '$owner = New-Object System.Windows.Forms.Form',
          '$owner.TopMost = $true',
          '$owner.ShowInTaskbar = $false',
          '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
          '$owner.Size = New-Object System.Drawing.Size(1, 1)',
          '$owner.Opacity = 0.01',
          '$owner.Show()',
          '$owner.Activate()',
          '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
          "$dialog.Description = '选择文件夹'",
          '$dialog.ShowNewFolderButton = $true',
          '$result = $dialog.ShowDialog($owner)',
          '$owner.Close()',
          '$owner.Dispose()',
          'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath }'
        ].join('; ');
        const picker = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', command], { windowsHide: false });
        let selectedPath = '';
        let errors = '';
        picker.stdout.on('data', (chunk) => { selectedPath += chunk.toString(); });
        picker.stderr.on('data', (chunk) => { errors += chunk.toString(); });
        picker.once('error', (error) => sendJson(response, 500, { success: false, error: error.message }));
        picker.on('close', (code) => {
          if (code !== 0) {
            sendJson(response, 500, { success: false, error: errors || '无法打开文件夹选择窗口。' });
          } else {
            sendJson(response, 200, { success: true, path: selectedPath.trim() });
          }
        });
      });

      server.middlewares.use('/api/build-mesh', async (request: any, response: any, next: any) => {
        if (request.method !== 'POST') return next();
        try {
          const payload = await readRequestJson(request);
          const sourceDir = path.resolve(String(payload.sourceDir || ''));
          const outputDir = path.resolve(String(payload.outputDir || ''));
          if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
            throw new Error(`JSON 源文件夹不存在：${sourceDir}`);
          }
          fs.mkdirSync(outputDir, { recursive: true });
          const script = path.resolve(process.cwd(), 'backend', 'build-mesh-cache.cjs');
          const task = spawn(process.execPath, [script, sourceDir, outputDir], {
            cwd: process.cwd(),
            env: { ...process.env, MESH_WORKERS: '4' },
            windowsHide: true
          });
          let output = '';
          task.stdout.on('data', (chunk) => { output += chunk.toString(); });
          task.stderr.on('data', (chunk) => { output += chunk.toString(); });
          task.once('error', (error) => sendJson(response, 500, { success: false, error: error.message }));
          task.on('close', (code) => {
            if (code === 0) {
              sendJson(response, 200, { success: true, message: 'Mesh 转换完成。', output });
            } else {
              sendJson(response, 500, { success: false, error: output || `转换进程退出，代码：${code}` });
            }
          });
        } catch (error) {
          sendJson(response, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), cesium(), meshLocalApi()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true,
    proxy: {
      '/py-api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/py-api/, '')
      },
      '/api': {
        target: 'http://localhost:18080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/external-sim': {
        target: 'http://localhost:18080',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/external-sim/, '')
      }
    }
  }
});
