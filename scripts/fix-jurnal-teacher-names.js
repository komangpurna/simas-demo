// scripts/fix-jurnal-teacher-names.js
// Script to batch update unnormalized / typo teacher names in Firestore jurnal_guru (jurnal-smagesa)

const key = 'AIzaSyCZmLDKtHN3kVdjvhWKKA5DVr8a-xLH4fk';

const canonMap = {
    'Putu widiasih': 'Ni Putu Widiasih, S.Pd',
    'Putu Widiasih, S.Pd.': 'Ni Putu Widiasih, S.Pd',
    'Ran': 'Ni Putu Rani Satya. P, S.Pd',
    'Rani': 'Ni Putu Rani Satya. P, S.Pd',
    'Sriada': 'I Putu Gede Sriada, S.Pd',
    'I Putu Gede Sriada': 'I Putu Gede Sriada, S.Pd',
    'Ni Ketut Ari Jijiv Liani': 'Ni Ketut Ari Jijiv Liani, S.Pd',
    'Emy Permata luciana dewi, S.Pd': 'Emy Permata Luciana Dewi, S.Pd',
    'Emy Permata Luciana Dewi,S.Pd': 'Emy Permata Luciana Dewi, S.Pd',
    'I Ketut Deny Hutama, SEi': 'I Ketut Deny Hutama, SE',
    'I Putu Agustina, S.Pd.': 'I Putu Agustina, S.Pd',
    'I Wayan Putu Adi Wiguna, S. Pd': 'I Wayan Putu Adi Wiguna, S.Pd',
    'I Wayan Putu Sudarmawan, s.Pd.': 'I Wayan Putu Sudarmawan, S.Pd',
    'Lestari Wulandari, S. Pd': 'Lestari Wulandari, S.Pd',
    'Ni Kadek Maryati,S.Pd.,M.Pd.H': 'Ni Kadek Maryati, M.Pd. H',
    'Ni Nyoman Mariati, S.Pd.': 'Ni Nyoman Mariati, S.Pd',
    'Ni Putu Anggi Natalia  Sugita, S.Pd': 'Ni Putu Anggi Natalia Sugita, S.Pd',
    'Venia Nabyla Ainul Putri, S.Pd.': 'Venia Nabyla Ainul Putri, S.Pd'
};

async function runUpdate() {
    console.log('🔄 Memulai pemindaian dan perbaikan nama guru di Firestore jurnal_guru...');
    let pageToken = '';
    let totalScanned = 0;
    let totalUpdated = 0;
    let totalFailed = 0;

    do {
        let url = 'https://firestore.googleapis.com/v1/projects/jurnal-smagesa/databases/(default)/documents/jurnal_guru?key=' + key + '&pageSize=300';
        if (pageToken) url += '&pageToken=' + pageToken;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.documents) break;

        for (const doc of data.documents) {
            totalScanned++;
            const rawGuru = doc.fields?.guru?.stringValue;
            if (rawGuru && canonMap[rawGuru]) {
                const targetName = canonMap[rawGuru];
                const patchUrl = 'https://firestore.googleapis.com/v1/' + doc.name + '?updateMask.fieldPaths=guru&key=' + key;
                try {
                    const patchRes = await fetch(patchUrl, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fields: {
                                guru: { stringValue: targetName }
                            }
                        })
                    });
                    if (patchRes.ok) {
                        totalUpdated++;
                        if (totalUpdated % 25 === 0 || totalUpdated === 1) {
                            console.log(`✅ [${totalUpdated}] Updated: "${rawGuru}" -> "${targetName}" (${doc.name.split('/').pop()})`);
                        }
                    } else {
                        totalFailed++;
                        const errBody = await patchRes.text();
                        console.error(`❌ Gagal update doc ${doc.name}:`, errBody);
                    }
                } catch (err) {
                    totalFailed++;
                    console.error(`❌ Error updating doc ${doc.name}:`, err.message);
                }
            }
        }
        pageToken = data.nextPageToken;
    } while (pageToken);

    console.log('\n========================================');
    console.log(`🎉 Selesai! Total dokumen discan: ${totalScanned}`);
    console.log(`✅ Berhasil diperbarui: ${totalUpdated}`);
    console.log(`❌ Gagal: ${totalFailed}`);
    console.log('========================================\n');
}

runUpdate();
