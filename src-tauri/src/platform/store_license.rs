//! Amply Pro, sold as the `amply_pro` durable add-on in the Microsoft Store. The Store owns the
//! purchase and the license; Amply only asks it. A definite answer from the Store always wins, and
//! the last confirmed purchase covers a machine that cannot get an answer for a while.

use serde::{Deserialize, Serialize};
use tauri_plugin_opener::OpenerExt;

use super::store_review::{is_packaged, STORE_PRODUCT_ID};
use crate::{error::AmplyResult, storage};

/// Partner Center > amply_pro > Product identity.
#[cfg_attr(not(windows), allow(dead_code))]
const PRO_ADDON_STORE_ID: &str = "9PHXSQW5654D";
#[cfg_attr(not(windows), allow(dead_code))]
const PRO_ADDON_PRODUCT_ID: &str = "amply_pro";

const CACHE_KEY: &str = "entitlement/amply_pro.json";
/// How long a purchase is honoured while the Store cannot be reached.
const OFFLINE_GRACE_SECS: i64 = 30 * 86_400;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LicenseAnswer {
    Active,
    Inactive,
    /// The Store could not say; a failed query must not take away something the user paid for.
    Unknown,
}

#[derive(Debug, PartialEq, Eq)]
enum CacheAction {
    Keep,
    Verified,
    Clear,
}

#[derive(Debug, PartialEq, Eq)]
struct Decision {
    is_pro: bool,
    offline: bool,
    cache: CacheAction,
}

