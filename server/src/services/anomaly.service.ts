const windows = new Map<string, number[]>();
const WINDOW_SIZE = 1000;

export function addSample(metric: string, value: number): { isAnomaly: boolean; zScore: number } {
  let window = windows.get(metric);
  if (!window) {
    window = [];
    windows.set(metric, window);
  }

  window.push(value);
  if (window.length > WINDOW_SIZE) {
    window.shift();
  }

  if (window.length < 30) {
    return { isAnomaly: false, zScore: 0 };
  }

  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) return { isAnomaly: false, zScore: 0 };

  const zScore = (value - mean) / stddev;
  return { isAnomaly: Math.abs(zScore) > 3, zScore: Math.round(zScore * 100) / 100 };
}
