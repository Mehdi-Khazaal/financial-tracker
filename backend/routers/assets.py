from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session
from typing import List, Optional
from models.database import get_db, Asset, SessionLocal, utc_now
from models.auth import User
from models.schemas import (
    AssetCreate, AssetUpdate, AssetResponse, HoldingsValuationResponse, HoldingValueResponse, MetalHistoryPoint,
    MetalPriceResponse,
)
from services.market_prices import METAL_KEYS, get_quotes, keys_needing_refresh, metal_history, refresh_quotes
from utils.dates import user_today
from services.valuation import price_keys, value_assets
from utils.auth import get_current_user
from utils.etag import check_etag, compute_user_etag, set_etag_headers
from utils.limiter import limiter

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("/", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(asset: AssetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_asset = Asset(**asset.model_dump(), user_id=current_user.id)
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)
    return db_asset


@router.get("/", response_model=List[AssetResponse])
def get_assets(
    request: Request,
    response: Response,
    asset_class: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Fold the filter into the ETag so /assets and /assets?asset_class=investment
    # get distinct cache entries.
    base_etag = compute_user_etag(db, current_user.id, [Asset])
    etag = base_etag if not asset_class else f"{base_etag}-{asset_class}"
    if check_etag(request, etag):
        return Response(status_code=304, headers={"ETag": f'W/"{etag}"', "Cache-Control": "private, no-cache"})
    set_etag_headers(response, etag)
    q = db.query(Asset).filter(Asset.user_id == current_user.id)
    if asset_class:
        q = q.filter(Asset.asset_class == asset_class)
    return q.order_by(Asset.created_at.desc()).all()


def _refresh_prices_in_background(keys: list[str]) -> None:
    """Refresh stored prices after the response, on a session of its own."""
    db = SessionLocal()
    try:
        refresh_quotes(db, keys)
    finally:
        db.close()


@router.get("/valuations", response_model=HoldingsValuationResponse)
@limiter.limit("60/minute")
def get_valuations(
    request: Request,
    background: BackgroundTasks,
    refresh: bool = Query(False, description="Fetch every price now instead of serving stored ones."),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every holding valued with stored market prices.

    Answers from stored prices so the Dashboard never waits on a market data
    provider. A price that has never been fetched is fetched now; one that is
    merely old is served as it is and refreshed in the background, so the next
    read is current. `refresh=true` (the Portfolio "Refresh" button) fetches
    every price before answering.
    """
    del request  # used by the rate limiter
    assets = db.query(Asset).filter(Asset.user_id == current_user.id).order_by(Asset.id).all()
    keys = price_keys(assets)
    quotes = get_quotes(db, keys, refresh="always" if refresh else "missing")
    stale = [] if refresh else keys_needing_refresh(quotes, keys, utc_now())
    if stale:
        background.add_task(_refresh_prices_in_background, stale)
    valuation = value_assets(assets, quotes)
    return HoldingsValuationResponse(
        total=valuation.total,
        recorded_total=valuation.recorded_total,
        priced_count=valuation.priced_count,
        as_of=valuation.as_of,
        refreshing=bool(stale),
        holdings=[
            HoldingValueResponse(
                asset_id=h.asset_id,
                current_value=h.current_value,
                recorded_value=h.recorded_value,
                change_since_recorded=h.change_since_recorded,
                price_per_unit=h.price_per_unit,
                source=h.source,
                priced_at=h.priced_at,
                spot_price=h.spot_price,
            )
            for h in valuation.holdings
        ],
    )


@router.get("/metal-prices", response_model=List[MetalPriceResponse])
@limiter.limit("60/minute")
def get_metal_prices(
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Gold and silver per troy ounce, for previewing what a piece is worth.

    Same policy as valuations: a price never fetched is fetched now, an old one
    is served and refreshed behind the response.
    """
    del request, current_user
    keys = set(METAL_KEYS.values())
    quotes = get_quotes(db, keys, refresh="missing")
    stale = keys_needing_refresh(quotes, keys, utc_now())
    if stale:
        background.add_task(_refresh_prices_in_background, stale)
    by_key = {key: metal for metal, key in METAL_KEYS.items()}
    return [
        MetalPriceResponse(metal=by_key[key], price=quote.price, fetched_at=quote.fetched_at)
        for key, quote in sorted(quotes.items())
    ]


@router.get("/metal-history", response_model=List[MetalHistoryPoint])
@limiter.limit("30/minute")
def get_metal_history(
    request: Request,
    metal: str = Query("gold", pattern="^(gold|silver)$"),
    months: int = Query(12, ge=2, le=36),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The metal's price per troy ounce at each month's end, oldest first.

    For the chart beside the owner's gold: what an ounce has done against what
    they paid for theirs. Past months are fetched once and kept.
    """
    del request
    today = user_today(current_user)
    labels = []
    for back in range(months - 1, -1, -1):
        index = today.year * 12 + today.month - 1 - back
        labels.append(f"{index // 12:04d}-{index % 12 + 1:02d}")
    return [MetalHistoryPoint(month=month, price=price) for month, price in metal_history(db, metal, labels)]


@router.get("/{asset_id}", response_model=AssetResponse)
def get_asset(asset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.put("/{asset_id}", response_model=AssetResponse)
def update_asset(asset_id: int, update: AssetUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)
    metal_fields = [asset.metal is not None, asset.weight_grams is not None, asset.purity is not None]
    if any(metal_fields) and not all(metal_fields):
        db.rollback()
        raise HTTPException(status_code=422, detail="Metal pricing needs the metal, the weight and the purity together.")
    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(asset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    db.delete(asset)
    db.commit()
