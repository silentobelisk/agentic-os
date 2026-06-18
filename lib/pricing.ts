// Estimated Anthropic API pricing, USD per 1M tokens (authoritative rates as of
// 2026-06, via the claude-api skill). Cache writes: 1.25x input for 5-minute
// ephemeral, 2x input for 1-hour ephemeral. Cache reads: 0.1x input.
// Costs are clearly labelled as estimates in the UI.

interface Rate {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

function tier(input: number, output: number): Rate {
  return {
    input,
    output,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
    cacheRead: input * 0.1,
  };
}

const RATES: Record<string, Rate> = {
  opus: tier(5, 25),
  fable: tier(10, 50),
  sonnet: tier(3, 15),
  haiku: tier(1, 5),
};

function rateFor(model: string): Rate {
  const m = (model || "").toLowerCase();
  if (m.includes("haiku")) return RATES.haiku;
  if (m.includes("sonnet")) return RATES.sonnet;
  if (m.includes("fable") || m.includes("mythos")) return RATES.fable;
  if (m.includes("opus")) return RATES.opus;
  // Unknown model: use the mid Opus tier rather than the priciest, so an
  // unrecognized id doesn't silently inflate the estimate.
  return RATES.opus;
}

export function estimateCost(
  model: string,
  input: number,
  output: number,
  cacheCreate5m: number,
  cacheCreate1h: number,
  cacheRead: number
): number {
  const r = rateFor(model);
  return (
    (input * r.input +
      output * r.output +
      cacheCreate5m * r.cacheWrite5m +
      cacheCreate1h * r.cacheWrite1h +
      cacheRead * r.cacheRead) /
    1_000_000
  );
}
