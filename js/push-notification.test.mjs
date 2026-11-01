/**
 * js/push-notification.test.mjs
 * Unit Test untuk logika utilitas push notification SIMAS
 */

function buildTargetRedirectUrl(rawUrl, baseUrl = "https://smagesa.web.app") {
  if (!rawUrl) return baseUrl;
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    return rawUrl;
  }
  const cleanPath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  return `${baseUrl}${cleanPath}`;
}

function parseNotificationTopic(role) {
  const normalized = String(role || "").toLowerCase().trim();
  const validTopics = ["all", "siswa", "guru_mapel", "wali_kelas", "kepala_sekolah", "staff", "super_admin"];
  if (validTopics.includes(normalized)) {
    return `topic_${normalized}`;
  }
  return "topic_all";
}

describe("Pengujian Unit Push Notification Helpers", () => {
  describe("buildTargetRedirectUrl", () => {
    test("menghasilkan URL absolut lengkap dari path relatif", () => {
      expect(buildTargetRedirectUrl("/agenda.html")).toBe("https://smagesa.web.app/agenda.html");
      expect(buildTargetRedirectUrl("agenda.html")).toBe("https://smagesa.web.app/agenda.html");
    });

    test("mempertahankan URL absolut asli jika sudah berawalan https://", () => {
      const fullUrl = "https://smagesa.web.app/dashboard";
      expect(buildTargetRedirectUrl(fullUrl)).toBe(fullUrl);
    });

    test("mengembalikan base URL default jika rawUrl kosong atau null", () => {
      expect(buildTargetRedirectUrl(null)).toBe("https://smagesa.web.app");
      expect(buildTargetRedirectUrl("")).toBe("https://smagesa.web.app");
    });
  });

  describe("parseNotificationTopic", () => {
    test("memetakan role pengguna ke nama topic FCM yang valid", () => {
      expect(parseNotificationTopic("guru_mapel")).toBe("topic_guru_mapel");
      expect(parseNotificationTopic("siswa")).toBe("topic_siswa");
      expect(parseNotificationTopic("wali_kelas")).toBe("topic_wali_kelas");
    });

    test("menggunakan fallback topic_all jika role tidak dikenal", () => {
      expect(parseNotificationTopic("unknown_role")).toBe("topic_all");
      expect(parseNotificationTopic(null)).toBe("topic_all");
    });
  });
});
