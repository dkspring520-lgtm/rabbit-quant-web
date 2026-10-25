export function persistLocalLedger(storage,key,rows) {
  if(!key) throw new Error('本机账本尚未就绪');
  storage.setItem(key,JSON.stringify(rows));
  return rows;
}
export function readLocalLedger(storage,key) {
  const saved=storage.getItem(key);
  if(saved===null) return [];
  const rows=JSON.parse(saved);
  if(!Array.isArray(rows)) throw new Error('本机账本格式损坏');
  return rows;
}
