import cfClient from './cloudflare-client.js';
import { MASTER_SARPRAS_API, MASTER_SARPRAS_TABLES, SMSR_SARPRAS_API, SMSR_SARPRAS_TABLES } from './sarpras-storage-contract.mjs';

/** Adapter untuk formulir master aset yang dipertahankan. Seluruh operasi hanya ke Worker/D1. */
export function createMasterSarprasClient(client) {
    const tables = MASTER_SARPRAS_TABLES || SMSR_SARPRAS_TABLES;
    const apiBase = MASTER_SARPRAS_API || '/api/sarpras/master-assets';
    return {
        from(table) {
            if (!Object.hasOwn(tables, table)) throw new Error('Tabel aset sekolah tidak dikenal.');
            let method = 'GET', body, id, order = 'id', ascending = true;
            const query = {
                select() { return query; },
                order(column, options = {}) { order = column; ascending = options.ascending !== false; return query; },
                insert(rows) { method = 'POST'; body = Array.isArray(rows) && rows.length === 1 ? rows[0] : rows; return query; },
                update(row) { method = 'PUT'; body = row; return query; },
                delete() { method = 'DELETE'; return query; },
                eq(column, value) { if (column !== 'id' || !value) throw new Error('ID aset wajib diisi.'); id = value; return query; },
                async then(resolve, reject) {
                    try {
                        if (['PUT', 'DELETE'].includes(method) && !id) throw new Error('Perubahan aset memerlukan ID.');
                        const suffix = id ? '/' + encodeURIComponent(id) : '';
                        const params = method === 'GET' ? '?order=' + encodeURIComponent(order) + '&ascending=' + ascending : '';
                        let result = await client.request(`${apiBase}/${table}${suffix}${params}`, {
                            method, ...(body === undefined ? {} : { body: JSON.stringify(body) })
                        });
                        if (method === 'GET') {
                            let offset = 0;
                            const data = [...result.data];
                            while (result.more) {
                                offset += result.data.length;
                                if (!result.data.length) throw new Error('Halaman aset tidak lengkap.');
                                result = await client.request(apiBase + '/' + table + params + '&offset=' + offset, { method: 'GET' });
                                data.push(...result.data);
                            }
                            return resolve({ data, error: null });
                        }
                        return resolve({ data: result.data, error: null });
                    } catch (error) { return resolve({ data: null, error }); }
                }
            };
            return query;
        }
    };
}
export const sarprasStore = createMasterSarprasClient(cfClient);
export function callSarprasAction(action, payload) {
    const apiBase = MASTER_SARPRAS_API || '/api/sarpras/master-assets';
    return cfClient.request(`${apiBase}/actions/${encodeURIComponent(action)}`, { method: 'POST', body: JSON.stringify(payload) });
}
