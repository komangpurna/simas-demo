function isDashboardActiveStudent(data = {}) {
  const className = String(data.class || "").trim().toLowerCase();
  const status = String(data.status || "").trim().toLowerCase();
  if (!className) return false;
  const isInactiveClass = ["alumni", "mutasi", "pindah", "keluar", "nonaktif", "non_aktif", "lulus"]
    .some(label => className.includes(label));
  const isInactiveStatus = ["alumni", "mutasi", "pindah", "keluar", "nonaktif", "non_aktif", "lulus"]
    .includes(status);
  return !isInactiveClass && !isInactiveStatus;
}

function getStoredAggregatePoints(data = {}) {
  const candidates = [data.points, data.totalPoints, data.poinPelanggaran]
    .map(value => Number(value))
    .filter(Number.isFinite);
  return Math.max(0, ...(candidates.length ? candidates : [0]));
}

module.exports = {
  getStoredAggregatePoints,
  isDashboardActiveStudent,
};
