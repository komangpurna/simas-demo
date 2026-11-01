/**
 * scripts/generate-badge.js
 * Menghasilkan siluet monokrom resmi logo sekolah (assets/badge-sekolah.png)
 * dari assets/logo-sekolah.png sesuai standar Android Notification Small Icon / Badge.
 * Mempertahankan seluruh detail: bingkai bunga teratai, teks SMA NEGERI 1 ABANG,
 * rantai emas, bintang, sayap, obor api, buku, titik, dan teks SMAGESA.
 */

const sharp = require('sharp');
const path = require('node:path');

async function generateBadge() {
    const root = path.resolve(__dirname, '..');
    const sourcePath = path.join(root, 'assets/logo-sekolah.png');
    const targetPath = path.join(root, 'assets/badge-sekolah.png');

    const { data, info } = await sharp(sourcePath).raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const outData = Buffer.alloc(width * height * 4);

    const centerX = width / 2;
    const centerY = height / 2;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];

            if (a < 30) {
                outData[idx] = 255;
                outData[idx + 1] = 255;
                outData[idx + 2] = 255;
                outData[idx + 3] = 0;
                continue;
            }

            const dist = Math.hypot(x - centerX, y - centerY);

            // Warna latar biru gelap di antara bingkai teratai dan lingkaran tengah
            const isDarkBlue = (b > r + 35 && b > g + 35 && r < 100 && g < 100);

            // Warna latar putih pada lingkaran dalam di belakang sayap & obor
            const isInnerWhiteBg = (dist < 145 && r > 210 && g > 210 && b > 210);

            // Garis batas gelap / outline hitam sayap & obor
            const isDarkOutline = (r < 60 && g < 60 && b < 60);

            // Fitur yang dijadikan siluet putih (bingkai teratai, teks, sayap, obor, buku, rantai)
            const isFeature = !(isDarkBlue || isInnerWhiteBg || isDarkOutline);

            outData[idx] = 255;
            outData[idx + 1] = 255;
            outData[idx + 2] = 255;
            outData[idx + 3] = isFeature ? 255 : 0;
        }
    }

    // Resize ke 164x164 dengan interpolasi lanczos3 berkualitas tinggi untuk anti-aliasing halus
    const resized = await sharp(outData, { raw: { width, height, channels: 4 } })
        .resize(164, 164, { kernel: 'lanczos3' })
        .png()
        .toBuffer();

    // Tempelkan di kanvas transparan 192x192 (safe zone padding Android 14px)
    const paddedBuffer = await sharp({
        create: {
            width: 192,
            height: 192,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 0 }
        }
    })
    .composite([{ input: resized, top: 14, left: 14 }])
    .png()
    .toBuffer();

    // Pastikan seluruh RGB bernilai 255 (putih murni) dengan opacity pada channel Alpha
    const { data: pData, info: pInfo } = await sharp(paddedBuffer).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < pData.length; i += 4) {
        pData[i] = 255;
        pData[i + 1] = 255;
        pData[i + 2] = 255;
    }

    await sharp(pData, { raw: { width: pInfo.width, height: pInfo.height, channels: 4 } })
        .png()
        .toFile(targetPath);

    console.log('Berhasil membuat assets/badge-sekolah.png dengan seluruh detail lambang');
}

generateBadge().catch(console.error);
