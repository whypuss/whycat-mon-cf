#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');
const glassDist = path.join(rootDir, 'themes', 'glassmorphism', 'dist');

console.log('Cleaning dist directory...');
if (fs.existsSync(distDir)) fs.removeSync(distDir);

// Step 1: Build CFSM default frontend
console.log('Building CFSM frontend...');
execSync('npx vite build', { cwd: rootDir, stdio: 'inherit' });

// Step 2: Copy public/ (flags, os-icons, favicon, etc.)
console.log('Copying public assets...');
if (fs.existsSync(publicDir)) {
  fs.copySync(publicDir, distDir, { overwrite: true });
}

// Step 3: Rename CFSM index.html → admin.html (CFSM admin SPA entry)
// Worker 嘅 /admin route 用 files['admin.html'] 嚟 serve CFSM 嘅 management console。
console.log('Renaming index.html → admin.html...');
const indexHtmlPath = path.join(distDir, 'index.html');
const adminHtmlPath = path.join(distDir, 'admin.html');
if (fs.existsSync(indexHtmlPath)) {
  fs.renameSync(indexHtmlPath, adminHtmlPath);
}

// Step 4: Copy Glassmorphism theme to dist root and dist/themes/glassmorphism/
console.log('Copying Glassmorphism theme to root and themes/glassmorphism/...');
if (fs.existsSync(glassDist)) {
  fs.copySync(glassDist, distDir, { overwrite: true });
  const themeSubDir = path.join(distDir, 'themes', 'glassmorphism');
  fs.ensureDirSync(themeSubDir);
  fs.copySync(glassDist, themeSubDir, { overwrite: true });
  console.log('Glassmorphism → dist/ (root) + dist/themes/glassmorphism/');
} else {
  console.warn('Glassmorphism dist not found! Build it first: cd themes/glassmorphism && bun run build');
}

// Step 5: Copy bin/ (agent binaries + install scripts) to dist/download/
// /download/* URLs 直接由 ASSETS 靜態 serve，代理 install 同 upgrade script 都喺度。
console.log('Copying bin/ → dist/download/...');
const binDir = path.join(rootDir, 'bin');
if (fs.existsSync(binDir)) {
  const downloadDir = path.join(distDir, 'download');
  fs.ensureDirSync(downloadDir);
  fs.copySync(binDir, downloadDir, { overwrite: true });
  console.log('bin/ → dist/download/');
} else {
  console.warn('bin/ not found!');
}

console.log('Build complete!');