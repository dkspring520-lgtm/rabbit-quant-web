# Offline RL V0.10 Dataset Schema

Core: state, action, reward, nextState, done.

Lineage: timestamp, symbol, scenarioId, episodeId, strategyId, strategyVersion, sourceDatasetHash, normalizedDatasetHash, expertSignalHash, trajectoryDatasetHash, stateDatasetHash, executionVersion, rewardVersion, costModelVersion, observedExpertBehavior.

The builder reads the persisted V0.9.6 logged trajectory artifact only; it does not import or call PaperExecutionEngine or materializeScenario.
