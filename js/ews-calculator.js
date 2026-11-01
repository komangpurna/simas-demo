/* js/ews-calculator.js - Dynamic Early Warning System (EWS) Calculator for SIMAS SMAGESA */

import { SimasDB } from './indexeddb-cache.js';

const DEFAULT_WEIGHTS = {
    weightAttendance: 40, // 40% Ketidakhadiran (Alpa & Izin)
    weightBkPoints: 45,   // 45% Akumulasi Kredit Poin Pelanggaran BK
    weightPermission: 15  // 15% Permisi Meninggalkan Kelas
};
const EWS_CACHE_TTL_MS = 5 * 60 * 1000;

function isValidWeights(value) {
    if (!value || typeof value !== 'object') return false;
    const weights = [value.weightAttendance, value.weightBkPoints, value.weightPermission];
    return weights.every(v => Number.isInteger(v) && v >= 0 && v <= 100)
        && weights.reduce((sum, value) => sum + value, 0) === 100;
}

export const SimasEWS = {
    async getWeights() {
        let cachedWeights = null;
        try {
            cachedWeights = await SimasDB.getMeta('ews_config');
            if (isValidWeights(cachedWeights)
                && Number(cachedWeights._cachedAt || 0) > Date.now() - EWS_CACHE_TTL_MS) {
                return cachedWeights;
            }

            if (window.cfClient && window.cfClient.enabled && typeof window.cfClient.getEwsConfig === 'function') {
                const d1Weights = await window.cfClient.getEwsConfig();
                if (isValidWeights(d1Weights)) {
                    const valueToCache = { ...d1Weights, _cachedAt: Date.now() };
                    await SimasDB.setMeta('ews_config', valueToCache);
                    return valueToCache;
                }
            }

            return isValidWeights(cachedWeights) ? cachedWeights : DEFAULT_WEIGHTS;
        } catch (e) {
            console.warn('[SimasEWS] Gagal memuat bobot D1, memakai cache/default:', e);
            return isValidWeights(cachedWeights) ? cachedWeights : DEFAULT_WEIGHTS;
        }
    },

    calculateStudentRisk(studentData, aggregateData = {}, permissionCount = 0, weights = null) {
        const w = weights || DEFAULT_WEIGHTS;

        const rawAlpa = (aggregateData && (
            aggregateData.attendance?.A ??
            aggregateData.attendance?.alpa ??
            aggregateData.attendance?.alpha ??
            aggregateData.alpa ??
            aggregateData.alpha ??
            aggregateData.totalAlpha ??
            aggregateData.totalAlpa ??
            aggregateData.A
        )) || 0;

        const rawIzin = (aggregateData && (
            aggregateData.attendance?.I ??
            aggregateData.attendance?.izin ??
            aggregateData.izin ??
            aggregateData.totalIzin ??
            aggregateData.I
        )) || 0;

        const alpa = isNaN(Number(rawAlpa)) ? 0 : Math.max(0, Number(rawAlpa));
        const izin = isNaN(Number(rawIzin)) ? 0 : Math.max(0, Number(rawIzin));

        // 1. Skor Ketidakhadiran (Alpa * 25 + Izin * 10, Maksimal 100)
        const absentScore = Math.min(100, (alpa * 25) + (izin * 10));

        // 2. Skor Kredit Poin Pelanggaran BK (Maksimal 100)
        let rawBkPoints = 0;
        if (aggregateData) {
            const raw = aggregateData.totalPoints ?? aggregateData.poinPelanggaran ?? aggregateData.points ?? aggregateData.violationPoints ?? 0;
            rawBkPoints = Number(raw);
        }
        const bkPoints = isNaN(rawBkPoints) ? 0 : Math.max(0, rawBkPoints);
        const bkScore = Math.min(100, bkPoints);

        // 3. Skor Permisi Meninggalkan Kelas (1 Permisi = 15 Poin, Maksimal 100)
        const rawPermisi = permissionCount || 0;
        const permisi = isNaN(Number(rawPermisi)) ? 0 : Math.max(0, Number(rawPermisi));
        const permissionScore = Math.min(100, permisi * 15);

        // 4. Kalkulasi Skor Total Terbobot
        const wAbsen = (w.weightAttendance || 40) / 100;
        const wBk = (w.weightBkPoints || 45) / 100;
        const wPerm = (w.weightPermission || 15) / 100;

        const calcTotal = (wAbsen * absentScore) + (wBk * bkScore) + (wPerm * permissionScore);
        const totalScore = isNaN(calcTotal) ? 0 : Math.round(calcTotal);

        // 5. Penentuan Level Risiko
        let level = 'low'; // 🟢 Aman (< 35)
        let label = 'Aman';
        let colorClass = 'text-emerald-600 bg-emerald-50 border-emerald-200';
        let badgeBg = 'bg-emerald-500';

        if (totalScore >= 65) {
            level = 'high'; // 🔴 Risiko Tinggi (>= 65)
            label = 'Risiko Tinggi';
            colorClass = 'text-rose-600 bg-rose-50 border-rose-200';
            badgeBg = 'bg-rose-500';
        } else if (totalScore >= 35) {
            level = 'medium'; // 🟡 Risiko Sedang (35 - 64)
            label = 'Risiko Sedang';
            colorClass = 'text-amber-600 bg-amber-50 border-amber-200';
            badgeBg = 'bg-amber-500';
        }

        return {
            totalScore,
            level,
            label,
            colorClass,
            badgeBg,
            absentScore,
            bkScore,
            permissionScore,
            details: {
                alpa,
                izin,
                points: bkPoints,
                permisi
            }
        };
    }
};

window.SimasEWS = SimasEWS;
