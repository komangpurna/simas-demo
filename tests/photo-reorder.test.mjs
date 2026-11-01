/**
 * tests/photo-reorder.test.mjs
 * ====================================================================
 * Test Suite: Pengurutan (Reorder) Foto Bukti Realisasi E-Kinerja
 * Modul: E-Kinerja Guru & E-Kinerja Tendik SIMAS SMAGESA
 * ====================================================================
 */

import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reorderArrayItems } from '../js/utils-photo-dnd.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper ekstraksi extractGoogleDriveFileId & parseEvidencePhotos untuk pengujian parity payload
function extractGoogleDriveFileId(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    const match = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                  trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                  trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
}

function parseEvidencePhotos(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map((item, idx) => {
            if (typeof item === 'string') {
                return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}`, caption: '' };
            }
            if (item && item.url) {
                return {
                    url: item.url,
                    fileId: item.fileId || extractGoogleDriveFileId(item.url),
                    name: item.name || `Foto Bukti ${idx + 1}`,
                    caption: (item.caption || '').trim()
                };
            }
            return null;
        }).filter(Boolean);
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map((item, idx) => {
                        if (typeof item === 'string') {
                            return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}`, caption: '' };
                        }
                        if (item && item.url) {
                            return {
                                url: item.url,
                                fileId: item.fileId || extractGoogleDriveFileId(item.url),
                                name: item.name || `Foto Bukti ${idx + 1}`,
                                caption: (item.caption || '').trim()
                            };
                        }
                        return null;
                    }).filter(Boolean);
                }
            } catch (_) {}
        }
    }
    return [];
}

