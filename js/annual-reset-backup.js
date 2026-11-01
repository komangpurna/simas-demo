// Compatibility is limited to annual-reset artifacts; normal backups pass through unchanged.
const RESET_KEYS = {
    students: 'nis', student_aggregates: 'student_nis', records: 'id', bk_actions: 'id',
    rapor_scores: 'id', permisi_requests: 'id', guru_wali_assignments: 'id', guru_wali_notes: 'id',
    walikelas_notes: 'id', peminatan_responses: 'id', fcm_tokens: 'id', gtk: 'id'
};

export function isAnnualResetBackup(data) {
    return data?._meta?.format === 'annual-reset-v2' || data?._meta?.format === 'annual-reset-legacy';
}

export function normalizeAnnualResetBackup(data) {
    if (!data || typeof data !== 'object' || isAnnualResetBackup(data)) return data;
    const combined = data.metadata?.operation === 'annual_reset_alumni_cleanup' && data.backups;
    const legacy = Array.isArray(data.students) && /Alumni Cleanup|Pra-Kenaikan Kelas/i.test(data._meta?.appName || '');
    if (!combined && !legacy) return data;
    const result = { _meta: { ...(data._meta || {}), appName: data._meta?.appName || "SIMAS - CERDAS (Backup Alumni Lama)",
        format: 'annual-reset-legacy', backupDate: data._meta?.backupDate || data.metadata?.timestamp, totalRecords: 0 } };
    const sources = combined ? Object.values(data.backups) : [data];
    for (const [table, key] of Object.entries(RESET_KEYS)) {
        const rows = new Map();
        for (const source of sources) for (const row of (Array.isArray(source?.[table]) ? source[table] : [])) {
            if (row && row[key] != null) rows.set(String(row[key]), row);
        }
        if (sources.some(source => Array.isArray(source?.[table]))) {
            result[table] = { _count: rows.size, records: Array.from(rows.values()) };
            result._meta.totalRecords += rows.size;
        }
    }
    return result;
}
