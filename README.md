# DemandWise AI — React + Express + Python ML

Demand forecasting and product recommendation starter project.

## Architecture
- React + Vite frontend (port 5173)
- Node.js + Express API (port 8000)
- Python FastAPI ML service (port 8001)
- scikit-learn RandomForestRegressor for weekly demand forecasting when enough history exists
- Content-based recommendations in the Express API
- CSV storage by default; optional MongoDB via `MONGODB_URI`

## Requirements
- Node.js 18+
- Python 3.10+
- npm

## Run on Windows PowerShell

### Terminal 1: Python ML service
```powershell
cd ml_service
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload --port 8001
```
Health check: http://127.0.0.1:8001/health

### Terminal 2: Node/Express backend
```powershell
cd backend
npm install
copy .env.example .env
npm run dev
```
API runs at http://127.0.0.1:8000.

### Terminal 3: React frontend
```powershell
cd frontend
npm install
npm run dev
```
Open the Vite URL, usually http://localhost:5173.

## Use your weekly sales dataset
In the dashboard, choose **Import CSV** and upload the original `train_0irEZ2H.csv`. The backend directly supports columns `week`, `store_id`, `sku_id`, `units_sold`, `total_price`, and `base_price` (plus optional feature flags).

The dashboard forecasts 4, 8, or 12 weeks for a selected store/SKU combination. Python builds lag/calendar features and evaluates on a chronological holdout using MAE and RMSE. If a product has too little history, it uses a clearly labeled moving-average fallback.

## Important data caveats
- The source dataset is weekly; forecast horizons are weeks, not days.
- The source dataset has no actual inventory field. Any `stock` value created on import is a synthetic placeholder; don't use inventory alerts as real purchasing advice.
- The source has store and SKU IDs but no customer purchase histories, so recommendations are product-attribute/popularity based rather than personalized to individual customers.
- Forecast accuracy must be assessed on held-out weeks before using it for real business decisions.
