export function parseTencentSourceTimestamp(rawTime) {
  if (/^\d{14}$/.test(rawTime)) {
    return `${rawTime.slice(0,4)}-${rawTime.slice(4,6)}-${rawTime.slice(6,8)}T${rawTime.slice(8,10)}:${rawTime.slice(10,12)}:${rawTime.slice(12,14)}+08:00`;
  }
  const hongKong = rawTime.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  return hongKong ? `${hongKong[1]}-${hongKong[2]}-${hongKong[3]}T${hongKong[4]}:${hongKong[5]}:${hongKong[6]}+08:00` : null;
}

export function sinaDomesticReference(fields) {
  const preferred = Number(fields[10]);
  if (Number.isFinite(preferred) && preferred > 0) return preferred;
  const fallback = Number(fields[9]);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

export function isStockRelatedNews({ code, name, title, summary = "" }) {
  const compact = value => String(value ?? "").replace(/[\sＡ]/g, "");
  const body = compact(`${title}${summary}`);
  return Boolean(body && (body.includes(compact(name)) || body.includes(code)));
}
