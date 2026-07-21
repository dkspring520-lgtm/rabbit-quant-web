export function normalizeStockName(value) {
  return String(value ?? "").replace(/[\s　]+/g, "").trim();
}

export function resolveStockIdentity(universe, input = {}) {
  const inputCode = String(input.code ?? "").replace(/\D/g, "").slice(0, 6);
  const inputName = String(input.name ?? "").trim();
  const normalizedName = normalizeStockName(inputName);
  const byCode = universe.find(item => item.code === inputCode) ?? null;
  const nameMatches = normalizedName
    ? universe.filter(item => normalizeStockName(item.name) === normalizedName)
    : [];
  const byName = nameMatches.length === 1 ? nameMatches[0] : null;

  if (byCode && (!byName || byName.code === byCode.code)) {
    return { inputCode, inputName, code: byCode.code, name: byCode.name, status: "valid", reason: "代码与证券名称已核验" };
  }
  if (byName) {
    return {
      inputCode,
      inputName,
      code: byName.code,
      name: byName.name,
      status: "corrected",
      reason: byCode ? `代码对应“${byCode.name}”，已按证券名称修正` : "原代码不在A股证券库，已按证券名称修正",
    };
  }
  if (byCode) {
    return { inputCode, inputName, code: byCode.code, name: byCode.name, status: "corrected", reason: "已按证券代码修正名称" };
  }
  return { inputCode, inputName, code: inputCode, name: inputName, status: "unknown", reason: "代码和名称均未在A股证券库中匹配" };
}

export function resolveStockIdentities(universe, inputs = []) {
  return inputs.slice(0, 30).map(input => resolveStockIdentity(universe, input));
}
