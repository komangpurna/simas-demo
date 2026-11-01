/**
 * Presensi Guru Completeness Helper Utilities
 * Digunakan untuk menguji dan memvalidasi kalkulasi kelengkapan pengisian presensi guru harian
 */

function isBlockedJPDefault(jpNum, dayOfWeek) {
    if (dayOfWeek === 1 && jpNum === 1) {
        return { blocked: true, reason: 'Upacara Bendera' };
    }
    if (dayOfWeek === 5 && jpNum === 10) {
        return { blocked: true, reason: 'Ekstrakurikuler Wajib' };
    }
    return { blocked: false, reason: '' };
}

function calculateClassCompleteness(kelas, dayOfWeek, jpDataMap = {}, isBlockedJP = isBlockedJPDefault) {
    let savedCount = 0;
    let missingJPs = [];

    for (let i = 1; i <= 10; i++) {
        if (isBlockedJP(i, dayOfWeek).blocked) continue;
        const jpData = jpDataMap[i];
        if (jpData && jpData.guru_nama && jpData.status) {
            savedCount++;
        } else {
            missingJPs.push(i);
        }
    }

    let totalRequiredJP = 10;
    if (dayOfWeek === 1) totalRequiredJP = 9; // Senin JP 1 Upacara
    if (dayOfWeek === 5) totalRequiredJP = 9; // Jumat JP 10 Ekskul

    return {
        kelas,
        savedCount,
        totalRequiredJP,
        missingJPs,
        isComplete: savedCount >= totalRequiredJP
    };
}

function updateCompletenessCache(cache, currentKelas, dayOfWeek, savedJPData = {}, isBlockedJP = isBlockedJPDefault) {
    if (!cache || !Array.isArray(cache) || !currentKelas) {
        return cache;
    }

    const calculated = calculateClassCompleteness(currentKelas, dayOfWeek, savedJPData, isBlockedJP);
    const existingIdx = cache.findIndex(item => item.kelas === currentKelas);

    if (existingIdx !== -1) {
        cache[existingIdx].savedCount = calculated.savedCount;
        cache[existingIdx].missingJPs = calculated.missingJPs;
        cache[existingIdx].isComplete = calculated.isComplete;
        cache[existingIdx].totalRequiredJP = calculated.totalRequiredJP;
    }

    return cache;
}

function getPreviousSchoolDay(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

    let daysToSubtract = 1;
    if (dayOfWeek === 1) {
        // Senin -> Jumat sebelumnya (3 hari ke belakang)
        daysToSubtract = 3;
    } else if (dayOfWeek === 0) {
        // Minggu -> Jumat sebelumnya (2 hari ke belakang)
        daysToSubtract = 2;
    } else if (dayOfWeek === 6) {
        // Sabtu -> Jumat sebelumnya (1 hari ke belakang)
        daysToSubtract = 1;
    }

    date.setDate(date.getDate() - daysToSubtract);
    const prevY = date.getFullYear();
    const prevM = String(date.getMonth() + 1).padStart(2, '0');
    const prevD = String(date.getDate()).padStart(2, '0');
    return `${prevY}-${prevM}-${prevD}`;
}

function formatIndonesianDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function evaluatePreviousDayCompleteness(kelas, prevDateStr, prevRows = [], isBlockedJP = isBlockedJPDefault) {
    if (!prevDateStr) return { isComplete: true };

    const [py, pm, pd] = prevDateStr.split('-').map(Number);
    const prevDate = new Date(py, pm - 1, pd);
    const prevDayOfWeek = prevDate.getDay();

    let totalRequiredJP = 10;
    if (prevDayOfWeek === 1) totalRequiredJP = 9; // Senin JP 1 Upacara
    if (prevDayOfWeek === 5) totalRequiredJP = 9; // Jumat JP 10 Ekskul

    const savedJPs = new Set();
    (prevRows || []).forEach(row => {
        if (row.guru_nama && row.status && !isBlockedJP(row.jp, prevDayOfWeek).blocked) {
            savedJPs.add(row.jp);
        }
    });

    const savedCount = savedJPs.size;
    const missingJPs = [];
    for (let i = 1; i <= 10; i++) {
        if (isBlockedJP(i, prevDayOfWeek).blocked) continue;
        if (!savedJPs.has(i)) {
            missingJPs.push(i);
        }
    }

    return {
        kelas,
        prevDateStr,
        prevDayOfWeek,
        totalRequiredJP,
        savedCount,
        missingJPs,
        isComplete: savedCount >= totalRequiredJP
    };
}

module.exports = {
    isBlockedJPDefault,
    calculateClassCompleteness,
    updateCompletenessCache,
    getPreviousSchoolDay,
    formatIndonesianDate,
    evaluatePreviousDayCompleteness
};
