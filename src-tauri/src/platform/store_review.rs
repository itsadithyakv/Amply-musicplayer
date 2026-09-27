//! Microsoft Store ratings. A Store install gets Windows' own rating dialog inside Amply; any other
//! install (the NSIS build, a dev run), or a dialog that fails, opens the listing's review section
//! in the Store app instead.

use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

use crate::error::AmplyResult;

/// The Store listing: https://apps.microsoft.com/detail/9n20zr8ddp8l
const STORE_PRODUCT_ID: &str = "9N20ZR8DDP8L";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StoreReviewOutcome {
    /// The user submitted a rating in the in-app dialog.
    Rated,
    /// The user closed the in-app dialog without rating.
    Dismissed,
    /// The Store app was opened at the review section; what happened there is not reported back.
    StoreOpened,
    /// Neither the dialog nor the Store could be shown.
    Failed,
}

fn store_review_uri() -> String {
    if cfg!(windows) {
        format!("ms-windows-store://review/?ProductId={STORE_PRODUCT_ID}")
    } else {
        format!("https://apps.microsoft.com/detail/{}", STORE_PRODUCT_ID.to_lowercase())
    }
}

fn open_store_review_page(app: &tauri::AppHandle) -> StoreReviewOutcome {
    match app.opener().open_url(store_review_uri(), None::<&str>) {
        Ok(()) => StoreReviewOutcome::StoreOpened,
        Err(error) => {
            log::warn!("Opening the Store review page failed: {error}");
            StoreReviewOutcome::Failed
        }
    }
}

/// Whether this process runs from an MSIX package, i.e. was installed from the Store.
#[cfg(windows)]
fn is_packaged() -> bool {
    use windows::core::PWSTR;
    use windows::Win32::{Foundation::APPMODEL_ERROR_NO_PACKAGE, Storage::Packaging::Appx::GetCurrentPackageFullName};

    let mut length = 0u32;
    // With no buffer this only reports whether there is a package name to copy.
    let result = unsafe { GetCurrentPackageFullName(&mut length, PWSTR::null()) };
    result != APPMODEL_ERROR_NO_PACKAGE
}

#[cfg(not(windows))]
fn is_packaged() -> bool {
    false
}

/// Shows the Store's rating dialog over `hwnd` and waits for the user to finish with it.
#[cfg(windows)]
fn native_rate_and_review(hwnd: isize) -> Result<StoreReviewOutcome, String> {
    use windows::core::Interface;
    use windows::Services::Store::{StoreContext, StoreRateAndReviewStatus};
    use windows::Win32::{Foundation::HWND, UI::Shell::IInitializeWithWindow};

    let context = StoreContext::GetDefault().map_err(|err| err.to_string())?;
    // A desktop app has no CoreWindow, so the dialog must be told which window owns it.
    let owner = context.cast::<IInitializeWithWindow>().map_err(|err| err.to_string())?;
    unsafe { owner.Initialize(HWND(hwnd as *mut core::ffi::c_void)) }.map_err(|err| err.to_string())?;
    let result = context
        .RequestRateAndReviewAppAsync()
        .and_then(|operation| operation.get())
        .map_err(|err| err.to_string())?;
    match result.Status().map_err(|err| err.to_string())? {
        StoreRateAndReviewStatus::Succeeded => Ok(StoreReviewOutcome::Rated),
        StoreRateAndReviewStatus::CanceledByUser => Ok(StoreReviewOutcome::Dismissed),
        status => {
            let detail = result.ExtendedError().map(|code| code.0).unwrap_or_default();
            Err(format!("status {} (0x{detail:08x})", status.0))
        }
    }
}

/// True when Amply was installed from the Microsoft Store.
#[tauri::command]
pub fn is_store_install_rust() -> bool {
    is_packaged()
}

/// Asks the user to rate Amply: the in-app Store dialog for Store installs, the Store page otherwise.
#[tauri::command]
pub async fn request_store_review_rust(app: tauri::AppHandle) -> AmplyResult<StoreReviewOutcome> {
    #[cfg(windows)]
    if is_packaged() {
        use tauri::Manager;

        // HWNDs are not Send; the handle crosses to the blocking thread as a number.
        let owner = app
            .get_webview_window("main")
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as isize);
        if let Some(hwnd) = owner {
            // The dialog is modal and blocks until the user closes it, so it waits off the runtime.
            match tauri::async_runtime::spawn_blocking(move || native_rate_and_review(hwnd)).await {
                Ok(Ok(outcome)) => return Ok(outcome),
                Ok(Err(error)) => log::warn!("Store rating dialog failed, opening the Store instead: {error}"),
                Err(error) => log::warn!("Store rating dialog task failed: {error}"),
            }
        }
    }
    Ok(open_store_review_page(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_link_targets_the_listing() {
        let uri = store_review_uri();
        assert!(uri.to_uppercase().contains(STORE_PRODUCT_ID));
        if cfg!(windows) {
            assert_eq!(uri, "ms-windows-store://review/?ProductId=9N20ZR8DDP8L");
        }
    }

    #[test]
    fn outcomes_serialise_for_the_frontend() {
        assert_eq!(serde_json::to_string(&StoreReviewOutcome::StoreOpened).unwrap(), "\"store-opened\"");
    }

    #[test]
    fn dev_and_test_runs_are_not_store_installs() {
        assert!(!is_packaged());
    }
}
