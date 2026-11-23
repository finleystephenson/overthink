// Scenario shapes. A plain scenario has `turns`. A situation over days has `days: [step, ...]`.
// Both are turned into a list of steps so the runner and the checker treat them the same way.
//
// A step: { advance_days, turns, expected_actions, forbidden_actions, ideal, state_checks, expected }
//  - advance_days: move the sandbox clock this many days BEFORE the step starts (days steps only).
//  - state_checks in a step are judged on the state at the END of that step (that is how later consequences are checked).

/** A scenario as a list of steps. Top-level checks of a days scenario apply to the whole run. */
export function stepsOf(scenario) {
  if (Array.isArray(scenario.days)) {
    return scenario.days.map((d) => ({ advance_days: 0, turns: [], expected_actions: [], forbidden_actions: [], ideal: null, state_checks: [], ...d }));
  }
  return [{
    advance_days: 0, turns: scenario.turns || [], expected_actions: scenario.expected_actions || [],
    forbidden_actions: scenario.forbidden_actions || [], ideal: scenario.ideal || null, state_checks: scenario.state_checks || [],
  }];
}

/** The whole scenario flattened for scoring: every step's expected/forbidden actions, and state checks tagged with their step. */
export function flatten(scenario) {
  const steps = stepsOf(scenario);
  const tag = (checks, i) => checks.map((c) => ({ ...c, step: c.step ?? i }));
  return {
    ...scenario,
    turns: steps.flatMap((s) => s.turns),
    expected_actions: steps.flatMap((s) => s.expected_actions),
    forbidden_actions: [...new Set([...(scenario.forbidden_actions || []), ...steps.flatMap((s) => s.forbidden_actions)])],
    state_checks: [...(Array.isArray(scenario.days) ? tag(scenario.state_checks || [], steps.length - 1) : []), ...steps.flatMap((s, i) => tag(s.state_checks, i))],
  };
}
