function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export const DEFAULT_ZIJIN_COST_OPTIONS = Object.freeze({
  quantity: 1600,
  commissionPctPerSide: 0.025,
  stampTaxPct: 0.05,
  slippagePctPerSide: 0.02,
  minimumCommissionYuan: 5,
  minimumNetPct: 0.12,
  minimumNetYuan: 30,
  minimumGrossSpreadYuan: 0.10,
});

export function calculateZijinEconomicThreshold(price, options = {}) {
  const merged = { ...DEFAULT_ZIJIN_COST_OPTIONS, ...options };
  const safePrice = Math.max(0.01, finite(price, 0.01));
  const quantity = Math.max(100, Math.floor(finite(merged.quantity, 1600) / 100) * 100);
  const oneSideNotionalYuan = safePrice * quantity;
  const commissionPctPerSide = Math.max(0, finite(merged.commissionPctPerSide));
  const minimumCommissionYuan = Math.max(0, finite(merged.minimumCommissionYuan));
  const commissionYuan = Math.max(
    minimumCommissionYuan,
    oneSideNotionalYuan * commissionPctPerSide / 100,
  );
  const roundTripCostPct = commissionYuan * 2 / oneSideNotionalYuan * 100
    + Math.max(0, finite(merged.stampTaxPct))
    + Math.max(0, finite(merged.slippagePctPerSide)) * 2;
  const minimumNetEdgePct = Math.max(
    Math.max(0, finite(merged.minimumNetPct)),
    Math.max(0, finite(merged.minimumNetYuan)) / oneSideNotionalYuan * 100,
  );
  const minimumGrossSpreadPct = Math.max(0, finite(merged.minimumGrossSpreadYuan)) / safePrice * 100;
  const requiredGrossMovePct = Math.max(
    roundTripCostPct + minimumNetEdgePct,
    minimumGrossSpreadPct,
  );
  return {
    id: "a-share-account-cost-v1",
    mode: "account-dynamic",
    quantity,
    oneSideNotionalYuan,
    commissionPctPerSide,
    minimumCommissionYuan,
    stampTaxPct: Math.max(0, finite(merged.stampTaxPct)),
    slippagePctPerSide: Math.max(0, finite(merged.slippagePctPerSide)),
    roundTripCostPct,
    minimumNetEdgePct,
    minimumGrossSpreadPct,
    requiredGrossMovePct,
  };
}