describe('Suite Reorder Foto Bukti Realisasi E-Kinerja', () => {
    const root = path.resolve(__dirname, '..');
    const bebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');
    const eKinerjaTendikJs = fs.readFileSync(path.join(root, 'js', 'page-e-kinerja-tendik.js'), 'utf8');
    const agendaPegawaiJs = fs.readFileSync(path.join(root, 'js', 'page-agenda-pegawai.js'), 'utf8');
    const utilsPhotoDndMjs = fs.readFileSync(path.join(root, 'js', 'utils-photo-dnd.mjs'), 'utf8');

    // =================================================================
    // 1. INTEGRITAS FUNGSI ARRAY REORDERING
    // =================================================================
    describe('1. reorderArrayItems logic & immutability', () => {
        test('Memindahkan item ke posisi lebih belakang (forward move 0 -> 2)', () => {
            const initial = ['Foto A', 'Foto B', 'Foto C', 'Foto D'];
            const reordered = reorderArrayItems(initial, 0, 2);
            expect(reordered).toEqual(['Foto B', 'Foto C', 'Foto A', 'Foto D']);
            expect(initial).toEqual(['Foto A', 'Foto B', 'Foto C', 'Foto D']);
        });

        test('Memindahkan item ke posisi lebih depan (backward move 3 -> 1)', () => {
            const initial = ['Foto A', 'Foto B', 'Foto C', 'Foto D'];
            const reordered = reorderArrayItems(initial, 3, 1);
            expect(reordered).toEqual(['Foto A', 'Foto D', 'Foto B', 'Foto C']);
        });

        test('Tukar posisi bersebelahan (adjacent swap 1 -> 2)', () => {
            const initial = ['Foto 1', 'Foto 2', 'Foto 3'];
            const reordered = reorderArrayItems(initial, 1, 2);
            expect(reordered).toEqual(['Foto 1', 'Foto 3', 'Foto 2']);
        });

        test('Indeks asal dan tujuan sama tidak mengubah urutan (no-op)', () => {
            const initial = ['Foto 1', 'Foto 2', 'Foto 3'];
            const reordered = reorderArrayItems(initial, 1, 1);
            expect(reordered).toEqual(initial);
        });

        test('Menangani boundary error (indeks negatif atau melebihi panjang array)', () => {
            const initial = ['Foto 1', 'Foto 2'];
            expect(reorderArrayItems(initial, -1, 1)).toEqual(initial);
            expect(reorderArrayItems(initial, 0, 5)).toEqual(initial);
            expect(reorderArrayItems(initial, 10, 0)).toEqual(initial);
            expect(reorderArrayItems(initial, '0', 1)).toEqual(initial);
        });

        test('Menangani array kosong atau 1 item atau non-array', () => {
            expect(reorderArrayItems([], 0, 1)).toEqual([]);
            expect(reorderArrayItems(['Single'], 0, 0)).toEqual(['Single']);
            expect(reorderArrayItems(null, 0, 1)).toEqual([]);
            expect(reorderArrayItems(undefined, 0, 1)).toEqual([]);
        });
    });

    // =================================================================
    // 2. PRESERVASI STATE & SERIALISASI D1 PAYLOAD
    // =================================================================
    describe('2. State preservation & serialization payload', () => {
        const dummyPhotos = [
            { id: 101, url: 'https://drive.google.com/file/d/AAA/view', fileId: 'AAA', caption: 'Foto Pembuka', state: 'ready' },
            { id: 102, url: 'https://drive.google.com/file/d/BBB/view', fileId: 'BBB', caption: 'Kegiatan Inti', state: 'ready' },
            { id: 103, url: 'https://drive.google.com/file/d/CCC/view', fileId: 'CCC', caption: 'Penutupan Kelas', state: 'ready' }
        ];

        test('Memindahkan foto mempertahankan seluruh properti objek secara utuh', () => {
            const reordered = reorderArrayItems(dummyPhotos, 2, 0);

            expect(reordered).toHaveLength(3);
            expect(reordered[0].id).toBe(103);
            expect(reordered[0].caption).toBe('Penutupan Kelas');
            expect(reordered[0].fileId).toBe('CCC');

            expect(reordered[1].id).toBe(101);
            expect(reordered[1].caption).toBe('Foto Pembuka');

            expect(reordered[2].id).toBe(102);
            expect(reordered[2].caption).toBe('Kegiatan Inti');
        });

        test('Serialisasi payload JSON evidence_url mempertahankan urutan baru', () => {
            const reordered = reorderArrayItems(dummyPhotos, 2, 0);
            const payloadArray = reordered.map(p => ({
                url: p.url,
                fileId: p.fileId,
                name: `Foto Bukti`,
                caption: p.caption
            }));
            const jsonString = JSON.stringify(payloadArray);

            const parsedBack = parseEvidencePhotos(jsonString);
            expect(parsedBack).toHaveLength(3);
            expect(parsedBack[0].fileId).toBe('CCC');
            expect(parsedBack[0].caption).toBe('Penutupan Kelas');
            expect(parsedBack[1].fileId).toBe('AAA');
            expect(parsedBack[2].fileId).toBe('BBB');
        });
    });

    // =================================================================
    // 3. INTEGRITAS PENERAPAN PADA HALAMAN & CONTROLLER
    // =================================================================
    describe('3. Integrasi Kode & Aturan UI/UX SIMAS', () => {
        test('utils-photo-dnd.mjs mengekspor setupPhotoGridDragAndDrop dan reorderArrayItems', () => {
            expect(utilsPhotoDndMjs).toContain('export function setupPhotoGridDragAndDrop(');
            expect(utilsPhotoDndMjs).toContain('export function reorderArrayItems(');
            expect(utilsPhotoDndMjs).toContain('pointerdown');
            expect(utilsPhotoDndMjs).toContain('dragstart');
        });

        test('page-beban-kerja.js memiliki fungsi reorderWorkloadPhoto dan handle drag grip', () => {
            expect(bebanKerjaJs).toContain('import { reorderArrayItems, setupPhotoGridDragAndDrop } from \'./utils-photo-dnd.mjs\';');
            expect(bebanKerjaJs).toContain('export function reorderWorkloadPhoto(');
            expect(bebanKerjaJs).toContain('photo-drag-handle');
            expect(bebanKerjaJs).toContain('photo-card-item');
            expect(bebanKerjaJs).toContain('touch-none');
            expect(bebanKerjaJs).toContain('setupPhotoGridDragAndDrop(grid,');
            expect(bebanKerjaJs).toContain('window.workloadReorderPhoto = reorderWorkloadPhoto;');
        });

        test('page-e-kinerja-tendik.js memiliki fungsi reorderActivityPhoto dan handle drag grip', () => {
            expect(eKinerjaTendikJs).toContain('import { reorderArrayItems, setupPhotoGridDragAndDrop } from \'./utils-photo-dnd.mjs\';');
            expect(eKinerjaTendikJs).toContain('export function reorderActivityPhoto(');
            expect(eKinerjaTendikJs).toContain('photo-drag-handle');
            expect(eKinerjaTendikJs).toContain('photo-card-item');
            expect(eKinerjaTendikJs).toContain('touch-none');
            expect(eKinerjaTendikJs).toContain('setupPhotoGridDragAndDrop(grid,');
            expect(eKinerjaTendikJs).toContain('window.reorderActivityPhoto = reorderActivityPhoto;');
        });

        test('page-agenda-pegawai.js memiliki sinkronisasi reorderActivityPhoto', () => {
            expect(agendaPegawaiJs).toContain('import { reorderArrayItems, setupPhotoGridDragAndDrop } from \'./utils-photo-dnd.mjs\';');
            expect(agendaPegawaiJs).toContain('export function reorderActivityPhoto(');
            expect(agendaPegawaiJs).toContain('photo-drag-handle');
            expect(agendaPegawaiJs).toContain('photo-card-item');
            expect(agendaPegawaiJs).toContain('window.reorderActivityPhoto = reorderActivityPhoto;');
        });
    });
});