#[derive(Serialize, Deserialize)]
struct CachedLicense {
    verified_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProStatus {
    is_pro: bool,
    /// Pro can only be bought from a Store install.
    store_install: bool,
    /// Pro is active on the strength of the last confirmed purchase, not a fresh answer.
    offline: bool,
    /// The add-on's price in the user's market, formatted by the Store.
    price: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PurchaseOutcome {
    Purchased,
    AlreadyOwned,
    Cancelled,
    NetworkError,
    Failed,
    /// Not a Store install: the listing was opened instead.
    StoreOpened,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseResult {
    outcome: PurchaseOutcome,
    status: ProStatus,
}

fn decide(answer: LicenseAnswer, verified_at: Option<i64>, now: i64) -> Decision {
    match answer {
        LicenseAnswer::Active => Decision { is_pro: true, offline: false, cache: CacheAction::Verified },
        LicenseAnswer::Inactive => Decision { is_pro: false, offline: false, cache: CacheAction::Clear },
        LicenseAnswer::Unknown => {
            // A timestamp from the future means the clock was moved; it proves nothing.
            let in_grace = verified_at.is_some_and(|at| (0..=OFFLINE_GRACE_SECS).contains(&(now - at)));
            Decision { is_pro: in_grace, offline: in_grace, cache: CacheAction::Keep }
        }
    }
}

/// Debug builds only: `AMPLY_DEV_PRO=1 npm run tauri dev` behaves as a Pro install. Compiled out of
/// release builds, so no environment variable can unlock a shipped copy.
fn dev_override() -> bool {
    cfg!(debug_assertions) && std::env::var("AMPLY_DEV_PRO").is_ok_and(|value| value == "1")
}

fn read_verified_at(app: &tauri::AppHandle) -> Option<i64> {
    let raw = storage::storage_db(app).ok()?.read_blocking(CACHE_KEY).ok()??;
    serde_json::from_str::<CachedLicense>(&raw).ok().map(|cached| cached.verified_at)
}

fn apply_cache(app: &tauri::AppHandle, action: &CacheAction, now: i64) {
    let Ok(db) = storage::storage_db(app) else {
        return;
    };
    let result = match action {
        CacheAction::Keep => Ok(()),
        CacheAction::Clear => db.delete_blocking(CACHE_KEY),
        CacheAction::Verified => serde_json::to_string(&CachedLicense { verified_at: now })
            .map_err(|err| err.to_string())
            .and_then(|value| db.write_blocking(CACHE_KEY, &value)),
    };
    if let Err(error) = result {
        log::warn!("Could not update the cached Pro license: {error}");
    }
}

/// A desktop app has no CoreWindow: Microsoft documents that a StoreContext without an owner window
/// "will return inaccurate data or errors", for reads as well as for dialogs.
#[cfg(windows)]
fn store_context(hwnd: Option<isize>) -> windows::core::Result<windows::Services::Store::StoreContext> {
    use windows::core::Interface;
    use windows::Win32::{Foundation::HWND, UI::Shell::IInitializeWithWindow};

    let context = windows::Services::Store::StoreContext::GetDefault()?;
    if let Some(hwnd) = hwnd {
        unsafe { context.cast::<IInitializeWithWindow>()?.Initialize(HWND(hwnd as *mut core::ffi::c_void)) }?;
    }
    Ok(context)
}

/// HWNDs are not Send; the handle crosses threads as a number.
#[cfg(windows)]
fn main_window_handle(app: &tauri::AppHandle) -> Option<isize> {
    use tauri::Manager;
    app.get_webview_window("main").and_then(|window| window.hwnd().ok()).map(|hwnd| hwnd.0 as isize)
}

/// What the Store says about the add-on, and its price when the listing could be read.
#[cfg(windows)]
fn query_store(hwnd: Option<isize>) -> (LicenseAnswer, Option<String>) {
    use windows::core::HSTRING;
    use windows::Foundation::Collections::IIterable;

    let Ok(context) = store_context(hwnd) else {
        return (LicenseAnswer::Unknown, None);
    };

    // The Store client keeps licenses locally, so this normally answers offline too.
    let licensed = (|| -> windows::core::Result<bool> {
        let license = context.GetAppLicenseAsync()?.get()?;
        for entry in license.AddOnLicenses()? {
            let addon = entry.Value()?;
            let store_id = addon.SkuStoreId()?.to_string();
            let matches = addon.InAppOfferToken()? == PRO_ADDON_PRODUCT_ID || store_id.starts_with(PRO_ADDON_STORE_ID);
            if matches && addon.IsActive()? {
                return Ok(true);
            }
        }
        Ok(false)
    })();
    if let Err(error) = &licensed {
        log::warn!("Reading the Store license failed: {error}");
    }

    let listing = (|| -> windows::core::Result<(bool, Option<String>)> {
        let kinds = IIterable::<HSTRING>::try_from(vec![HSTRING::from("Durable")])?;
        let ids = IIterable::<HSTRING>::try_from(vec![HSTRING::from(PRO_ADDON_STORE_ID)])?;
        let result = context.GetStoreProductsAsync(&kinds, &ids)?.get()?;
        result.ExtendedError()?.ok()?;
        let products = result.Products()?;
        let id = HSTRING::from(PRO_ADDON_STORE_ID);
        if !products.HasKey(&id)? {
            // An online answer with no listing: not published to this market (yet).
            return Ok((false, None));
        }
        let product = products.Lookup(&id)?;
        let price = product.Price()?.FormattedPrice()?.to_string();
        Ok((product.IsInUserCollection()?, Some(price)))
    })();
    if let Err(error) = &listing {
        log::info!("Reading the Store listing failed: {error}");
    }

    let price = listing.as_ref().ok().and_then(|(_, price)| price.clone());
    // "Not licensed" is only believed when the online listing agrees: the local license can lag a
    // purchase made on another PC, and a refund is confirmed by the listing no longer showing it.
    let answer = match (licensed, listing) {
        (Ok(true), _) | (_, Ok((true, _))) => LicenseAnswer::Active,
        (Ok(false), Ok((false, _))) => LicenseAnswer::Inactive,
        _ => LicenseAnswer::Unknown,
    };
    (answer, price)
}

#[cfg(not(windows))]
fn query_store(_hwnd: Option<isize>) -> (LicenseAnswer, Option<String>) {
    (LicenseAnswer::Inactive, None)
}

fn status_from(decision: &Decision, price: Option<String>) -> ProStatus {
    ProStatus { is_pro: decision.is_pro, store_install: is_packaged(), offline: decision.offline, price }
}

/// The answer available without asking the Store, so startup never waits on it.
#[tauri::command]
pub async fn pro_status_cached(app: tauri::AppHandle) -> AmplyResult<ProStatus> {
    let answer = if dev_override() {
        LicenseAnswer::Active
    } else if is_packaged() {
        LicenseAnswer::Unknown
    } else {
        LicenseAnswer::Inactive
    };
    let verified_at = tauri::async_runtime::spawn_blocking(move || read_verified_at(&app))
        .await
        .map_err(|err| err.to_string())?;
    Ok(status_from(&decide(answer, verified_at, storage::now_unix()), None))
}

/// Asks the Store, remembers a confirmed purchase and returns the result. Also "Restore purchase".
#[tauri::command]
pub async fn pro_refresh(app: tauri::AppHandle) -> AmplyResult<ProStatus> {
    let status = tauri::async_runtime::spawn_blocking(move || {
        let (answer, price) = if dev_override() {
            (LicenseAnswer::Active, None)
        } else if is_packaged() {
            #[cfg(windows)]
            let hwnd = main_window_handle(&app);
            #[cfg(not(windows))]
            let hwnd = None;
            query_store(hwnd)
        } else {
            (LicenseAnswer::Inactive, None)
        };
        let now = storage::now_unix();
        let decision = decide(answer, read_verified_at(&app), now);
        apply_cache(&app, &decision.cache, now);
        status_from(&decision, price)
    })
    .await
    .map_err(|err| err.to_string())?;
    Ok(status)
}

/// Shows the Store's purchase dialog over `hwnd`. Starts on the UI thread, which owns the dialog's
/// parent window, and reports through a completion handler so that thread is never blocked.
#[cfg(windows)]
fn start_purchase(hwnd: isize, done: tokio::sync::oneshot::Sender<PurchaseOutcome>) -> windows::core::Result<()> {
    use std::sync::Mutex;
    use windows::core::HSTRING;
    use windows::Foundation::{AsyncOperationCompletedHandler, IAsyncOperation};
    use windows::Services::Store::{StorePurchaseResult, StorePurchaseStatus};

    let context = store_context(Some(hwnd))?;
    let operation = context.RequestPurchaseAsync(&HSTRING::from(PRO_ADDON_STORE_ID))?;
    let done = Mutex::new(Some(done));
    operation.SetCompleted(&AsyncOperationCompletedHandler::new(move |operation: Option<&IAsyncOperation<StorePurchaseResult>>, _status| {
        let outcome = operation
            .ok_or_else(windows::core::Error::empty)
            .and_then(|operation| operation.GetResults())
            .and_then(|result| result.Status());
        let outcome = match outcome {
            Ok(StorePurchaseStatus::Succeeded) => PurchaseOutcome::Purchased,
            Ok(StorePurchaseStatus::AlreadyPurchased) => PurchaseOutcome::AlreadyOwned,
            Ok(StorePurchaseStatus::NotPurchased) => PurchaseOutcome::Cancelled,
            Ok(StorePurchaseStatus::NetworkError) => PurchaseOutcome::NetworkError,
            Ok(status) => {
                log::warn!("Store purchase ended with status {}", status.0);
                PurchaseOutcome::Failed
            }
            Err(error) => {
                log::warn!("Store purchase failed: {error}");
                PurchaseOutcome::Failed
            }
        };
        if let Some(sender) = done.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
            let _ = sender.send(outcome);
        }
        Ok(())
    }))
}

#[cfg(windows)]
async fn native_purchase(app: &tauri::AppHandle) -> PurchaseOutcome {
    let Some(hwnd) = main_window_handle(app) else {
        return PurchaseOutcome::Failed;
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let dispatched = app.run_on_main_thread(move || {
        if let Err(error) = start_purchase(hwnd, sender) {
            // Dropping the sender (with the closure) tells the waiting side that nothing started.
            log::warn!("Could not start the Store purchase: {error}");
        }
    });
    if let Err(error) = dispatched {
        log::warn!("Could not reach the UI thread for the Store purchase: {error}");
        return PurchaseOutcome::Failed;
    }
    receiver.await.unwrap_or(PurchaseOutcome::Failed)
}

#[cfg(not(windows))]
async fn native_purchase(_app: &tauri::AppHandle) -> PurchaseOutcome {
    PurchaseOutcome::Failed
}

fn store_listing_uri() -> String {
    if cfg!(windows) {
        format!("ms-windows-store://pdp/?ProductId={STORE_PRODUCT_ID}")
    } else {
        format!("https://apps.microsoft.com/detail/{}", STORE_PRODUCT_ID.to_lowercase())
    }
}

/// Buys Pro in a Store install. Any other install opens the Store listing, where Amply can be
/// installed first: the add-on belongs to the Store app, so only that copy can buy or read it.
#[tauri::command]
pub async fn pro_purchase(app: tauri::AppHandle) -> AmplyResult<PurchaseResult> {
    if !is_packaged() {
        let outcome = match app.opener().open_url(store_listing_uri(), None::<&str>) {
            Ok(()) => PurchaseOutcome::StoreOpened,
            Err(error) => {
                log::warn!("Opening the Store listing failed: {error}");
                PurchaseOutcome::Failed
            }
        };
        return Ok(PurchaseResult { outcome, status: pro_refresh(app).await? });
    }

    let outcome = native_purchase(&app).await;
    if matches!(outcome, PurchaseOutcome::Purchased | PurchaseOutcome::AlreadyOwned) {
        // The Store just confirmed it, whatever the local license catches up to.
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || apply_cache(&handle, &CacheAction::Verified, storage::now_unix()))
            .await
            .map_err(|err| err.to_string())?;
        let status = ProStatus { is_pro: true, store_install: true, offline: false, price: None };
        return Ok(PurchaseResult { outcome, status });
    }
    Ok(PurchaseResult { outcome, status: pro_refresh(app).await? })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    #[test]
    fn a_definite_answer_from_the_store_always_wins() {
        let active = decide(LicenseAnswer::Active, None, NOW);
        assert!(active.is_pro && !active.offline);
        assert_eq!(active.cache, CacheAction::Verified);

        // A refund ends Pro even with a recent cached purchase.
        let refunded = decide(LicenseAnswer::Inactive, Some(NOW - 60), NOW);
        assert!(!refunded.is_pro);
        assert_eq!(refunded.cache, CacheAction::Clear);
    }

    #[test]
    fn no_answer_honours_a_recent_purchase_only() {
        let recent = decide(LicenseAnswer::Unknown, Some(NOW - OFFLINE_GRACE_SECS), NOW);
        assert!(recent.is_pro && recent.offline);
        assert_eq!(recent.cache, CacheAction::Keep);

        let stale = decide(LicenseAnswer::Unknown, Some(NOW - OFFLINE_GRACE_SECS - 1), NOW);
        assert!(!stale.is_pro);
        // Kept: the purchase is not disproved, and the next good answer replaces it.
        assert_eq!(stale.cache, CacheAction::Keep);

        assert!(!decide(LicenseAnswer::Unknown, None, NOW).is_pro);
    }

    #[test]
    fn a_future_timestamp_proves_nothing() {
        assert!(!decide(LicenseAnswer::Unknown, Some(NOW + 3_600), NOW).is_pro);
    }

    #[test]
    fn non_store_runs_are_not_store_installs() {
        let status = status_from(&decide(LicenseAnswer::Inactive, None, NOW), None);
        assert_eq!(status, ProStatus { is_pro: false, store_install: false, offline: false, price: None });
    }

    #[test]
    fn the_frontend_contract_is_stable() {
        let status = ProStatus { is_pro: true, store_install: true, offline: false, price: Some("$4.99".into()) };
        assert_eq!(
            serde_json::to_string(&status).unwrap(),
            r#"{"isPro":true,"storeInstall":true,"offline":false,"price":"$4.99"}"#
        );
        assert_eq!(serde_json::to_string(&PurchaseOutcome::AlreadyOwned).unwrap(), "\"already-owned\"");
    }
}
