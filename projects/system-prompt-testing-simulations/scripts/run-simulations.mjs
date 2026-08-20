import path from 'node:path';
import { root, readJson, readState, vapi, sleep } from './lib.mjs';

const config = readJson(path.join(root, 'simulations', 'config.json'));
const state = readState();
const suiteId = state.simulation?.suiteId;
if (!suiteId) throw new Error('No suite ID. Run npm run simulation:create first.');

const transport = process.env.SIM_TRANSPORT ?? config.study.transport;
const iterations = Number(process.env.SIM_ITERATIONS ?? config.study.iterationsPerAssistant);
if (!['vapi.webchat', 'vapi.websocket'].includes(transport)) {
  throw new Error(`Unsupported transport: ${transport}`);
}
if (!Number.isInteger(iterations) || iterations < 1) {
  throw new Error('SIM_ITERATIONS must be a positive integer');
}

console.log(`Study: ${config.study.name}`);
console.log(`Approved fixture date: ${config.study.approvedDate}`);
console.log(`Suite: ${suiteId}`);
console.log(`Targets: ${config.study.assistantOrder.join(', ')}`);
console.log(`Mode: ${transport}; iterations per assistant: ${iterations}`);
console.log('Tool mocks: none. Live tools are local fixtures with no external side effects.');

let allPassed = true;
for (const condition of config.study.assistantOrder) {
  const assistantId = state.assistants?.[condition]?.id;
  if (!assistantId) throw new Error(`No deployed assistant ID for ${condition}`);

  const run = await vapi('POST', '/eval/simulation/run', {
    simulations: [{ type: 'simulationSuite', simulationSuiteId: suiteId }],
    target: { type: 'assistant', assistantId },
    iterations,
    transport: { provider: transport },
  });
  console.log(`\n${condition}: ${run.url ?? run.id}`);

  let status;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    status = await vapi('GET', `/eval/simulation/run/${run.id}`);
    if (status.status === 'ended') break;
    await sleep(5000);
  }
  if (status?.status !== 'ended') throw new Error(`${condition} did not end within 15 minutes`);

  const response = await vapi('GET', `/eval/simulation/run/${run.id}/item?limit=100`);
  const items = response.results ?? response;
  if (!Array.isArray(items)) throw new Error(`${condition} returned no run-item list`);
  const expectedEvaluationNames = config.scenario.evaluations.map(
    (evaluation) => evaluation.structuredOutput.name,
  );
  const requiredEvaluationsPassed = items.every((item) =>
    expectedEvaluationNames.every((name) => {
      const evaluation = (item.results?.evaluations ?? []).find(
        (candidate) => candidate.name === name,
      );
      return evaluation?.required === true &&
        evaluation.passed === true &&
        !evaluation.error &&
        !evaluation.isSkipped;
    }));
  const passed = status.itemCounts?.total === iterations &&
    items.length === iterations &&
    (status.itemCounts?.failed ?? 0) === 0 &&
    (status.itemCounts?.canceled ?? 0) === 0 &&
    items.every((item) => item.results?.passed === true) &&
    requiredEvaluationsPassed;
  allPassed &&= passed;
  console.log(`${passed ? 'PASSED' : 'FAILED'}: ${status.itemCounts?.passed ?? 0}/${status.itemCounts?.total ?? 0} items`);

  for (const item of items) {
    console.log(`  iteration ${item.iterationNumber ?? 'unknown'}; transport ${transport}`);
    for (const evaluation of item.results?.evaluations ?? []) {
      const mark = evaluation.passed ? '✓' : '✗';
      console.log(`  ${mark} ${evaluation.name}: ${evaluation.extractedValue} (expected ${evaluation.expectedValue})`);
      if (evaluation.error || evaluation.skipReason) {
        console.log(`    ${evaluation.error ?? evaluation.skipReason}`);
      }
    }
    if (item.failureReason) console.log(`  failure: ${item.failureReason}`);
  }
}

if (!allPassed) process.exitCode = 1;
