from datetime import timedelta
from typing import List, Dict, Any
import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

app = FastAPI(title="DemandWise Python ML Service", version="1.0.0")

class Observation(BaseModel):
    date: str
    units_sold: float = Field(ge=0)

class ForecastRequest(BaseModel):
    product_id: str
    product_name: str = "Selected product"
    horizon: int = Field(default=8, ge=1, le=52)  # weeks
    observations: List[Observation]

@app.get("/health")
def health():
    return {"status": "ok", "model": "scikit-learn RandomForestRegressor"}

@app.post("/forecast")
def forecast(req: ForecastRequest):
    if not req.observations:
        raise HTTPException(400, "No historical observations supplied")
    df = pd.DataFrame([x.model_dump() for x in req.observations])
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["units_sold"] = pd.to_numeric(df["units_sold"], errors="coerce")
    df = df.dropna(subset=["date", "units_sold"]).sort_values("date")
    # Aggregate duplicate dates and use weekly cadence. Missing weeks are filled with zero.
    series = df.groupby("date")["units_sold"].sum().sort_index()
    if series.empty:
        raise HTTPException(400, "No valid dated sales observations")
    series.index = pd.to_datetime(series.index)
    series = series.groupby(level=0).sum().sort_index()
    # Dataset dates are weekly observations; regularize to a 7-day cadence from first date.
    full_index = pd.date_range(series.index.min(), series.index.max(), freq="7D")
    # Align each observation to nearest week from the first date to avoid accidental daily treatment.
    offsets = ((series.index - series.index.min()).days / 7).round().astype(int)
    aligned = pd.Series(series.values, index=[series.index.min() + pd.Timedelta(days=7*int(i)) for i in offsets])
    aligned = aligned.groupby(level=0).sum().sort_index()
    full_index = pd.date_range(aligned.index.min(), aligned.index.max(), freq="7D")
    y = aligned.reindex(full_index, fill_value=0).astype(float)

    def make_features(values: pd.Series):
        frame = pd.DataFrame({"y": values})
        for lag in (1, 2, 4, 8):
            frame[f"lag_{lag}"] = frame["y"].shift(lag)
        frame["rolling4"] = frame["y"].shift(1).rolling(4).mean()
        frame["week_of_year"] = frame.index.isocalendar().week.astype(int)
        frame["month"] = frame.index.month
        return frame.dropna()

    features = ["lag_1", "lag_2", "lag_4", "lag_8", "rolling4", "week_of_year", "month"]
    mae = rmse = None
    if len(y) >= 16:
        frame = make_features(y)
        if len(frame) >= 8:
            split = max(5, int(len(frame) * 0.8))
            split = min(split, len(frame)-1)
            train, test = frame.iloc[:split], frame.iloc[split:]
            model = RandomForestRegressor(n_estimators=180, max_depth=10, min_samples_leaf=2, random_state=42, n_jobs=-1)
            model.fit(train[features], train["y"])
            test_pred = np.maximum(0, model.predict(test[features]))
            mae = round(float(mean_absolute_error(test["y"], test_pred)), 3)
            rmse = round(float(np.sqrt(mean_squared_error(test["y"], test_pred))), 3)
            model.fit(frame[features], frame["y"])
            history = y.copy()
            predictions = []
            for _ in range(req.horizon):
                next_date = history.index[-1] + pd.Timedelta(days=7)
                row = pd.DataFrame([{
                    "lag_1": history.iloc[-1],
                    "lag_2": history.iloc[-2] if len(history) >= 2 else history.mean(),
                    "lag_4": history.iloc[-4] if len(history) >= 4 else history.mean(),
                    "lag_8": history.iloc[-8] if len(history) >= 8 else history.mean(),
                    "rolling4": history.tail(4).mean(),
                    "week_of_year": int(next_date.isocalendar().week),
                    "month": int(next_date.month),
                }], index=[next_date])
                value = max(0.0, float(model.predict(row[features])[0]))
                predictions.append(value)
                history.loc[next_date] = value
            method = "RandomForestRegressor (weekly lag + calendar features)"
    else:
        # Transparent fallback for sparse histories; don't pretend it is trained ML.
        avg = float(y.tail(min(4, len(y))).mean())
        predictions = [max(0.0, avg)] * req.horizon
        method = "4-week moving-average fallback (insufficient history for ML)"

    start = y.index[-1] + pd.Timedelta(days=7)
    future = [{"date": (start + pd.Timedelta(days=7*i)).date().isoformat(), "predicted_units": round(float(v), 2)} for i, v in enumerate(predictions)]
    hist = [{"date": d.date().isoformat(), "actual_units": int(round(v))} for d, v in y.tail(60).items()]
    return {
        "product_id": req.product_id, "product_name": req.product_name,
        "horizon": req.horizon, "horizon_unit": "weeks", "method": method,
        "mae": mae, "rmse": rmse, "historical": hist, "forecast": future,
        "total_predicted_units": round(float(sum(predictions)), 2),
        "average_weekly_demand": round(float(np.mean(predictions)), 2),
        "training_weeks": int(len(y)),
    }
