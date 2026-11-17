#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const photosDir = path.join(__dirname, '..', 'public', 'assets', 'photos');
const cardsDir = path.join(__dirname, '..', 'public', 'golden', 'img', 'cards');

async function galleryWebp(name) {
  const jpg = path.join(photosDir, name);
  if (!fs.existsSync(jpg)) return;
  const webp = path.join(photosDir, name.replace(/\.jpe?g$/i, '.webp'));
  await sharp(jpg).resize(1600, 1067, { fit: 'cover' }).webp({ quality: 78 }).toFile(webp);
  const cardWebp = path.join(cardsDir, name.replace(/\.jpe?g$/i, '.webp'));
  await sharp(jpg).resize(800, 533, { fit: 'cover' }).webp({ quality: 78 }).toFile(cardWebp);
  console.log('gallery', name);
}

(async () => {
  const jpgs = fs.readdirSync(photosDir).filter(n => /\.jpe?g$/i.test(n));
  for (const name of jpgs.sort()) await galleryWebp(name);
})().catch(err => {
  console.error(err);
  process.exit(1);
});