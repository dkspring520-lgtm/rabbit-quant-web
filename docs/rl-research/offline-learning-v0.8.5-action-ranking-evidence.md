# Offline Learning V0.8.5 Action Ranking Evidence Closure

Policy horizon: 30 observed bars. Models: Naive, Mean, Decision Stump Tree, Ridge. Test and OOS windows were not used for model, feature, or threshold selection.

Test bars: 30,848; primary evaluable bars: 30,788; unresolved: 60.

## W1

naive: sampleCount=14219, Spearman=0, NDCG=0.8279373018720081, netReturn=0, tradeCount=0, winRate=0, selectedThreshold=0
mean: sampleCount=14219, Spearman=0.1109079400801744, NDCG=0.8279373018720081, netReturn=0, tradeCount=0, winRate=0, selectedThreshold=0.005
tree: sampleCount=14219, Spearman=0.1109079400801744, NDCG=0.8279373018720081, netReturn=0, tradeCount=0, winRate=0, selectedThreshold=0.005
ridge: sampleCount=14219, Spearman=0.11052113369435261, NDCG=0.8279279874345616, netReturn=-1.994392348284159, tradeCount=46, winRate=0.32608695652173914, selectedThreshold=0.005

## W2

naive: sampleCount=15183, Spearman=0, NDCG=0.8086746071304828, netReturn=0, tradeCount=0, winRate=0, selectedThreshold=0
mean: sampleCount=15183, Spearman=0.03128498979121385, NDCG=0.8086746071304828, netReturn=0, tradeCount=0, winRate=0, selectedThreshold=0.005
tree: sampleCount=15183, Spearman=0.03128498979121385, NDCG=0.8086746071304828, netReturn=0, tradeCount=0, winRate=0, selectedThreshold=0.005
ridge: sampleCount=15183, Spearman=0.031350852927616406, NDCG=0.8087200419439453, netReturn=11.35111029257196, tradeCount=59, winRate=0.3728813559322034, selectedThreshold=0.005

## W3

naive: sampleCount=15394, Spearman=0, NDCG=0.8218419457392478, netReturn=0, tradeCount=0, winRate=0, selectedThreshold=0
mean: sampleCount=15394, Spearman=0.10406651942315187, NDCG=0.8218419457392478, netReturn=0, tradeCount=0, winRate=0, selectedThreshold=0.005
tree: sampleCount=15394, Spearman=0.10406651942315187, NDCG=0.8218419457392478, netReturn=0, tradeCount=0, winRate=0, selectedThreshold=0.005
ridge: sampleCount=15394, Spearman=0.10575548915161752, NDCG=0.8222502387153887, netReturn=4.464580390428339, tradeCount=70, winRate=0.35714285714285715, selectedThreshold=0.005

WAIT dominance and Top-K artifacts are in the JSON/CSV files. Oracle remains diagnostic upper bound only.

Evidence: Evidence Not Supported

**RESEARCH_BLOCKED**
