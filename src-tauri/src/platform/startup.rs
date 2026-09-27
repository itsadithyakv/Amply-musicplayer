//! "Launch on system startup". A Store (MSIX) install cannot use a registry Run key: package
//! registry writes are virtualised, so Windows never sees it. There the manifest declares a
//! startup task (`AmplyStartup`, see scripts/package-msix.ps1) that this module turns on and off.
//! Other installs keep using tauri-plugin-autostart's Run key.

use serde::Serialize;

use crate::error::{AmplyError, AmplyResult};

/// Matches the TaskId in the MSIX manifest.
#[cfg(windows)]
const STARTUP_TASK_ID: &str = "AmplyStartup";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StartupState {
    Enabled,
    Disabled,
    /// Turned off in Windows' Startup apps settings; only the user can turn it back on there.
    DisabledByUser,
    /// Set by an administrator's policy either way.
    Managed,
}

#[cfg(windows)]
mod packaged {
    use windows::core::HSTRING;
    use windows::ApplicationModel::{StartupTask, StartupTaskState};

    use super::{StartupState, STARTUP_TASK_ID};

    fn task() -> windows::core::Result<StartupTask> {
        StartupTask::GetAsync(&HSTRING::from(STARTUP_TASK_ID))?.get()
    }

    fn map(state: StartupTaskState) -> StartupState {
        match state {
            StartupTaskState::Enabled => StartupState::Enabled,
            StartupTaskState::DisabledByUser => StartupState::DisabledByUser,
            StartupTaskState::DisabledByPolicy | StartupTaskState::EnabledByPolicy => StartupState::Managed,
            _ => StartupState::Disabled,
        }
    }

    pub(super) fn state() -> windows::core::Result<StartupState> {
        task()?.State().map(map)
    }

    pub(super) fn set(enabled: bool) -> windows::core::Result<StartupState> {
        let task = task()?;
        if enabled {
            task.RequestEnableAsync()?.get().map(map)
        } else {
            task.Disable()?;
            task.State().map(map)
        }
    }
}

fn plugin_state(app: &tauri::AppHandle) -> AmplyResult<StartupState> {
    use tauri_plugin_autostart::ManagerExt;
    let enabled = app.autolaunch().is_enabled().map_err(|err| AmplyError::Other(err.to_string()))?;
    Ok(if enabled { StartupState::Enabled } else { StartupState::Disabled })
}

fn is_packaged() -> bool {
    super::store_review::is_store_install_rust()
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> AmplyResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| AmplyError::Other(err.to_string()))?
        .map_err(AmplyError::Other)
}

#[tauri::command]
pub async fn startup_get_state(app: tauri::AppHandle) -> AmplyResult<StartupState> {
    #[cfg(windows)]
    if is_packaged() {
        return blocking(|| packaged::state().map_err(|err| err.to_string())).await;
    }
    plugin_state(&app)
}

/// Turns launch-on-startup on or off and returns the state Windows ended up in, which can differ
/// from the request (the user or a policy may have the final say).
#[tauri::command]
pub async fn startup_set_enabled(app: tauri::AppHandle, enabled: bool) -> AmplyResult<StartupState> {
    #[cfg(windows)]
    if is_packaged() {
        return blocking(move || packaged::set(enabled).map_err(|err| err.to_string())).await;
    }
    {
        use tauri_plugin_autostart::ManagerExt;
        let launcher = app.autolaunch();
        let result = if enabled { launcher.enable() } else { launcher.disable() };
        result.map_err(|err| AmplyError::Other(err.to_string()))?;
    }
    plugin_state(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states_serialise_for_the_frontend() {
        assert_eq!(serde_json::to_string(&StartupState::DisabledByUser).unwrap(), "\"disabled-by-user\"");
    }
}
