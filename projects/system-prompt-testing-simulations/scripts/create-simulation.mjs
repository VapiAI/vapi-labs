import path from 'node:path';
import {
  root,
  readJson,
  readState,
  writeState,
  syncNamed,
} from './lib.mjs';

const config = readJson(path.join(root, 'simulations', 'config.json'));
const state = readState();
state.simulation ??= {};

for (const condition of config.study.assistantOrder) {
  if (!state.assistants?.[condition]?.id) {
    throw new Error(`No deployed assistant ID for ${condition}. Run npm run push first.`);
  }
}

const personality = await syncNamed(
  '/eval/simulation/personality',
  state.simulation.personalityId,
  config.personality,
);
state.simulation.personalityId = personality.id;
writeState(state);

const scenario = await syncNamed(
  '/eval/simulation/scenario',
  state.simulation.scenarioId,
  config.scenario,
);
state.simulation.scenarioId = scenario.id;
writeState(state);

const simulation = await syncNamed(
  '/eval/simulation',
  state.simulation.simulationId,
  {
    ...config.simulation,
    personalityId: personality.id,
    scenarioId: scenario.id,
  },
);
state.simulation.simulationId = simulation.id;
writeState(state);

const suite = await syncNamed(
  '/eval/simulation/suite',
  state.simulation.suiteId,
  {
    ...config.suite,
    simulationIds: [simulation.id],
    targetAssignments: config.study.assistantOrder.map((condition) => ({
      targetType: 'assistant',
      targetId: state.assistants[condition].id,
    })),
  },
);
state.simulation.suiteId = suite.id;
writeState(state);

console.log(JSON.stringify({
  personalityId: personality.id,
  scenarioId: scenario.id,
  simulationId: simulation.id,
  suiteId: suite.id,
}, null, 2));
