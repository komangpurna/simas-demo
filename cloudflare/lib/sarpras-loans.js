// The availability predicate is embedded in each write so concurrent requests
// cannot both reserve the same capacity after a separate availability check.
export const loanAvailabilityCte = `
    WITH request(loan_type, target_id, start_time, end_time, quantity, exclude_id) AS
        (VALUES (?, ?, ?, ?, ?, ?)),
    overlaps AS (
        SELECT l.*, CASE WHEN l.status = 'borrowed'
            AND substr(l.end_time, 1, 16) < strftime('%Y-%m-%dT%H:%M', 'now', '+8 hours')
            THEN '9999-12-31T23:59' ELSE substr(l.end_time, 1, 16) END AS effective_end
        FROM sarpras_loans l, request r
        WHERE l.loan_type = r.loan_type AND l.id != r.exclude_id
          AND l.status IN ('pending', 'approved', 'borrowed')
          AND ((r.loan_type = 'room' AND l.room_id = r.target_id)
            OR (r.loan_type = 'item' AND l.item_id = r.target_id))
          AND substr(l.start_time, 1, 16) < r.end_time
          AND (substr(l.end_time, 1, 16) > r.start_time OR (l.status = 'borrowed'
            AND substr(l.end_time, 1, 16) < strftime('%Y-%m-%dT%H:%M', 'now', '+8 hours')))
    ),
    points(t) AS (
        SELECT start_time FROM request
        UNION SELECT substr(o.start_time, 1, 16) FROM overlaps o, request r
            WHERE substr(o.start_time, 1, 16) > r.start_time
    ),
    availability AS (
        SELECT CASE WHEN r.loan_type = 'room' THEN
            CASE WHEN EXISTS (SELECT 1 FROM sarpras_rooms WHERE id = r.target_id AND is_active = 1 AND is_peminjaman_enabled = 1)
                 AND NOT EXISTS (SELECT 1 FROM overlaps) THEN 1 ELSE 0 END
        ELSE COALESCE((SELECT qty_good FROM sarpras_inventory_items WHERE id = r.target_id AND is_loanable = 1), 0)
            - COALESCE((SELECT MAX((SELECT COALESCE(SUM(COALESCE(o.quantity, 1)), 0) FROM overlaps o
                WHERE substr(o.start_time, 1, 16) <= p.t AND o.effective_end > p.t))
                FROM points p), 0) END AS available
        FROM request r
    )`;

export function validateSarprasLoan({ loanType, targetId, startTime, endTime, quantity }) {
    const validTime = value => {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
        const date = new Date(value + ':00Z');
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 16) === value;
    };
    if (!['room', 'item'].includes(loanType) || !targetId) return 'Pilih ruangan atau barang yang valid';
    if (!Number.isInteger(quantity) || quantity < 1 || (loanType === 'room' && quantity !== 1)) return 'Jumlah peminjaman tidak valid';
    if (!validTime(startTime) || !validTime(endTime) || startTime >= endTime) return 'Waktu selesai harus setelah waktu mulai';
    return '';
}

export const loanTransitions = {
    pending: { approve: 'approved', reject: 'rejected', cancel: 'cancelled' },
    approved: { borrow: 'borrowed', cancel: 'cancelled' },
    borrowed: { return: 'returned' }
};
