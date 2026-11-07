//! "More apps from PaperKite": opens another app's Microsoft Store page, in the Store app on Windows.

use tauri_plugin_opener::OpenerExt;

use crate::error::AmplyResult;

/// A Store product ID: 12 characters, a leading 9, then capital letters and digits.
fn is_store_product_id(id: &str) -> bool {
    id.len() == 12 && id.starts_with('9') && id.bytes().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn store_page_uri(id: &str) -> String {
    if cfg!(windows) {
        // `cid` tells the listing's acquisition report the visit came from Amply.
        format!("ms-windows-store://pdp/?ProductId={id}&cid=amply")
    } else {
        format!("https://apps.microsoft.com/detail/{}?cid=amply", id.to_lowercase())
    }
}

#[tauri::command]
pub fn open_store_product(app: tauri::AppHandle, product_id: String) -> AmplyResult<()> {
    if !is_store_product_id(&product_id) {
        return Err(format!("Not a Store product ID: {product_id}").into());
    }
    app.opener().open_url(store_page_uri(&product_id), None::<&str>).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_store_product_ids() {
        assert!(is_store_product_id("9NSG24NXTHCV"));
        for id in ["", "9nsg24nxthcv", "8NSG24NXTHCV", "9NSG24NXTHC", "9NSG24NXTHCV0", "9NSG24NX&HCV", "9NSG24NXTHCV;"] {
            assert!(!is_store_product_id(id), "{id}");
        }
    }

    #[test]
    fn opens_the_listing_in_the_store_app() {
        let uri = store_page_uri("9NSG24NXTHCV");
        if cfg!(windows) {
            assert_eq!(uri, "ms-windows-store://pdp/?ProductId=9NSG24NXTHCV&cid=amply");
        } else {
            assert_eq!(uri, "https://apps.microsoft.com/detail/9nsg24nxthcv?cid=amply");
        }
    }
}
