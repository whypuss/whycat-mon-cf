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

// Step 3: Rename CFSM index.html → dashboard.html (legacy fallback at /dashboard)
console.log('Renaming index.html → dashboard.html...');
const indexHtmlPath = path.join(distDir, 'index.html');
const dashboardHtmlPath = path.join(distDir, 'dashboard.html');
if (fs.existsSync(indexHtmlPath)) {
  fs.renameSync(indexHtmlPath, dashboardHtmlPath);
}

// Step 4: Copy Glassmorphism theme to dist root and dist/themes/glassmorphism/
console.log('Copying Glassmorphism theme to root and themes/glassmorphism/...');
if (fs.existsSync(glassDist)) {
  fs.copySync(glassDist, distDir, { overwrite: true });
  const themeSubDir = path.join(distDir, 'themes', 'glassmorphism');
  fs.ensureDirSync(themeSubDir);
  fs.copySync(glassDist, themeSubDir, { overwrite: true });
  // Also overwrite dashboard.html so even legacy fallbacks render Glassmorphism!
  fs.copyFileSync(path.join(glassDist, 'index.html'), dashboardHtmlPath);
  console.log('Glassmorphism → dist/ (root) + dist/themes/glassmorphism/ + dashboard.html');
} else {
  console.warn('Glassmorphism dist not found! Build it first: cd themes/glassmorphism && bun run build');
}

console.log('Build complete!');