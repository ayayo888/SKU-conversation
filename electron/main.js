import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM environment helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// squirrel-startup is a common CJS lib, might need dynamic import or simple check
// For simplicity in ESM, we'll skip the require check or use simple logic if needed.
// In many ESM electron apps, we can ignore this or use a specific ESM-friendly pattern.

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "SKU Generator Pro",
    // icon: path.join(__dirname, 'icon.ico'), // Commented out to avoid crash if icon is missing during test
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, 
      webSecurity: false,
      webviewTag: true // Enable <webview> tag for future features
    },
    autoHideMenuBar: true, 
  });

  const isDev = !app.isPackaged;
  
  if (isDev) {
    // In dev, we assume the vite server is running on port 5173
    mainWindow.loadURL('http://localhost:5173').catch(() => {
        console.log("Vite server not ready, loading file instead...");
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    });
    mainWindow.webContents.openDevTools(); 
  } else {
    // In production, load the built index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});