import { fetchAllSupabaseRows } from './supabase-pagination.mjs';

describe('Supabase pagination utility', () => {
    test('menggabungkan halaman sampai halaman terakhir', async () => {
        const source = Array.from({ length: 7 }, (_, index) => ({ id: index + 1 }));
        const rows = await fetchAllSupabaseRows(async (from, to) => ({
            data: source.slice(from, to + 1),
            error: null,
        }), { pageSize: 3 });

        expect(rows).toEqual(source);
    });

    test('meneruskan error query', async () => {
        await expect(fetchAllSupabaseRows(async () => ({
            data: null,
            error: new Error('query gagal'),
        }))).rejects.toThrow('query gagal');
    });
});
