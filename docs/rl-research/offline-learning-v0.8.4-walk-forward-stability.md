# Offline Learning V0.8.4 Walk-Forward OOS Stability Validation

Policy replay uses the 30 observed-bar Ridge model. The V0.8.3 horizon selection remains `10=Ridge`, `30=Ridge`, `60=Mean`; only the 30-bar Ridge model is used for policy replay. Margin selection is validation-only.

The dataset contains 249,917 states. The fixed final test contains 30,848 bars, of which 30,788 are evaluable and 60 are `OUTCOME_UNRESOLVED` because the 60-bar outcome window is incomplete.

## Base-cost OOS results

| Window | Policy | Net Return | Gross Return | Max Drawdown | Profit Factor | Win Rate | Trades | Turnover | Avg Return/Trade | MAE | MFE |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| W1 | AlwaysWait | 0.0000 | 0.0000 | 0.0000 | 0 | 0.0000 | 0 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| W1 | LegacyOHLC | -0.8114 | -0.7992 | 0.1371 | 0.8905 | 0.3158 | 57 | 27.1009 | -0.0142 | 0.0083 | 0.0080 |
| W1 | Oracle | 15.5231 | 15.6357 | 0.0584 | 4.1850 | 0.5776 | 277 | 250.1604 | 0.0560 | 0.0038 | 0.0060 |
| W1 | MLValue | -1.9944 | -1.9870 | 0.1470 | 0.7431 | 0.3261 | 46 | 16.4283 | -0.0434 | 0.0081 | 0.0107 |
| W2 | AlwaysWait | 0.0000 | 0.0000 | 0.0000 | 0 | 0.0000 | 0 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| W2 | LegacyOHLC | 12.5735 | 12.5934 | 0.1169 | 0.5979 | 0.2921 | 89 | 44.2059 | 0.1413 | 0.0106 | 0.0082 |
| W2 | Oracle | 49.3789 | 49.5193 | 0.1163 | 6.5468 | 0.6280 | 336 | 312.0409 | 0.1470 | 0.0037 | 0.0055 |
| W2 | MLValue | 11.3511 | 11.3625 | 0.0896 | 1.0001 | 0.3729 | 59 | 25.3088 | 0.1924 | 0.0080 | 0.0067 |
| W3 | AlwaysWait | 0.0000 | 0.0000 | 0.0000 | 0 | 0.0000 | 0 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| W3 | LegacyOHLC | 1.1361 | 1.1652 | 0.2561 | 1.0265 | 0.4104 | 134 | 64.7005 | 0.0085 | 0.0086 | 0.0090 |
| W3 | Oracle | 42.0682 | 42.2579 | 0.1314 | 12.1902 | 0.7060 | 432 | 421.4981 | 0.0974 | 0.0047 | 0.0065 |
| W3 | MLValue | 4.4646 | 4.4831 | 0.2805 | 1.6010 | 0.3571 | 70 | 41.1572 | 0.0638 | 0.0085 | 0.0105 |

MLValue action distributions: W1 `WAIT 99.84%, BUY_SMALL 0.05%, BUY 0.01%, SELL_PART 0.07%, SELL_ALL 0.03%`; W2 `99.81%, 0.07%, 0.02%, 0.05%, 0.06%`; W3 `99.77%, 0.12%, 0.04%, 0.00%, 0.07%`.

Validation-selected margins were W1 `0.005`, W2 `0.003`, W3 `0.005`; they are not stable. Base/1.5x/2x ML net returns were W1 `-1.9944/-1.9981/-2.0018`, W2 `11.3511/11.3454/10.8979`, and W3 `4.4646/3.8604/3.1678`.

The OOS return summary is positive in 2 windows and negative in 1: median `4.4646`, mean `4.6071`, worst `-1.9944`, best `11.3511`, dispersion `5.4492`. OOS windows were excluded from model, feature, and threshold selection. Future-blind: PASS. Production isolation remains enabled.

**RESEARCH_BLOCKED**
