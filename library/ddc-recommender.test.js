describe('Smart DDC recommender', () => {
  beforeAll(() => {
    global.window = {};
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.isolateModules(() => require('./ddc-recommender.js'));
  });

  afterAll(() => {
    console.log.mockRestore();
    delete global.window;
  });

  test('mendahulukan sastra asing daripada pola fiksi umum', () => {
    expect(window.SmartDDC.mapCategoriesToDDC(['English literature'])).toEqual({
      kode: '820',
      nama: 'Sastra Asing (Inggris & Terjemahan)',
    });
    expect(window.SmartDDC.mapCategoriesToDDC(['Novel terjemahan'])).toEqual({
      kode: '820',
      nama: 'Sastra Asing (Inggris & Terjemahan)',
    });
  });

  test('klasifikasi lokal menghasilkan rekomendasi dengan alasan yang terdefinisi', () => {
    const recommendations = window.SmartDDC.classify('Kecerdasan Buatan dan Machine Learning');
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]).toEqual(expect.objectContaining({
      kode: expect.any(String),
      nama: expect.any(String),
      confidence: expect.any(Number),
      reason: expect.any(String),
    }));
  });
});
