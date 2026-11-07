//! The 7-day Amply Pro trial: once per Windows account, ever.
//!
//! Uninstalling an MSIX app deletes everything the package wrote: its AppData (virtualised or not)
//! and its registry. So the trial is recorded in two places. One is Amply's own storage. The other
//! is the Windows Credential Manager, which the system's credential service writes, not the package,
//! and which therefore outlives an uninstall. A reinstall finds the record and the trial stays used.
//!
//! The clock is not trusted either: each check remembers the latest time it saw, and a clock that
//! has gone back by more than a day ends the trial instead of stretching it.

use serde::{Deserialize, Serialize};

use crate::{error::AmplyResult, storage};

pub const TRIAL_SECS: i64 = 7 * 86_400;
/// Daylight saving, a time sync or a trip across time zones; anything more is the clock being moved.
const CLOCK_SLACK_SECS: i64 = 86_400;
const CACHE_KEY: &str = "entitlement/pro_trial.json";

/// Debug builds use their own record, so trying the trial in development never uses up the real one.
#[cfg_attr(not(windows), allow(dead_code))]
const CREDENTIAL_TARGET: &str = if cfg!(debug_assertions) { "Amply Music Player/Pro trial (dev)" } else { "Amply Music Player/Pro trial" };

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrialRecord {
    started_at: i64,
    last_seen: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialStatus {
    /// Never started on this Windows account: the trial can be offered.
    available: bool,
    active: bool,
    /// Unix seconds; set once the trial has started.
    ends_at: Option<i64>,
}

/// The earliest start wins and the latest sighting wins, so neither copy can be swapped for a
/// friendlier one.
fn merge(a: Option<TrialRecord>, b: Option<TrialRecord>) -> Option<TrialRecord> {
    match (a, b) {
        (Some(a), Some(b)) => Some(TrialRecord { started_at: a.started_at.min(b.started_at), last_seen: a.last_seen.max(b.last_seen) }),
        (one, None) | (None, one) => one,
    }
}

fn evaluate(record: Option<TrialRecord>, now: i64) -> TrialStatus {
    let Some(record) = record else {
        return TrialStatus { available: true, active: false, ends_at: None };
    };
    let ends_at = record.started_at + TRIAL_SECS;
    let clock_moved_back = now + CLOCK_SLACK_SECS < record.last_seen.max(record.started_at);
    TrialStatus { available: false, active: !clock_moved_back && now < ends_at, ends_at: Some(ends_at) }
}

fn seen(record: TrialRecord, now: i64) -> TrialRecord {
    TrialRecord { last_seen: record.last_seen.max(now), ..record }
}

fn parse(raw: &[u8]) -> Option<TrialRecord> {
    serde_json::from_slice(raw).ok()
}

fn read_cache(app: &tauri::AppHandle) -> Option<TrialRecord> {
    let raw = storage::storage_db(app).ok()?.read_blocking(CACHE_KEY).ok()??;
    parse(raw.as_bytes())
}

fn write_cache(app: &tauri::AppHandle, record: &TrialRecord) {
    let result = storage::storage_db(app).and_then(|db| {
        let value = serde_json::to_string(record).map_err(|err| err.to_string())?;
        db.write_blocking(CACHE_KEY, &value)
    });
    if let Err(error) = result {
        log::warn!("Could not save the Pro trial: {error}");
    }
}

#[cfg(windows)]
mod vault {
    use windows::{
        core::{HSTRING, PWSTR},
        Win32::Security::Credentials::{CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC},
    };

    pub fn read(target: &str) -> Option<Vec<u8>> {
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: on success CredReadW hands back one allocation, read here and freed with CredFree.
        unsafe {
            CredReadW(&HSTRING::from(target), CRED_TYPE_GENERIC, 0, &mut credential).ok()?;
            let blob = std::slice::from_raw_parts((*credential).CredentialBlob, (*credential).CredentialBlobSize as usize).to_vec();
            CredFree(credential.cast());
            Some(blob)
        }
    }

    pub fn write(target: &str, blob: &[u8]) -> windows::core::Result<()> {
        let mut target: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
        let mut user: Vec<u16> = "Amply".encode_utf16().chain(std::iter::once(0)).collect();
        let mut blob = blob.to_vec();
        let credential = CREDENTIALW {
            Flags: CRED_FLAGS(0),
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            // This PC and this Windows account; nothing roams.
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(user.as_mut_ptr()),
            ..Default::default()
        };
        // SAFETY: every pointer in `credential` borrows a buffer that lives until the call returns.
        unsafe { CredWriteW(&credential, 0) }
    }
}

#[cfg(windows)]
fn read_vault() -> Option<TrialRecord> {
    vault::read(CREDENTIAL_TARGET).and_then(|raw| parse(&raw))
}

#[cfg(windows)]
fn write_vault(record: &TrialRecord) {
    let Ok(raw) = serde_json::to_vec(record) else {
        return;
    };
    if let Err(error) = vault::write(CREDENTIAL_TARGET, &raw) {
        log::warn!("Could not record the Pro trial with Windows: {error}");
    }
}

#[cfg(not(windows))]
fn read_vault() -> Option<TrialRecord> {
    None
}

#[cfg(not(windows))]
fn write_vault(_record: &TrialRecord) {}

/// Reads both copies, keeps them in step, and records this sighting of the clock.
fn check(app: &tauri::AppHandle, start: bool) -> TrialStatus {
    let now = storage::now_unix();
    let stored = merge(read_cache(app), read_vault());
    let record = match stored {
        Some(record) => Some(seen(record, now)),
        None if start => Some(TrialRecord { started_at: now, last_seen: now }),
        None => None,
    };
    if let Some(record) = record {
        write_cache(app, &record);
        write_vault(&record);
    }
    evaluate(record, now)
}

#[tauri::command]
pub async fn pro_trial_status(app: tauri::AppHandle) -> AmplyResult<TrialStatus> {
    Ok(tauri::async_runtime::spawn_blocking(move || check(&app, false)).await.map_err(|err| err.to_string())?)
}

/// Starts the trial if this Windows account has never had one; otherwise reports the one it had.
#[tauri::command]
pub async fn pro_trial_start(app: tauri::AppHandle) -> AmplyResult<TrialStatus> {
    Ok(tauri::async_runtime::spawn_blocking(move || check(&app, true)).await.map_err(|err| err.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400;
    const T0: i64 = 1_800_000_000;

    #[test]
    fn a_fresh_account_can_start_once() {
        assert_eq!(evaluate(None, T0), TrialStatus { available: true, active: false, ends_at: None });
        let record = TrialRecord { started_at: T0, last_seen: T0 };
        assert_eq!(evaluate(Some(record), T0 + DAY), TrialStatus { available: false, active: true, ends_at: Some(T0 + 7 * DAY) });
    }

    #[test]
    fn it_ends_after_seven_days_and_never_comes_back() {
        let record = TrialRecord { started_at: T0, last_seen: T0 + 6 * DAY };
        assert!(!evaluate(Some(record), T0 + 7 * DAY).active);
        assert!(!evaluate(Some(record), T0 + 300 * DAY).available);
    }

    #[test]
    fn turning_the_clock_back_ends_it_instead_of_stretching_it() {
        let record = TrialRecord { started_at: T0, last_seen: T0 + 6 * DAY };
        assert!(!evaluate(Some(record), T0 + 2 * DAY).active);
        // A few hours back (time zones, a time sync) is fine.
        assert!(evaluate(Some(record), T0 + 6 * DAY - 3 * 3600).active);
    }

    #[test]
    fn starting_with_the_clock_ahead_then_setting_it_right_gains_nothing() {
        let future = T0 + 1000 * DAY;
        let record = TrialRecord { started_at: future, last_seen: future };
        assert!(!evaluate(Some(record), T0).active);
    }

    #[test]
    fn the_earliest_start_and_latest_sighting_win() {
        let local = TrialRecord { started_at: T0 + 5 * DAY, last_seen: T0 + 5 * DAY };
        let windows = TrialRecord { started_at: T0, last_seen: T0 + DAY };
        assert_eq!(merge(Some(local), Some(windows)), Some(TrialRecord { started_at: T0, last_seen: T0 + 5 * DAY }));
        assert_eq!(merge(None, Some(windows)), Some(windows));
    }

    /// Writes, reads back and deletes a throwaway credential in this account's Credential Manager.
    #[cfg(windows)]
    #[test]
    fn windows_keeps_the_record() {
        use windows::{core::HSTRING, Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC}};
        let target = "Amply Music Player/Pro trial (unit test)";
        vault::write(target, b"{\"startedAt\":1,\"lastSeen\":2}").unwrap();
        assert_eq!(vault::read(target).and_then(|raw| parse(&raw)), Some(TrialRecord { started_at: 1, last_seen: 2 }));
        // SAFETY: deletes the credential written above by name.
        unsafe { CredDeleteW(&HSTRING::from(target), CRED_TYPE_GENERIC, 0).unwrap() };
        assert_eq!(vault::read(target), None);
    }

    #[test]
    fn the_frontend_contract_is_stable() {
        let json = serde_json::to_value(evaluate(Some(TrialRecord { started_at: T0, last_seen: T0 }), T0)).unwrap();
        assert_eq!(json, serde_json::json!({ "available": false, "active": true, "endsAt": T0 + 7 * DAY }));
    }
}
