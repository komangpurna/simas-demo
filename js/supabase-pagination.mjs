export async function fetchAllSupabaseRows(queryPage, options = {}) {
    if (typeof queryPage !== 'function') throw new TypeError('queryPage harus berupa fungsi.');

    const pageSize = Math.min(1000, Math.max(1, Number(options.pageSize) || 500));
    const maxRows = Math.max(pageSize, Number(options.maxRows) || 50000);
    const rows = [];

    while (rows.length < maxRows) {
        const from = rows.length;
        const to = Math.min(from + pageSize - 1, maxRows - 1);
        const { data, error } = await queryPage(from, to);
        if (error) throw error;

        const page = Array.isArray(data) ? data : [];
        rows.push(...page);
        if (page.length < pageSize) return rows;
    }

    throw new Error(`Data melebihi batas aman pemuatan (${maxRows.toLocaleString('id-ID')} baris). Gunakan filter yang lebih spesifik.`);
}
