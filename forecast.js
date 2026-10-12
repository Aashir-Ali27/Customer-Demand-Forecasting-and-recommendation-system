function dayKey(d) { return d.toISOString().slice(0, 10); }
function buildForecast(rows, horizon = 30) {
  const byDay = new Map();
  for (const r of rows) {
    const key = dayKey(new Date(r.date));
    byDay.set(key, (byDay.get(key) || 0) + Number(r.units_sold || 0));
  }
  const keys = [...byDay.keys()].sort();
  if (!keys.length) throw new Error('No dated sales found.');
  const start = new Date(`${keys[0]}T00:00:00.000Z`);
  const end = new Date(`${keys[keys.length - 1]}T00:00:00.000Z`);
  const history = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate()+1)) {
    const key = dayKey(d); history.push({ date: key, units: byDay.get(key) || 0 });
  }
  const values = history.map(x => x.units);
  const average = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  // Backtest one-step predictions on the latest up-to-30 days against a trailing 7-day baseline.
  const testStart = Math.max(7, values.length - 30);
  const errors = [];
  for (let i = testStart; i < values.length; i++) errors.push(Math.abs(values[i] - average(values.slice(i-7, i))));
  const mae = errors.length ? Number(average(errors).toFixed(3)) : null;
  // Blend recent level with same-weekday history to retain a basic weekly pattern.
  const future = [];
  const rolling = values.slice();
  const lastDate = new Date(`${history[history.length-1].date}T00:00:00.000Z`);
  for (let step=1; step<=horizon; step++) {
    const date = new Date(lastDate); date.setUTCDate(date.getUTCDate()+step);
    const recentMean = average(rolling.slice(-7));
    const weekdayValues = history.filter(h => new Date(`${h.date}T00:00:00.000Z`).getUTCDay() === date.getUTCDay()).map(h=>h.units);
    const weekdayMean = average(weekdayValues.slice(-8));
    const predicted = Math.max(0, 0.65*recentMean + 0.35*(weekdayValues.length ? weekdayMean : recentMean));
    future.push({ date: dayKey(date), predicted_units: Number(predicted.toFixed(2)) });
    rolling.push(predicted);
  }
  return { historical: history.slice(-60).map(x=>({date:x.date, actual_units:Math.round(x.units)})), forecast:future,
    total_predicted_units:Number(future.reduce((s,x)=>s+x.predicted_units,0).toFixed(2)),
    average_daily_demand:Number(average(future.map(x=>x.predicted_units)).toFixed(2)), mae,
    method:'Weighted moving average + weekday seasonality (JavaScript baseline)' };
}
module.exports = { buildForecast };
